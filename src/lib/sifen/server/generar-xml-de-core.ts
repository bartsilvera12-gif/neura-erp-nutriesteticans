/**
 * Core: genera el XML rDE oficial (SIFEN v150), lo sube a storage y actualiza
 * factura_electronica (sin firma ni SET). Extraído de POST .../sifen/xml.
 * Lógica idéntica; el flag `debug` reemplaza a `?debug=1`.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { loadValidatedSifenPayload } from "@/lib/sifen/load-factura-payload";
import { buildOfficialRdeFacturaElectronicaXml } from "@/lib/sifen/rde-xml";
import {
  buildSifenXmlObjectPath,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadSifenXml,
} from "@/lib/sifen/sifen-storage";
import type {
  FacturaElectronicaDTO,
  SifenApiXmlGeneracionDetalle,
  SifenXmlGeneracionResponseData,
} from "@/lib/sifen/types";
import type { SifenCoreResult } from "./core-result";

/**
 * Solo `aprobado` bloquea regeneración. `enviado` permite corregir y volver a firmar si el lote falla
 * (p. ej. 1858) sin depender de que la consulta-lote haya actualizado ya el estado en BD.
 */
const ESTADOS_BLOQUEADOS_XML = new Set<string>(["aprobado", "cancelado"]);

export async function generarXmlDeCore(
  supabase: AppSupabaseClient,
  empresaId: string,
  facturaId: string,
  opts?: { debug?: boolean }
): Promise<SifenCoreResult<SifenXmlGeneracionResponseData>> {
  const fid = facturaId.trim();
  if (!fid) return { ok: false, status: 400, message: "id de factura es obligatorio" };
  const debugXml = opts?.debug === true;

  const { data: feSnapshot, error: errSnap } = await supabase
    .from("factura_electronica")
    .select(
      "id, xml_path, xml_firmado_path, estado_sifen, sifen_regeneracion_seq, error, cdc, sifen_d_prot_cons_lote, sifen_ultima_respuesta_consulta_lote, sifen_ultima_respuesta_recibe_lote"
    )
    .eq("factura_id", fid)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errSnap) return { ok: false, status: 400, message: errSnap.message };
  if (!feSnapshot) {
    return {
      ok: false,
      status: 400,
      message:
        "No existe registro electrónico para esta factura. Cree primero el borrador con POST /api/facturas/{id}/sifen/borrador.",
    };
  }

  if (ESTADOS_BLOQUEADOS_XML.has(String(feSnapshot.estado_sifen))) {
    return {
      ok: false,
      status: 409,
      message: `No se puede regenerar el XML: el documento está en estado "${feSnapshot.estado_sifen}".`,
    };
  }

  const previousEstado = String(feSnapshot.estado_sifen ?? "borrador");
  const rawPrev = feSnapshot.sifen_regeneracion_seq;
  const previousRegSeq = Number.isFinite(Number(rawPrev)) ? Math.max(0, Math.floor(Number(rawPrev))) : 0;
  let bumpRechazoAplicado = false;

  if (previousEstado === "rechazado") {
    const nextSeq = previousRegSeq + 1;
    const { data: bumped, error: bumpErr } = await supabase
      .from("factura_electronica")
      .update({ sifen_regeneracion_seq: nextSeq })
      .eq("id", feSnapshot.id)
      .eq("empresa_id", empresaId)
      .eq("estado_sifen", "rechazado")
      .eq("sifen_regeneracion_seq", previousRegSeq)
      .select("sifen_regeneracion_seq")
      .maybeSingle();

    if (bumpErr) return { ok: false, status: 500, message: bumpErr.message };
    if (!bumped) {
      return {
        ok: false,
        status: 409,
        message:
          "No se pudo reservar una nueva revisión del documento (el estado pudo cambiar). Actualizá la página e intentá de nuevo.",
      };
    }
    bumpRechazoAplicado = true;
  }

  const revertBumpRegSeq = async () => {
    if (!bumpRechazoAplicado) return;
    bumpRechazoAplicado = false;
    await supabase
      .from("factura_electronica")
      .update({ sifen_regeneracion_seq: previousRegSeq })
      .eq("id", feSnapshot.id)
      .eq("empresa_id", empresaId);
  };

  const loaded = await loadValidatedSifenPayload(supabase, empresaId, fid);
  if (!loaded.ok) {
    await revertBumpRegSeq();
    return { ok: false, status: loaded.error.status, message: loaded.error.message };
  }

  if (loaded.payload.sifen.factura_electronica_id !== feSnapshot.id) {
    await revertBumpRegSeq();
    return { ok: false, status: 500, message: "Inconsistencia entre factura electrónica y payload." };
  }

  const fecha = loaded.payload.documento.fecha.trim();
  const yAnio = /^(\d{4})/.exec(fecha)?.[1] ?? String(new Date().getFullYear());
  let xmlString: string;
  try {
    xmlString = buildOfficialRdeFacturaElectronicaXml(loaded.payload, {
      timbradoFechaInicio: loaded.payload.emisor.timbrado_fecha_inicio_vigencia,
      timbradoFechaFin: `${yAnio}-12-31`,
      ambiente: loaded.ambiente,
      emisorTelefono: "021000000",
      emisorEmail: "facturacion@configurar-empresa.com.py",
      emisorDireccion: loaded.payload.emisor.direccion_fiscal.trim(),
      emisorNumCasa: 0,
      actividadEconomicaCodigo: loaded.payload.emisor.actividad_economica_codigo,
      actividadEconomicaDescripcion: loaded.payload.emisor.actividad_economica_descripcion,
    });
  } catch (e) {
    await revertBumpRegSeq();
    const msg = e instanceof Error ? e.message : "Error al generar XML SIFEN";
    return { ok: false, status: 400, message: msg };
  }

  const cdcMatch = /\bId="(\d{44})"/.exec(xmlString);
  const cdc = cdcMatch?.[1] ?? null;
  const objectPath = buildSifenXmlObjectPath(empresaId, fid);

  const bucketOk = await ensureSifenStorageBucket(supabase);
  if (!bucketOk.ok) {
    await revertBumpRegSeq();
    return { ok: false, status: 500, message: `Storage SIFEN: ${bucketOk.message}` };
  }

  const up = await uploadSifenXml(supabase, objectPath, xmlString);
  if (!up.ok) {
    await revertBumpRegSeq();
    return { ok: false, status: 500, message: `No se pudo guardar el XML en storage: ${up.message}` };
  }

  const previousXmlPath =
    feSnapshot.xml_path === null || feSnapshot.xml_path === undefined ? null : String(feSnapshot.xml_path);
  const previousSignedPath =
    feSnapshot.xml_firmado_path === null || feSnapshot.xml_firmado_path === undefined
      ? null
      : String(feSnapshot.xml_firmado_path).trim() || null;

  const { data: updatedRow, error: errUpdate } = await supabase
    .from("factura_electronica")
    .update({
      xml_path: objectPath,
      estado_sifen: "generado",
      xml_firmado_path: null,
      ...(cdc ? { cdc } : {}),
      ...(previousEstado === "rechazado"
        ? {
            error: null,
            sifen_d_prot_cons_lote: null,
            sifen_ultima_respuesta_consulta_lote: null,
            sifen_ultima_respuesta_recibe_lote: null,
          }
        : {}),
    })
    .eq("id", feSnapshot.id)
    .eq("empresa_id", empresaId)
    .select()
    .single();

  if (errUpdate || !updatedRow) {
    await removeSifenObject(supabase, objectPath);
    await revertBumpRegSeq();
    return {
      ok: false,
      status: 500,
      message:
        errUpdate?.message ?? "No se pudo actualizar factura_electronica; el archivo subido fue eliminado.",
    };
  }

  bumpRechazoAplicado = false;

  const detalle: SifenApiXmlGeneracionDetalle = {
    origen: "api_xml",
    factura_id: fid,
    xml_path: objectPath,
    ...(previousEstado === "rechazado" ? { sifen_regeneracion_seq: previousRegSeq + 1 } : {}),
  };

  const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
    empresa_id: empresaId,
    factura_electronica_id: feSnapshot.id,
    tipo: "generacion",
    detalle,
  });

  if (errEvento) {
    await supabase
      .from("factura_electronica")
      .update({
        xml_path: previousXmlPath,
        estado_sifen: previousEstado,
        xml_firmado_path: previousSignedPath,
        ...(previousEstado === "rechazado"
          ? {
              sifen_regeneracion_seq: previousRegSeq,
              error: feSnapshot.error ?? null,
              cdc: feSnapshot.cdc ?? null,
              sifen_d_prot_cons_lote: feSnapshot.sifen_d_prot_cons_lote ?? null,
              sifen_ultima_respuesta_consulta_lote: feSnapshot.sifen_ultima_respuesta_consulta_lote ?? null,
              sifen_ultima_respuesta_recibe_lote: feSnapshot.sifen_ultima_respuesta_recibe_lote ?? null,
            }
          : {}),
      })
      .eq("id", feSnapshot.id)
      .eq("empresa_id", empresaId);
    await removeSifenObject(supabase, objectPath);
    return {
      ok: false,
      status: 500,
      message: `No se pudo registrar el evento; se revirtió el estado y el archivo: ${errEvento.message}`,
    };
  }

  if (previousSignedPath) {
    await removeSifenObject(supabase, previousSignedPath);
  }

  const data: SifenXmlGeneracionResponseData = {
    factura_electronica: updatedRow as FacturaElectronicaDTO,
    xml_path: objectPath,
    storage_bucket: SIFEN_STORAGE_BUCKET,
  };
  if (debugXml) data.xml = xmlString;

  return { ok: true, data };
}
