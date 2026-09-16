/**
 * Orquestador server-side de emisión de un Documento Electrónico (DE) SIFEN.
 *
 * Ejecuta el pipeline completo borrador → XML → firmar → (enviar → consulta-lote)
 * reutilizando los cores puros (borrador/xml/firmar) y los handlers de enviar/consulta
 * (invocados server-side con un NextRequest sintético, sin HTTP real).
 *
 * NUNCA lanza: cualquier fallo (SET caído, rechazo, timeout) se captura y se devuelve
 * como `EmitirDeResult` con el mejor estado conocido; el DE queda reintentable desde el
 * panel de la factura. Pensado para invocarse al confirmar una venta sin trabar la venta.
 */
import { NextRequest, type NextResponse } from "next/server";
import type { UsuarioConEmpresa } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { EstadoSifen, FacturaElectronicaDTO } from "@/lib/sifen/types";
import { crearBorradorDeCore } from "./crear-borrador-de-core";
import { generarXmlDeCore } from "./generar-xml-de-core";
import { firmarDeCore } from "./firmar-de-core";
import { handleSifenEnviarPost } from "@/lib/sifen/handle-sifen-enviar-post";
import { handleSifenConsultaLotePost } from "@/lib/sifen/handle-sifen-consulta-lote-post";

export interface EmitirDeResult {
  facturaElectronicaId: string | null;
  estadoFinal: EstadoSifen | string;
  cdc: string | null;
  protocoloLote: string | null;
  aprobado: boolean;
  /** true si el DE no llegó a aprobado y puede reintentarse desde el panel de la factura. */
  reintentable: boolean;
  /** true si ya hay XML firmado → KuDE imprimible (aunque el SET aún no haya aprobado). */
  kudeDisponible: boolean;
  error: string | null;
}

const ESTADOS_FINALIZADOS = new Set<string>(["aprobado", "cancelado"]);

/** Invoca un handler SIFEN (enviar / consulta-lote) server-side y parsea su JSON. */
async function llamarHandler(
  handler: (
    request: NextRequest,
    params: Promise<{ id: string }>,
    auth: UsuarioConEmpresa,
    supabase: AppSupabaseClient,
    options: { soloAmbienteTest: boolean }
  ) => Promise<NextResponse>,
  auth: UsuarioConEmpresa,
  supabase: AppSupabaseClient,
  facturaId: string
): Promise<{ success: boolean; data?: { factura_electronica?: FacturaElectronicaDTO }; error?: string }> {
  const req = new NextRequest("http://localhost/api/internal/sifen");
  const res = await handler(req, Promise.resolve({ id: facturaId }), auth, supabase, {
    soloAmbienteTest: false,
  });
  try {
    const json = (await res.json()) as {
      success?: boolean;
      data?: { factura_electronica?: FacturaElectronicaDTO };
      error?: string;
    };
    return { success: !!json.success, data: json.data, error: json.error };
  } catch {
    return { success: false, error: `Respuesta no parseable (HTTP ${res.status})` };
  }
}

function resultadoDesde(
  fe: FacturaElectronicaDTO | null,
  error: string | null
): EmitirDeResult {
  const estado = fe?.estado_sifen ?? "borrador";
  const aprobado = estado === "aprobado";
  const reintentable = !aprobado && estado !== "cancelado";
  // KuDE imprimible desde que está firmado (tiene XML firmado con QR/CDC), salvo
  // rechazado/cancelado. Coincide con el guard del endpoint /sifen/kude.
  const kudeDisponible =
    estado === "firmado" || estado === "enviado" || estado === "aprobado";
  return {
    facturaElectronicaId: fe?.id ?? null,
    estadoFinal: estado,
    cdc: fe?.cdc ?? null,
    protocoloLote: fe?.sifen_d_prot_cons_lote ?? null,
    aprobado,
    reintentable,
    kudeDisponible,
    error,
  };
}

/**
 * Envía el lote al SET y consulta el resultado, en segundo plano (no se espera).
 * Corre después de responder al cajero. Cualquier fallo deja el DE en su último
 * estado bueno (firmado/error_envio), reintentable desde el panel de la factura.
 */
async function enviarYConsultarEnSegundoPlano(
  auth: UsuarioConEmpresa,
  supabase: AppSupabaseClient,
  facturaId: string
): Promise<void> {
  try {
    const envio = await llamarHandler(handleSifenEnviarPost, auth, supabase, facturaId);
    if (!envio.success) return; // error_envio: reintentable
    const estado = String(envio.data?.factura_electronica?.estado_sifen ?? "");
    if (estado === "enviado") {
      await llamarHandler(handleSifenConsultaLotePost, auth, supabase, facturaId);
    }
  } catch (e) {
    console.error("[emitirDE bg] enviar/consulta:", e instanceof Error ? e.message : e);
  }
}

export async function emitirDeFacturaServerSide(args: {
  auth: UsuarioConEmpresa;
  supabase: AppSupabaseClient;
  facturaId: string;
  sync: boolean;
}): Promise<EmitirDeResult> {
  const { auth, supabase, facturaId, sync } = args;
  const empresaId = auth.empresa_id;
  let fe: FacturaElectronicaDTO | null = null;

  try {
    // 1) Borrador (idempotente)
    const borrador = await crearBorradorDeCore(supabase, empresaId, facturaId);
    if (!borrador.ok) return resultadoDesde(null, borrador.message);
    fe = borrador.data;
    let estado = String(fe.estado_sifen);

    if (ESTADOS_FINALIZADOS.has(estado)) return resultadoDesde(fe, null);

    // 2) XML (borrador o rechazado → generado)
    if (estado === "borrador" || estado === "rechazado") {
      const xml = await generarXmlDeCore(supabase, empresaId, facturaId);
      if (!xml.ok) return resultadoDesde(fe, xml.message);
      fe = xml.data.factura_electronica;
      estado = String(fe.estado_sifen);
    }

    // 3) Firmar (generado → firmado)
    if (estado === "generado") {
      const firma = await firmarDeCore(supabase, empresaId, facturaId);
      if (!firma.ok) return resultadoDesde(fe, firma.message);
      fe = firma.data.factura_electronica;
      estado = String(fe.estado_sifen);
    }

    if (!sync) return resultadoDesde(fe, null);

    // Factura al instante: el KuDE ya está listo (firmado). El envío al SET + la
    // consulta de aprobación corren en SEGUNDO PLANO (no se esperan) para no hacer
    // esperar al cajero por la red del SET. La aprobación queda visible luego en el
    // detalle de la factura; si el envío falla, el DE queda reintentable.
    if (estado === "firmado") {
      void enviarYConsultarEnSegundoPlano(auth, supabase, facturaId);
    }
    return resultadoDesde(fe, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error inesperado al emitir el documento electrónico.";
    console.error("[emitirDeFacturaServerSide]", msg);
    return resultadoDesde(fe, msg);
  }
}
