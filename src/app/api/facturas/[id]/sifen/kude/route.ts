import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { downloadSifenObject } from "@/lib/sifen/sifen-storage";
import { buildKudePdfBuffer, type KudeBranding } from "@/lib/sifen/kude-pdf";
import {
  kudeFallbackQrUrl,
  parseKudeFromSignedRdeXml,
} from "@/lib/sifen/parse-kude-from-signed-xml";
import type { SifenConsultaLoteUltimaPersistida } from "@/lib/sifen/types";
import type { AppSupabaseClient } from "@/lib/supabase/schema";


function filasDetalleConsulta(
  consulta: SifenConsultaLoteUltimaPersistida | Record<string, unknown> | null | undefined
): { cdc: string; dProtAut: string | null }[] {
  if (!consulta || typeof consulta !== "object") return [];
  const o = consulta as Record<string, unknown>;
  const raw = o.detallePorCdc ?? o.detalle_por_cdc;
  if (!Array.isArray(raw)) return [];
  return raw as { cdc: string; dProtAut: string | null }[];
}

function dProtAutDesdeConsulta(
  cdc: string,
  consulta: SifenConsultaLoteUltimaPersistida | Record<string, unknown> | null | undefined
): string | null {
  const rows = filasDetalleConsulta(consulta);
  if (rows.length === 0) return null;
  const hit = rows.find((d) => d.cdc === cdc);
  const v = hit?.dProtAut;
  return v != null && String(v).trim() !== "" ? String(v).trim() : null;
}

function nombreArchivoKude(numeroFactura: string, cdc: string): string {
  const safe = numeroFactura.replace(/[^\w.-]+/g, "_").slice(0, 40);
  const tail = cdc.slice(-8);
  return `KuDE-${safe || "factura"}-${tail}.pdf`;
}

/**
 * Carga branding KuDE/PDF desde `empresa_sifen_config` para la empresa.
 * Devuelve null cuando no hay nada configurado o cuando la lectura no pudo
 * resolverse: en ese caso el renderer usa el diseño Neura por defecto.
 * Solo afecta el PDF; no interactúa con XML/firma/SET/CDC.
 */
async function loadKudeBranding(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<KudeBranding | null> {
  const { data, error } = await supabase
    .from("empresa_sifen_config")
    .select("kude_logo_path, kude_color_primario, kude_color_primario_fill")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    kude_logo_path: string | null;
    kude_color_primario: string | null;
    kude_color_primario_fill: string | null;
  };

  const colorPrimario =
    row.kude_color_primario == null || String(row.kude_color_primario).trim() === ""
      ? null
      : String(row.kude_color_primario).trim();
  const colorPrimarioFill =
    row.kude_color_primario_fill == null ||
    String(row.kude_color_primario_fill).trim() === ""
      ? null
      : String(row.kude_color_primario_fill).trim();

  let logoBytes: Uint8Array | null = null;
  const logoPath =
    row.kude_logo_path == null || String(row.kude_logo_path).trim() === ""
      ? null
      : String(row.kude_logo_path).trim();
  if (logoPath) {
    const dl = await downloadSifenObject(supabase, logoPath);
    if (dl.ok) {
      logoBytes = new Uint8Array(dl.data);
    } else {
      console.warn("[kude] logo download failed, falling back to default", {
        empresa_id: empresaId,
        path: logoPath,
        message: dl.message,
      });
    }
  }

  if (!logoBytes && !colorPrimario && !colorPrimarioFill) return null;
  return { logoBytes, colorPrimario, colorPrimarioFill };
}

/**
 * GET /api/facturas/[id]/sifen/kude
 * PDF KuDE a partir del XML firmado (disponible desde estado "firmado"; no en
 * rechazado/cancelado). Query: `download=1` → Content-Disposition attachment.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: facturaId } = await params;
    if (!facturaId?.trim()) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    const download = request.nextUrl.searchParams.get("download") === "1";
    const fid = facturaId.trim();

    const { data: fac, error: errFac } = await supabase
      .from("facturas")
      .select("id, numero_factura")
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errFac) {
      return NextResponse.json(errorResponse(errFac.message), { status: 400 });
    }
    if (!fac) {
      return NextResponse.json(errorResponse("Factura no encontrada."), { status: 404 });
    }

    const { data: feRow, error: errFe } = await supabase
      .from("factura_electronica")
      .select("estado_sifen, xml_firmado_path, cdc, sifen_ultima_respuesta_consulta_lote")
      .eq("factura_id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errFe) {
      return NextResponse.json(errorResponse(errFe.message), { status: 400 });
    }
    if (!feRow) {
      return NextResponse.json(errorResponse("No hay documento electrónico para esta factura."), {
        status: 404,
      });
    }

    // El KuDE se arma desde el XML firmado (existe desde estado "firmado"), con QR y CDC.
    // El dProtAut (protocolo de aprobación SET) se completa cuando aprueba; el renderer
    // lo acepta vacío. Así la factura se puede imprimir al instante y la aprobación llega
    // en segundo plano. Solo se bloquea si el documento fue rechazado o cancelado.
    const estadoSifen = String(feRow.estado_sifen);
    if (estadoSifen === "rechazado" || estadoSifen === "cancelado") {
      return NextResponse.json(
        errorResponse(
          `El KuDE no está disponible: el documento electrónico está ${estadoSifen === "rechazado" ? "rechazado" : "cancelado"}.`
        ),
        { status: 403 }
      );
    }

    const xmlPath =
      feRow.xml_firmado_path == null ? "" : String(feRow.xml_firmado_path).trim();
    if (!xmlPath) {
      return NextResponse.json(errorResponse("No hay XML firmado en storage."), { status: 400 });
    }

    const dl = await downloadSifenObject(supabase, xmlPath);
    if (!dl.ok) {
      return NextResponse.json(
        errorResponse(`No se pudo descargar el XML firmado: ${dl.message}`),
        { status: 500 }
      );
    }

    let parsed;
    try {
      parsed = parseKudeFromSignedRdeXml(dl.data.toString("utf8"));
    } catch (e) {
      const m = e instanceof Error ? e.message : "Error al leer el XML";
      return NextResponse.json(errorResponse(`XML firmado inválido: ${m}`), { status: 500 });
    }

    const cdcBd = feRow.cdc == null ? "" : String(feRow.cdc).trim();
    if (cdcBd && cdcBd !== parsed.cdc) {
      return NextResponse.json(
        errorResponse("Inconsistencia CDC: re-genere y firme el XML o contacte soporte."),
        { status: 409 }
      );
    }

    const consultaRaw = feRow.sifen_ultima_respuesta_consulta_lote as
      | SifenConsultaLoteUltimaPersistida
      | Record<string, unknown>
      | null
      | undefined;
    const dProtAut = dProtAutDesdeConsulta(parsed.cdc, consultaRaw ?? null);

    const qrUrl = parsed.dCarQR ?? kudeFallbackQrUrl(parsed.cdc);

    /**
     * Branding opcional KuDE/PDF por empresa. SOLO afecta apariencia visual.
     * No participa de XML/firma/SET/CDC. Si la empresa no configuró nada o
     * la descarga del logo falla, se cae silenciosamente al diseño Neura.
     */
    const branding = await loadKudeBranding(
      supabase,
      auth.empresa_id
    ).catch((e) => {
      console.warn("[kude] branding load failed, using default", {
        empresa_id: auth.empresa_id,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    });

    const numeroFactura = fac.numero_factura == null ? "" : String(fac.numero_factura);
    let pdf: Buffer;
    try {
      pdf = await buildKudePdfBuffer({
        parsed,
        numeroFactura,
        dProtAut,
        qrUrl,
        branding,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Error al generar PDF";
      return NextResponse.json(errorResponse(m), { status: 500 });
    }

    const fname = nombreArchivoKude(numeroFactura, parsed.cdc);
    const disp = download ? `attachment; filename="${fname}"` : `inline; filename="${fname}"`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disp,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
