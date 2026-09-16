import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type OrigenRecibo = "venta_contado" | "cobro_cxc" | "manual";

export interface CrearReciboInput {
  origen: OrigenRecibo;
  venta_id?: string | null;
  cobro_cliente_id?: string | null;
  observaciones?: string | null;
  /** Solo para `origen: "manual"`. */
  manual?: {
    cliente_id?: string | null;
    cliente_nombre?: string | null;
    monto: number;
    moneda?: string | null;
    metodo_pago?: string | null;
    referencia?: string | null;
    concepto?: string | null;
  };
}

export class ReciboError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReciboError";
    this.status = status;
  }
}

const RECIBO_COLS =
  "id, numero_recibo, cliente_id, cliente_nombre, cliente_documento, origen, venta_id, " +
  "cuenta_por_cobrar_id, cobro_cliente_id, fecha, moneda, monto, metodo_pago, referencia, concepto, observaciones, usuario_nombre, anulado";

async function siguienteNumero(sb: AppSupabaseClient, empresaId: string): Promise<string> {
  const { data, error } = await sb
    .from("recibos_dinero")
    .select("numero_recibo")
    .eq("empresa_id", empresaId)
    .like("numero_recibo", "REC-%")
    .order("numero_recibo", { ascending: false })
    .limit(1);
  if (error) throw new ReciboError(error.message, 500);
  let next = 1;
  const last = (data?.[0] as { numero_recibo?: string } | undefined)?.numero_recibo;
  if (last) {
    const m = last.match(/^REC-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `REC-${String(next).padStart(6, "0")}`;
}

async function nombreYDoc(
  sb: AppSupabaseClient,
  empresaId: string,
  clienteId: string | null
): Promise<{ nombre: string; documento: string | null }> {
  if (!clienteId) return { nombre: "Consumidor final", documento: null };
  const { data } = await sb
    .from("clientes")
    .select("empresa, nombre_contacto, nombre, ruc, documento")
    .eq("empresa_id", empresaId)
    .eq("id", clienteId)
    .maybeSingle();
  const c = (data ?? {}) as unknown as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    nombre: s(c.empresa) || s(c.nombre_contacto) || s(c.nombre) || "Cliente",
    documento: s(c.ruc) || s(c.documento) || null,
  };
}

/**
 * Crea (o reutiliza si ya existe) un recibo de dinero para una venta contado o un cobro de CxC.
 * NO toca stock, ventas, cobros ni cuentas por cobrar. Idempotente por venta_contado/cobro.
 * Devuelve el recibo + flag `existed`.
 */
export async function crearOReusarRecibo(
  sb: AppSupabaseClient,
  empresaId: string,
  input: CrearReciboInput,
  usuario: { id: string | null; nombre: string | null }
): Promise<{ recibo: Record<string, unknown>; existed: boolean }> {
  // ── Venta contado ───────────────────────────────────────────────────────
  if (input.origen === "venta_contado") {
    const ventaId = input.venta_id;
    if (!ventaId) throw new ReciboError("Falta venta_id.");
    const vq = await sb
      .from("ventas")
      .select("id, numero_control, total, moneda, cliente_id, tipo_venta, metodo_pago")
      .eq("empresa_id", empresaId)
      .eq("id", ventaId)
      .maybeSingle();
    if (vq.error) throw new ReciboError(vq.error.message, 500);
    if (!vq.data) throw new ReciboError("Venta no encontrada.", 404);
    const v = vq.data as unknown as Record<string, unknown>;

    // ¿Ya existe recibo para esta venta contado?
    const ex = await sb
      .from("recibos_dinero")
      .select(RECIBO_COLS)
      .eq("empresa_id", empresaId)
      .eq("venta_id", ventaId)
      .eq("origen", "venta_contado")
      .maybeSingle();
    if (ex.data) return { recibo: ex.data as unknown as Record<string, unknown>, existed: true };

    const { nombre, documento } = await nombreYDoc(sb, empresaId, v.cliente_id ? String(v.cliente_id) : null);
    // Detalle de pago (método/referencia/entidad) si existe.
    const pd = await sb
      .from("ventas_pagos_detalle")
      .select("metodo_pago, entidad_bancaria_id, referencia")
      .eq("empresa_id", empresaId)
      .eq("venta_id", ventaId)
      .order("created_at", { ascending: false })
      .limit(1);
    const det = (pd.data?.[0] ?? {}) as unknown as Record<string, unknown>;
    const metodo = (det.metodo_pago as string) || (v.metodo_pago as string) || "efectivo";

    return await insertarRecibo(sb, empresaId, usuario, {
      cliente_id: v.cliente_id ? String(v.cliente_id) : null,
      cliente_nombre: nombre,
      cliente_documento: documento,
      origen: "venta_contado",
      venta_id: ventaId,
      cuenta_por_cobrar_id: null,
      cobro_cliente_id: null,
      moneda: (v.moneda as string) === "USD" ? "USD" : "PYG",
      monto: Number(v.total) || 0,
      metodo_pago: metodo,
      entidad_bancaria_id: (det.entidad_bancaria_id as string) || null,
      referencia: (det.referencia as string) || null,
      concepto: `Pago de venta contado ${String(v.numero_control ?? "")}`.trim(),
      observaciones: input.observaciones ?? null,
    });
  }

  // ── Cobro de cuenta por cobrar ──────────────────────────────────────────
  if (input.origen === "cobro_cxc") {
    const cobroId = input.cobro_cliente_id;
    if (!cobroId) throw new ReciboError("Falta cobro_cliente_id.");
    const cq = await sb
      .from("cobros_clientes")
      .select("id, cliente_id, cuenta_por_cobrar_id, venta_id, monto, metodo_pago, referencia, entidad_bancaria_id")
      .eq("empresa_id", empresaId)
      .eq("id", cobroId)
      .maybeSingle();
    if (cq.error) throw new ReciboError(cq.error.message, 500);
    if (!cq.data) throw new ReciboError("Cobro no encontrado.", 404);
    const cob = cq.data as unknown as Record<string, unknown>;

    const ex = await sb
      .from("recibos_dinero")
      .select(RECIBO_COLS)
      .eq("empresa_id", empresaId)
      .eq("cobro_cliente_id", cobroId)
      .maybeSingle();
    if (ex.data) return { recibo: ex.data as unknown as Record<string, unknown>, existed: true };

    // Concepto según saldo de la cuenta (cancelación vs parcial).
    let numeroVenta = "";
    let saldo = 0;
    let moneda = "PYG";
    if (cob.cuenta_por_cobrar_id) {
      const ctaQ = await sb
        .from("cuentas_por_cobrar")
        .select("numero_venta, saldo, moneda")
        .eq("empresa_id", empresaId)
        .eq("id", String(cob.cuenta_por_cobrar_id))
        .maybeSingle();
      const cta = (ctaQ.data ?? {}) as unknown as Record<string, unknown>;
      numeroVenta = (cta.numero_venta as string) || "";
      saldo = Number(cta.saldo) || 0;
      moneda = (cta.moneda as string) === "USD" ? "USD" : "PYG";
    }
    const concepto = saldo <= 0.001
      ? `Cancelación de cuenta ${numeroVenta}`.trim()
      : `Pago parcial de cuenta ${numeroVenta}`.trim();

    const { nombre, documento } = await nombreYDoc(sb, empresaId, cob.cliente_id ? String(cob.cliente_id) : null);

    return await insertarRecibo(sb, empresaId, usuario, {
      cliente_id: cob.cliente_id ? String(cob.cliente_id) : null,
      cliente_nombre: nombre,
      cliente_documento: documento,
      origen: "cobro_cxc",
      venta_id: cob.venta_id ? String(cob.venta_id) : null,
      cuenta_por_cobrar_id: cob.cuenta_por_cobrar_id ? String(cob.cuenta_por_cobrar_id) : null,
      cobro_cliente_id: cobroId,
      moneda,
      monto: Number(cob.monto) || 0,
      metodo_pago: (cob.metodo_pago as string) || "efectivo",
      entidad_bancaria_id: (cob.entidad_bancaria_id as string) || null,
      referencia: (cob.referencia as string) || null,
      concepto,
      observaciones: input.observaciones ?? null,
    });
  }

  // ── Recibo manual (no atado a una venta ni a un cobro) ──────────────────
  if (input.origen === "manual") {
    const m = input.manual;
    if (!m) throw new ReciboError("Faltan los datos del recibo manual.");
    const monto = Number(m.monto);
    if (!Number.isFinite(monto) || monto <= 0) throw new ReciboError("El monto debe ser mayor a 0.");

    const clienteId = m.cliente_id ? String(m.cliente_id) : null;
    let nombre = (m.cliente_nombre ?? "").trim();
    let documento: string | null = null;
    if (clienteId) {
      const r = await nombreYDoc(sb, empresaId, clienteId);
      nombre = r.nombre;
      documento = r.documento;
    }
    if (!nombre) nombre = "Consumidor final";

    return await insertarRecibo(sb, empresaId, usuario, {
      cliente_id: clienteId,
      cliente_nombre: nombre,
      cliente_documento: documento,
      origen: "manual",
      venta_id: null,
      cuenta_por_cobrar_id: null,
      cobro_cliente_id: null,
      moneda: m.moneda === "USD" ? "USD" : "PYG",
      monto,
      metodo_pago: (m.metodo_pago ?? "efectivo").trim() || "efectivo",
      entidad_bancaria_id: null,
      referencia: m.referencia?.trim() || null,
      concepto: m.concepto?.trim() || "Recibo de dinero",
      observaciones: input.observaciones ?? null,
    });
  }

  throw new ReciboError("Origen de recibo inválido.");
}

/**
 * Anula un recibo (marca `anulado`). No revierte la venta ni el cobro asociado:
 * el recibo es un comprobante interno NO fiscal de que el dinero se recibió.
 */
export async function anularRecibo(
  sb: AppSupabaseClient,
  empresaId: string,
  reciboId: string,
  motivo: string | null
): Promise<Record<string, unknown>> {
  const q = await sb
    .from("recibos_dinero")
    .select("id, anulado, observaciones")
    .eq("empresa_id", empresaId)
    .eq("id", reciboId)
    .maybeSingle();
  if (q.error) throw new ReciboError(q.error.message, 500);
  if (!q.data) throw new ReciboError("Recibo no encontrado.", 404);
  if ((q.data as { anulado?: boolean }).anulado) throw new ReciboError("El recibo ya está anulado.", 409);

  const previo = (q.data as { observaciones?: string | null }).observaciones;
  const nota = motivo?.trim() ? `Anulado: ${motivo.trim()}` : "Anulado";
  const observaciones = previo ? `${previo}\n${nota}` : nota;

  const up = await sb
    .from("recibos_dinero")
    .update({ anulado: true, observaciones, updated_at: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("id", reciboId)
    .select(RECIBO_COLS)
    .single();
  if (up.error) throw new ReciboError(up.error.message, 500);
  return up.data as unknown as Record<string, unknown>;
}

/** Listado de recibos con filtros opcionales. */
export async function listarRecibos(
  sb: AppSupabaseClient,
  empresaId: string,
  filtros: {
    desde?: string | null;
    hasta?: string | null;
    origen?: OrigenRecibo | null;
    buscar?: string | null;
    incluirAnulados?: boolean;
  }
): Promise<Record<string, unknown>[]> {
  let q = sb
    .from("recibos_dinero")
    .select(RECIBO_COLS)
    .eq("empresa_id", empresaId)
    .order("fecha", { ascending: false })
    .limit(500);

  if (filtros.desde) q = q.gte("fecha", filtros.desde);
  if (filtros.hasta) q = q.lte("fecha", filtros.hasta);
  if (filtros.origen) q = q.eq("origen", filtros.origen);
  if (!filtros.incluirAnulados) q = q.eq("anulado", false);
  const b = filtros.buscar?.trim();
  if (b) q = q.or(`numero_recibo.ilike.%${b}%,cliente_nombre.ilike.%${b}%,concepto.ilike.%${b}%`);

  const { data, error } = await q;
  if (error) throw new ReciboError(error.message, 500);
  return (data ?? []) as unknown as Record<string, unknown>[];
}

type InsertData = {
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_documento: string | null;
  origen: OrigenRecibo;
  venta_id: string | null;
  cuenta_por_cobrar_id: string | null;
  cobro_cliente_id: string | null;
  moneda: string;
  monto: number;
  metodo_pago: string | null;
  entidad_bancaria_id: string | null;
  referencia: string | null;
  concepto: string | null;
  observaciones: string | null;
};

async function insertarRecibo(
  sb: AppSupabaseClient,
  empresaId: string,
  usuario: { id: string | null; nombre: string | null },
  d: InsertData
): Promise<{ recibo: Record<string, unknown>; existed: boolean }> {
  const numero = await siguienteNumero(sb, empresaId);
  const ins = await sb
    .from("recibos_dinero")
    .insert({
      empresa_id: empresaId,
      numero_recibo: numero,
      ...d,
      usuario_id: usuario.id,
      usuario_nombre: usuario.nombre,
    })
    .select(RECIBO_COLS)
    .single();
  if (ins.error) {
    // Carrera: si otro proceso creó el recibo (índice único por cobro/venta), reutilizar.
    const code = (ins.error as { code?: string }).code;
    if (code === "23505") {
      let q = sb.from("recibos_dinero").select(RECIBO_COLS).eq("empresa_id", empresaId);
      if (d.cobro_cliente_id) q = q.eq("cobro_cliente_id", d.cobro_cliente_id);
      else if (d.venta_id) q = q.eq("venta_id", d.venta_id).eq("origen", "venta_contado");
      const again = await q.maybeSingle();
      if (again.data) return { recibo: again.data as unknown as Record<string, unknown>, existed: true };
    }
    throw new ReciboError(ins.error.message, 500);
  }
  return { recibo: ins.data as unknown as Record<string, unknown>, existed: false };
}
