/**
 * Core: firma el XML en storage con el .p12 de la empresa (XML-DSig). No envía a SET.
 * Extraído de POST .../sifen/firmar. Lógica idéntica; `debug` reemplaza a `?debug=1`.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { decryptSecret } from "@/lib/sifen/security";
import {
  buildSifenSignedXmlObjectPath,
  buildSifenXmlObjectPath,
  downloadSifenObject,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadSifenXml,
} from "@/lib/sifen/sifen-storage";
import { downloadSifenCertificadoObject } from "@/lib/sifen/sifen-certificados-storage";
import { extractKeyAndCertFromP12, signSifenDocumentoXml } from "@/lib/sifen/sign-xml";
import { SIFEN_TEST_CSC_GENERICO } from "@/lib/sifen/sifen-ambiente-test";
import { parseAmbiente } from "@/lib/sifen/config-validation";
import type {
  FacturaElectronicaDTO,
  SifenApiFirmarDetalle,
  SifenFirmarResponseData,
} from "@/lib/sifen/types";
import type { SifenCoreResult } from "./core-result";

const ESTADOS_BLOQUEADOS_FIRMAR = new Set<string>(["aprobado", "cancelado"]);

export async function firmarDeCore(
  supabase: AppSupabaseClient,
  empresaId: string,
  facturaId: string,
  opts?: { debug?: boolean }
): Promise<SifenCoreResult<SifenFirmarResponseData>> {
  const fid = facturaId.trim();
  if (!fid) return { ok: false, status: 400, message: "id de factura es obligatorio" };
  const debugXml = opts?.debug === true;

  const { data: feRow, error: errFe } = await supabase
    .from("factura_electronica")
    .select("id, factura_id, xml_path, xml_firmado_path, estado_sifen")
    .eq("factura_id", fid)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errFe) return { ok: false, status: 400, message: errFe.message };
  if (!feRow) {
    return {
      ok: false,
      status: 400,
      message:
        "No existe registro electrónico para esta factura. Cree el borrador y genere el XML antes de firmar.",
    };
  }

  if (ESTADOS_BLOQUEADOS_FIRMAR.has(String(feRow.estado_sifen))) {
    return {
      ok: false,
      status: 409,
      message: `No se puede firmar: el documento está en estado "${feRow.estado_sifen}".`,
    };
  }

  const xmlPathRegistrado = feRow.xml_path == null ? "" : String(feRow.xml_path).trim();
  if (!xmlPathRegistrado) {
    return {
      ok: false,
      status: 400,
      message: "No hay XML generado (xml_path vacío). Ejecute primero POST /api/facturas/{id}/sifen/xml.",
    };
  }

  const canonicalXmlPath = buildSifenXmlObjectPath(empresaId, fid);

  const { data: cfg, error: errCfg } = await supabase
    .from("empresa_sifen_config")
    .select("certificado_path, certificado_password_encrypted, ambiente, csc")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errCfg) return { ok: false, status: 400, message: errCfg.message };
  if (!cfg) return { ok: false, status: 400, message: "No hay configuración SIFEN para esta empresa." };

  const certPath = cfg.certificado_path == null ? "" : String(cfg.certificado_path).trim();
  if (!certPath) {
    return {
      ok: false,
      status: 400,
      message:
        "No hay certificado en storage (certificado_path vacío). Suba el .p12 con POST /api/configuracion/sifen/certificado.",
    };
  }

  const encPwd = cfg.certificado_password_encrypted;
  if (encPwd == null || String(encPwd).trim() === "") {
    return {
      ok: false,
      status: 400,
      message:
        "No hay contraseña del certificado cifrada. Configúrela con PATCH /api/configuracion/sifen (certificado_password).",
    };
  }

  const ambiente = parseAmbiente(cfg.ambiente);
  if (!ambiente) {
    return {
      ok: false,
      status: 400,
      message: 'Configuración SIFEN: ambiente inválido (use "test" o "produccion").',
    };
  }
  const cscCfg = cfg.csc == null ? "" : String(cfg.csc).trim();
  const cscParaQr = ambiente === "test" ? (cscCfg !== "" ? cscCfg : SIFEN_TEST_CSC_GENERICO) : cscCfg;
  if (ambiente === "produccion" && cscParaQr === "") {
    return {
      ok: false,
      status: 400,
      message: "Falta CSC en configuración SIFEN (obligatorio para el código QR / cHashQR en producción).",
    };
  }

  let p12Password: string;
  try {
    p12Password = decryptSecret(String(encPwd));
  } catch (e) {
    const m = e instanceof Error ? e.message : "Error al descifrar la contraseña del certificado";
    return { ok: false, status: 500, message: m };
  }

  const xmlDl = await downloadSifenObject(supabase, canonicalXmlPath);
  if (!xmlDl.ok) {
    return {
      ok: false,
      status: 500,
      message: `No se pudo descargar documento.xml (${canonicalXmlPath}) desde storage: ${xmlDl.message}`,
    };
  }

  const p12Dl = await downloadSifenCertificadoObject(supabase, certPath);
  if (!p12Dl.ok) {
    return { ok: false, status: 500, message: `No se pudo descargar el certificado .p12: ${p12Dl.message}` };
  }

  let material;
  try {
    material = extractKeyAndCertFromP12(p12Dl.data, p12Password);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Error al leer el .p12";
    return { ok: false, status: 400, message: m };
  }

  let signedXml: string;
  try {
    signedXml = signSifenDocumentoXml(xmlDl.data.toString("utf8"), material, {
      ambiente,
      csc: cscParaQr,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Error al firmar el XML";
    return { ok: false, status: 500, message: `Firma XML-DSig falló: ${m}` };
  }

  const bucketOk = await ensureSifenStorageBucket(supabase);
  if (!bucketOk.ok) return { ok: false, status: 500, message: `Storage SIFEN: ${bucketOk.message}` };

  const previousEstado = String(feRow.estado_sifen ?? "generado");
  const previousSignedPath =
    feRow.xml_firmado_path == null || feRow.xml_firmado_path === undefined
      ? null
      : String(feRow.xml_firmado_path);
  const previousXmlPath =
    feRow.xml_path == null || feRow.xml_path === undefined ? null : String(feRow.xml_path);

  const signedPath = buildSifenSignedXmlObjectPath(empresaId, fid);

  await removeSifenObject(supabase, signedPath);
  if (
    previousSignedPath != null &&
    String(previousSignedPath).trim() !== "" &&
    String(previousSignedPath).trim() !== signedPath
  ) {
    await removeSifenObject(supabase, String(previousSignedPath).trim());
  }

  const up = await uploadSifenXml(supabase, signedPath, signedXml);
  if (!up.ok) {
    return { ok: false, status: 500, message: `No se pudo guardar el XML firmado: ${up.message}` };
  }

  const { data: updatedRow, error: errUpdate } = await supabase
    .from("factura_electronica")
    .update({
      xml_firmado_path: signedPath,
      estado_sifen: "firmado",
      xml_path: canonicalXmlPath,
    })
    .eq("id", feRow.id)
    .eq("empresa_id", empresaId)
    .select()
    .single();

  if (errUpdate || !updatedRow) {
    if (previousSignedPath == null || signedPath !== previousSignedPath) {
      await removeSifenObject(supabase, signedPath);
    }
    return {
      ok: false,
      status: 500,
      message:
        errUpdate?.message ?? "No se pudo actualizar factura_electronica; el XML firmado subido fue eliminado.",
    };
  }

  const detalle: SifenApiFirmarDetalle = {
    origen: "api_firmar",
    factura_id: fid,
    xml_firmado_path: signedPath,
  };

  const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
    empresa_id: empresaId,
    factura_electronica_id: feRow.id,
    tipo: "firma",
    detalle,
  });

  if (errEvento) {
    await supabase
      .from("factura_electronica")
      .update({
        xml_firmado_path: previousSignedPath,
        estado_sifen: previousEstado,
        xml_path: previousXmlPath,
      })
      .eq("id", feRow.id)
      .eq("empresa_id", empresaId);
    if (previousSignedPath == null || signedPath !== previousSignedPath) {
      await removeSifenObject(supabase, signedPath);
    }
    return {
      ok: false,
      status: 500,
      message: `No se pudo registrar el evento; se revirtió el estado y el archivo: ${errEvento.message}`,
    };
  }

  const data: SifenFirmarResponseData = {
    factura_electronica: updatedRow as FacturaElectronicaDTO,
    xml_path: canonicalXmlPath,
    xml_firmado_path: signedPath,
    storage_bucket: SIFEN_STORAGE_BUCKET,
  };
  if (debugXml) data.xml_firmado = signedXml;

  return { ok: true, data };
}
