/**
 * Cancelación REAL del DE ante el SET: construye el Evento de Cancelación,
 * lo firma con el .p12 de la empresa y lo envía al endpoint de eventos del SET.
 * Devuelve si el SET ACEPTÓ la cancelación (para que el ERP solo marque anulada
 * la factura si el SET confirmó). No lanza.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { decryptSecret } from "@/lib/sifen/security";
import { downloadSifenCertificadoObject } from "@/lib/sifen/sifen-certificados-storage";
import { parseAmbiente } from "@/lib/sifen/config-validation";
import { enviarEventoCancelacionSifen } from "@/lib/sifen/evento-cancelacion";

export interface CancelarDeSetResult {
  /** true si el proceso corrió sin excepción (no implica aceptación). */
  ok: boolean;
  /** true si el SET ACEPTÓ la cancelación (registrada ahora o ya lo estaba). */
  aceptado: boolean;
  /** true si el SET respondió que el CDC ya tenía el evento (4003): ya cancelado. */
  yaEstabaCancelado: boolean;
  dCodRes: string | null;
  dMsgRes: string | null;
  error: string | null;
  /** Diagnóstico: HTTP status y respuesta cruda del SET (recortada). */
  httpStatus: number | null;
  rawResponse: string | null;
}

function fail(error: string): CancelarDeSetResult {
  return {
    ok: false,
    aceptado: false,
    yaEstabaCancelado: false,
    dCodRes: null,
    dMsgRes: null,
    error,
    httpStatus: null,
    rawResponse: null,
  };
}

export async function cancelarDeEnSetServerSide(args: {
  supabase: AppSupabaseClient;
  empresaId: string;
  cdc: string;
  motivo: string;
}): Promise<CancelarDeSetResult> {
  const { supabase, empresaId, cdc, motivo } = args;
  try {
    const { data: cfg, error } = await supabase
      .from("empresa_sifen_config")
      .select("certificado_path, certificado_password_encrypted, ambiente, activo")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error) return fail(error.message);
    if (!cfg) return fail("No hay configuración SIFEN para esta empresa.");
    if (!cfg.activo) return fail("La configuración SIFEN está inactiva.");

    const certPath = cfg.certificado_path == null ? "" : String(cfg.certificado_path).trim();
    if (!certPath) return fail("No hay certificado en storage para firmar la cancelación.");

    const enc = cfg.certificado_password_encrypted;
    if (enc == null || String(enc).trim() === "") {
      return fail("Falta la contraseña del certificado (cifrada) para firmar la cancelación.");
    }

    const ambiente = parseAmbiente(cfg.ambiente);
    if (!ambiente) return fail('Ambiente SIFEN inválido (use "test" o "produccion").');

    let password: string;
    try {
      password = decryptSecret(String(enc));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "No se pudo descifrar la contraseña del certificado.");
    }

    const p12 = await downloadSifenCertificadoObject(supabase, certPath);
    if (!p12.ok) return fail(`No se pudo descargar el certificado .p12: ${p12.message}`);

    const eventoId = Number(BigInt(Date.now()) % BigInt("999999999")) || 1;

    // build + firma + envío (endpoint evento.wsdl, SOAP 1.2 application/soap+xml).
    const res = await enviarEventoCancelacionSifen({
      ambiente,
      cdc,
      motivo,
      certificadoP12: p12.data,
      certificadoPassword: password,
      dId: eventoId,
    });

    const rawResponse = (res.cuerpoSoapCrudo ?? "").slice(0, 800) || null;
    const errBase = res.dMsgRes?.trim()
      ? res.dMsgRes.trim()
      : `El SET no aceptó la cancelación (código ${res.dCodRes ?? "sin código"}, HTTP ${res.httpStatus}).`;
    return {
      ok: true,
      aceptado: res.cancelado,
      yaEstabaCancelado: res.yaEstabaCancelado,
      dCodRes: res.dCodRes,
      dMsgRes: res.dMsgRes,
      httpStatus: res.httpStatus,
      rawResponse,
      error: res.cancelado ? null : errBase,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Error al enviar la cancelación al SET.");
  }
}
