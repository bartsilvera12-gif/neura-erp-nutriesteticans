import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type ReciboOrigen = "venta_contado" | "cobro_cxc" | "manual";

export type Recibo = {
  id: string;
  numero_recibo: string;
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_documento: string | null;
  origen: ReciboOrigen;
  venta_id: string | null;
  fecha: string;
  moneda: string;
  monto: number;
  metodo_pago: string | null;
  referencia: string | null;
  concepto: string | null;
  observaciones: string | null;
  usuario_nombre: string | null;
  anulado: boolean;
};

export type ReciboManualInput = {
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  monto: number;
  moneda?: string;
  metodo_pago?: string;
  referencia?: string;
  concepto?: string;
};

type GenerarReciboInput =
  | { origen: "venta_contado"; venta_id: string }
  | { origen: "cobro_cxc"; cobro_cliente_id: string }
  | { origen: "manual"; manual: ReciboManualInput };

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function unwrap<T>(res: Response): Promise<Result<T>> {
  try {
    const j = await res.json();
    if (!res.ok || j?.success === false) {
      return { ok: false, error: j?.error ?? `Error ${res.status}` };
    }
    return { ok: true, data: j.data as T };
  } catch {
    return { ok: false, error: "Error de red." };
  }
}

/** Lista recibos con filtros. */
export async function fetchRecibos(filtros?: {
  desde?: string;
  hasta?: string;
  origen?: ReciboOrigen | "";
  buscar?: string;
  incluirAnulados?: boolean;
}): Promise<Result<{ recibos: Recibo[] }>> {
  const p = new URLSearchParams();
  if (filtros?.desde) p.set("desde", filtros.desde);
  if (filtros?.hasta) p.set("hasta", filtros.hasta);
  if (filtros?.origen) p.set("origen", filtros.origen);
  if (filtros?.buscar) p.set("buscar", filtros.buscar);
  if (filtros?.incluirAnulados) p.set("incluir_anulados", "1");
  const qs = p.toString();
  return unwrap(
    await fetchWithSupabaseSession(`/api/recibos-dinero${qs ? `?${qs}` : ""}`, { cache: "no-store" })
  );
}

/** Emite un recibo manual (no atado a venta ni cobro). */
export async function crearReciboManual(manual: ReciboManualInput): Promise<Result<{ recibo: Recibo }>> {
  return unwrap(
    await fetchWithSupabaseSession("/api/recibos-dinero", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origen: "manual", manual }),
    })
  );
}

/** Anula un recibo. No revierte la venta ni el cobro asociado. */
export async function anularRecibo(id: string, motivo?: string): Promise<Result<{ recibo: Recibo }>> {
  return unwrap(
    await fetchWithSupabaseSession(`/api/recibos-dinero/${id}/anular`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: motivo ?? "" }),
    })
  );
}

/** Abre el PDF imprimible de un recibo. */
export function abrirReciboPdf(id: string): void {
  try {
    window.open(`/api/recibos-dinero/${id}/pdf?auto=1`, "_blank", "noopener");
  } catch { /* el popup pudo bloquearse */ }
}

/**
 * Genera (o reutiliza si ya existe) un recibo de dinero y abre su documento imprimible.
 * Idempotente: si ya hay recibo para esa venta/cobro, se reimprime el mismo.
 * Devuelve true si se abrió OK, o un mensaje de error.
 */
export async function generarYAbrirRecibo(input: GenerarReciboInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithSupabaseSession("/api/recibos-dinero", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await res.json();
    if (!res.ok || body?.success === false || !body?.data?.recibo?.id) {
      return { ok: false, error: body?.error ?? "No se pudo generar el recibo." };
    }
    const id = String(body.data.recibo.id);
    try {
      window.open(`/api/recibos-dinero/${id}/pdf?auto=1`, "_blank", "noopener");
    } catch { /* el popup pudo bloquearse */ }
    return { ok: true };
  } catch {
    return { ok: false, error: "Error de red al generar el recibo." };
  }
}
