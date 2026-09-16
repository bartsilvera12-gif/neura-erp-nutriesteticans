/**
 * Cliente tipado para las APIs multi-depósito.
 * Cada función devuelve `{ ok: true, data } | { ok: false, error }`.
 */

export type Deposito = {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  activo: boolean;
  total_stock: number;
  productos_con_stock: number;
};

export type StockItem = {
  producto_id: string;
  nombre: string;
  sku: string;
  unidad: string;
  stock: number;
};

export type NotaRemisionEstado = "borrador" | "pendiente" | "aprobada" | "rechazada";

export type NotaRemisionItem = {
  /** NULL en ítems talonario (texto libre, sin producto del catálogo). */
  producto_id: string | null;
  producto_nombre?: string;
  producto_sku?: string;
  /** Descripción libre en modo talonario; en NR viejas puede venir null. */
  descripcion?: string | null;
  unidad_medida?: string | null;
  cantidad: number;
};

export type NotaRemision = {
  id: string;
  numero: string;
  fecha: string;
  emisor: string | null;
  /** Null en modo talonario (no hay depósito de origen). */
  ubicacion_origen_id: string | null;
  /** Null cuando el destino es un cliente / dirección externa. */
  ubicacion_destino_id: string | null;
  destino_tipo?: "deposito" | "cliente";
  cliente_id?: string | null;
  destino_nombre?: string | null;
  destino_direccion?: string | null;
  destino_ciudad?: string | null;
  /** Modo del comprobante: null (viejo, ligado a depósito) o "talonario". */
  modo?: "talonario" | null;
  motivo_traslado?: string | null;
  direccion_origen?: string | null;
  direccion_destino?: string | null;
  motivo: "traslado" | "venta" | "devolucion";
  estado: NotaRemisionEstado;
  motivo_rechazo: string | null;
  aprobada_at: string | null;
  aprobada_por: string | null;
  transportista: string | null;
  ruc_transportista: string | null;
  conductor: string | null;
  ci_conductor: string | null;
  chapa: string | null;
  fecha_inicio_traslado: string | null;
  fecha_fin_traslado: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
  items?: NotaRemisionItem[];
  origen?: { nombre: string; codigo: string } | null;
  destino?: { nombre: string; codigo: string } | null;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function unwrap<T>(res: Response): Promise<Result<T>> {
  try {
    const j = await res.json();
    if (!res.ok) return { ok: false, error: j?.error?.message ?? j?.error ?? `Error ${res.status}` };
    return { ok: true, data: j.data as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

export async function fetchDepositos(): Promise<Result<{ depositos: Deposito[] }>> {
  return unwrap(await fetch("/api/depositos", { cache: "no-store" }));
}

export async function fetchStockDeposito(
  ubicacionId: string,
  opts?: { buscar?: string; soloConStock?: boolean }
): Promise<Result<{ deposito: { id: string; nombre: string; codigo: string }; items: StockItem[]; total_stock: number; productos_con_stock: number }>> {
  const p = new URLSearchParams();
  if (opts?.buscar) p.set("buscar", opts.buscar);
  if (opts?.soloConStock) p.set("solo_con_stock", "1");
  const qs = p.toString();
  return unwrap(await fetch(`/api/depositos/${ubicacionId}/stock${qs ? "?" + qs : ""}`, { cache: "no-store" }));
}

export async function fetchNRs(filtros?: {
  estado?: NotaRemisionEstado | "";
  origen?: string;
  destino?: string;
  buscar?: string;
}): Promise<Result<{ notas_remision: NotaRemision[] }>> {
  const p = new URLSearchParams();
  if (filtros?.estado) p.set("estado", filtros.estado);
  if (filtros?.origen) p.set("origen", filtros.origen);
  if (filtros?.destino) p.set("destino", filtros.destino);
  if (filtros?.buscar) p.set("buscar", filtros.buscar);
  const qs = p.toString();
  return unwrap(await fetch(`/api/notas-remision${qs ? "?" + qs : ""}`, { cache: "no-store" }));
}

export async function fetchNR(id: string): Promise<Result<{ nota_remision: NotaRemision }>> {
  return unwrap(await fetch(`/api/notas-remision/${id}`, { cache: "no-store" }));
}

/** Payload aceptado por POST /api/notas-remision. Cubre los dos modos:
 *  - **depósito** (flujo viejo con stock): pasar ubicaciones e ítems por
 *    producto_id.
 *  - **talonario** (flujo simple, sin depósitos ni stock): pasar
 *    `modo: "talonario"` + ítems como `{ descripcion, cantidad, unidad }`.
 */
export async function crearNR(payload: {
  emisor?: string;
  ubicacion_origen_id?: string;
  ubicacion_destino_id?: string;
  destino_tipo?: "deposito" | "cliente";
  cliente_id?: string;
  destino_nombre?: string;
  destino_direccion?: string;
  destino_ciudad?: string;
  motivo?: "traslado" | "venta" | "devolucion";
  items: Array<{ producto_id?: string; descripcion?: string; unidad?: string; cantidad: number }>;
  transportista?: string;
  ruc_transportista?: string;
  conductor?: string;
  ci_conductor?: string;
  chapa?: string;
  fecha_inicio_traslado?: string;
  fecha_fin_traslado?: string;
  observaciones?: string;
  modo?: "talonario";
  motivo_traslado?: string;
  direccion_origen?: string;
  direccion_destino?: string;
}): Promise<Result<{ nota_remision: NotaRemision }>> {
  return unwrap(await fetch("/api/notas-remision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function aprobarNR(id: string, aprobador: string): Promise<Result<{ ok: true; numero: string }>> {
  return unwrap(await fetch(`/api/notas-remision/${id}/aprobar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ aprobador }),
  }));
}

export async function rechazarNR(id: string, motivo: string): Promise<Result<{ ok: true; numero: string }>> {
  return unwrap(await fetch(`/api/notas-remision/${id}/rechazar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ motivo }),
  }));
}
