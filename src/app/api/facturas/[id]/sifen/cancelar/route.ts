import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { toFacturaElectronicaDto } from "@/lib/sifen/to-factura-electronica-dto";
import {
  buildSifenCancelacionPreview,
  normalizePlazoCancelacionHoras,
} from "@/lib/sifen/sifen-cancelacion-rules";
import { cancelarDeEnSetServerSide } from "@/lib/sifen/server/cancelar-de-server-side";
import type { FacturaElectronicaDTO } from "@/lib/sifen/types";

// Sin exports de maxDuration/runtime: la implementación de referencia que funciona
// en producción no los usa. En un plan que no soporta maxDuration=60, ese export
// puede romper la función y devolver 502 en runtime.

function trimMotivo(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

/**
 * POST /api/facturas/[id]/sifen/cancelar
 * Cancelación lógica del DE (estado cancelado + trazas). No elimina la factura comercial.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id } = await params;
    const fid = id?.trim();
    if (!fid) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("Cuerpo JSON inválido"), { status: 400 });
    }
    const b = body != null && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const motivo = trimMotivo(b.motivo);
    if (motivo == null || motivo.length < 5) {
      return NextResponse.json(
        errorResponse("motivo es obligatorio (mínimo 5 caracteres) para registrar la cancelación."),
        { status: 400 }
      );
    }
    if (motivo.length > 2000) {
      return NextResponse.json(errorResponse("motivo no puede superar 2000 caracteres."), { status: 400 });
    }

    const { data: factura, error: errF } = await supabase
      .from("facturas")
      .select("id, empresa_id")
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errF) {
      return NextResponse.json(errorResponse(errF.message), { status: 400 });
    }
    if (!factura) {
      return NextResponse.json(errorResponse("Factura no encontrada"), { status: 404 });
    }

    const [{ data: cfg }, { data: feRow }, pagosRes] = await Promise.all([
      supabase
        .from("empresa_sifen_config")
        .select("sifen_plazo_cancelacion_horas")
        .eq("empresa_id", auth.empresa_id)
        .maybeSingle(),
      supabase.from("factura_electronica").select("*").eq("factura_id", fid).eq("empresa_id", auth.empresa_id).maybeSingle(),
      supabase
        .from("pagos")
        .select("id", { count: "exact", head: true })
        .eq("factura_id", fid)
        .eq("empresa_id", auth.empresa_id),
    ]);

    if (pagosRes.error) {
      return NextResponse.json(errorResponse(pagosRes.error.message), { status: 400 });
    }
    const pagosCount = pagosRes.count ?? 0;

    if (!feRow) {
      return NextResponse.json(
        errorResponse("No hay documento electrónico asociado a esta factura."),
        { status: 409 }
      );
    }

    const plazo = normalizePlazoCancelacionHoras(
      cfg != null ? (cfg as { sifen_plazo_cancelacion_horas?: unknown }).sifen_plazo_cancelacion_horas : 48
    );

    const feDto = toFacturaElectronicaDto(feRow as Record<string, unknown>);
    const preview = buildSifenCancelacionPreview({
      estadoSifen: feDto.estado_sifen,
      sifenAprobadoAtIso: feDto.sifen_aprobado_at,
      sifenCanceladoAtIso: feDto.sifen_cancelado_at,
      plazoHoras: plazo,
      pagosCount,
      nowMs: Date.now(),
    });

    if (!preview.puede_cancelar) {
      return NextResponse.json(
        errorResponse(preview.motivo_bloqueo ?? "No se puede cancelar el documento electrónico."),
        { status: 409 }
      );
    }

    // Cancelación REAL ante el SET: se envía el Evento de Cancelación. La factura
    // solo se marca anulada si el SET ACEPTA. Si rechaza o falla, sigue vigente.
    const cdc = (feDto.cdc ?? "").trim();
    if (cdc.length !== 44) {
      return NextResponse.json(
        errorResponse("El documento electrónico no tiene CDC válido; no se puede cancelar ante el SET."),
        { status: 409 }
      );
    }

    // Envío SÍNCRONO del Evento de Cancelación al SET (mTLS + firma), igual que los
    // handlers de "Enviar a SET" / "Consultar lote" que ya funcionan sincrónicos.
    // `supabase` aquí ya es el singleton service-role stateless. La respuesta trae el
    // resultado REAL del SET; la factura solo se marca Anulada si el SET ACEPTA.
    const empresaId = auth.empresa_id;
    const feId = feDto.id;
    const nowIso = new Date().toISOString();

    const setRes = await cancelarDeEnSetServerSide({ supabase, empresaId, cdc, motivo });

    if (!setRes.aceptado) {
      // Rechazo/fallo: la factura NO se toca (sigue vigente). Se registra el evento
      // con la respuesta del SET para trazabilidad y para afinar el formato/reintentar.
      await supabase.from("factura_electronica_evento").insert({
        empresa_id: empresaId,
        factura_electronica_id: feId,
        tipo: "cancelacion_rechazada",
        detalle: {
          origen: "api_cancelar",
          factura_id: fid,
          motivo,
          rechazado_en: nowIso,
          estado: "rechazado",
          set_cod_res: setRes.dCodRes,
          set_msg_res: setRes.dMsgRes,
          set_http_status: setRes.httpStatus,
          set_raw: setRes.rawResponse,
          error: setRes.error,
        },
      });
      const codTxt = setRes.dCodRes ? ` (código ${setRes.dCodRes})` : "";
      const msgTxt = setRes.dMsgRes ?? setRes.error ?? "sin detalle";
      return NextResponse.json(
        errorResponse(
          `El SET no aceptó la cancelación${codTxt}: ${msgTxt}. La factura sigue vigente; podés reintentar.`
        ),
        { status: 502 }
      );
    }

    // Aceptado por el SET: marcar cancelado + anulado + registrar evento.
    const { data: updatedFe, error: errUp } = await supabase
      .from("factura_electronica")
      .update({
        estado_sifen: "cancelado",
        sifen_cancelado_at: nowIso,
        sifen_cancelacion_motivo: motivo,
        error: null,
      })
      .eq("id", feId)
      .eq("empresa_id", empresaId)
      .select()
      .single();
    if (errUp || !updatedFe) {
      return NextResponse.json(
        errorResponse(
          `El SET aceptó la cancelación pero no se pudo actualizar el DE localmente: ${errUp?.message ?? "error"}. El documento está cancelado en el SET.`
        ),
        { status: 500 }
      );
    }

    await supabase.from("factura_electronica_evento").insert({
      empresa_id: empresaId,
      factura_electronica_id: feId,
      tipo: "cancelacion",
      detalle: {
        origen: "api_cancelar",
        factura_id: fid,
        motivo,
        cancelado_en: nowIso,
        estado: "aceptado",
        set_cod_res: setRes.dCodRes,
        set_msg_res: setRes.dMsgRes,
      },
    });

    await supabase
      .from("facturas")
      .update({ estado: "Anulado", saldo: 0 })
      .eq("id", fid)
      .eq("empresa_id", empresaId);

    const dto = toFacturaElectronicaDto(updatedFe as Record<string, unknown>);
    const data: { factura_electronica: FacturaElectronicaDTO; set_cod_res: string | null; set_msg_res: string | null } = {
      factura_electronica: dto,
      set_cod_res: setRes.dCodRes,
      set_msg_res: setRes.dMsgRes,
    };
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
