/**
 * Core: crea (o devuelve) el registro factura_electronica en estado borrador.
 * Extraído de POST /api/facturas/[id]/sifen/borrador para poder invocarlo
 * server-side (orquestador de emisión al confirmar una venta) sin pasar por HTTP.
 * La lógica es idéntica; el route handler ahora adapta este resultado a NextResponse.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { FacturaElectronicaDTO, SifenBorradorGeneracionDetalle } from "@/lib/sifen/types";
import type { SifenCoreResult } from "./core-result";

export async function crearBorradorDeCore(
  supabase: AppSupabaseClient,
  empresaId: string,
  facturaId: string
): Promise<SifenCoreResult<FacturaElectronicaDTO>> {
  const fid = facturaId.trim();
  if (!fid) return { ok: false, status: 400, message: "id de factura es obligatorio" };

  const { data: factura, error: errFactura } = await supabase
    .from("facturas")
    .select("id")
    .eq("id", fid)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errFactura) return { ok: false, status: 400, message: errFactura.message };
  if (!factura) return { ok: false, status: 404, message: "Factura no encontrada" };

  const { data: sifenConfig, error: errConfig } = await supabase
    .from("empresa_sifen_config")
    .select("id, activo")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errConfig) return { ok: false, status: 400, message: errConfig.message };
  if (!sifenConfig) {
    return {
      ok: false,
      status: 400,
      message:
        "No hay configuración SIFEN para esta empresa. Cree la configuración en /api/configuracion/sifen antes de generar el borrador.",
    };
  }
  if (!sifenConfig.activo) {
    return {
      ok: false,
      status: 400,
      message:
        "La configuración SIFEN está desactivada. Actívela desde /api/configuracion/sifen para generar borradores electrónicos.",
    };
  }

  const { data: existente, error: errExistente } = await supabase
    .from("factura_electronica")
    .select("*")
    .eq("factura_id", fid)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errExistente) return { ok: false, status: 400, message: errExistente.message };
  if (existente) return { ok: true, data: existente as FacturaElectronicaDTO };

  const { data: creada, error: errInsert } = await supabase
    .from("factura_electronica")
    .insert({
      empresa_id: empresaId,
      factura_id: fid,
      estado_sifen: "borrador",
    })
    .select()
    .single();

  if (errInsert) {
    if (errInsert.code === "23505") {
      const { data: otra, error: errOtra } = await supabase
        .from("factura_electronica")
        .select("*")
        .eq("factura_id", fid)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (errOtra) return { ok: false, status: 400, message: errOtra.message };
      if (otra) return { ok: true, data: otra as FacturaElectronicaDTO };
    }
    return { ok: false, status: 400, message: errInsert.message };
  }

  const detalle: SifenBorradorGeneracionDetalle = {
    origen: "api_borrador",
    factura_id: fid,
  };

  const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
    empresa_id: empresaId,
    factura_electronica_id: creada.id,
    tipo: "generacion",
    detalle,
  });

  if (errEvento) {
    await supabase
      .from("factura_electronica")
      .delete()
      .eq("id", creada.id)
      .eq("empresa_id", empresaId);
    return {
      ok: false,
      status: 500,
      message: `No se pudo registrar el evento de generación: ${errEvento.message}`,
    };
  }

  return { ok: true, data: creada as FacturaElectronicaDTO };
}
