"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft, Loader2, Download, FileCheck2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ESTADO_LABEL, type EstadoPresupuesto } from "@/lib/presupuestos/types";

type Presu = {
  id: string;
  numero_control: string;
  cliente_nombre: string;
  cliente_ruc: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  estado: EstadoPresupuesto;
  moneda: string;
  subtotal: number | string;
  monto_iva: number | string;
  descuento_total: number | string;
  total: number | string;
  validez_dias: number | null;
  fecha: string;
  fecha_vencimiento: string | null;
  condicion: "contado" | "credito" | null;
  forma_pago: string | null;
  plazo_entrega: string | null;
  observaciones: string | null;
  convertido_pedido_id: string | null;
};
type ItemRow = {
  id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number | string;
  unidad_medida: string | null;
  precio_unitario: number | string;
  iva_tipo: string;
  descuento: number | string;
  total: number | string;
};

const ESTADO_BADGE: Record<EstadoPresupuesto, string> = {
  creado: "bg-slate-100 text-slate-700",
  enviado: "bg-sky-100 text-sky-700",
  aprobado: "bg-emerald-100 text-emerald-700",
  rechazado: "bg-red-100 text-red-700",
  convertido: "bg-violet-100 text-violet-700",
};
// Transiciones permitidas desde la UI (no incluye 'convertido', que va por /convertir).
const SIGUIENTES: Record<EstadoPresupuesto, EstadoPresupuesto[]> = {
  creado: ["enviado", "aprobado", "rechazado"],
  enviado: ["aprobado", "rechazado"],
  aprobado: ["rechazado"],
  rechazado: ["creado", "enviado"],
  convertido: [],
};

function fmtGs(n: number | string, moneda: string) {
  const v = Number(n) || 0;
  return (moneda === "USD" ? "USD " : "Gs. ") + v.toLocaleString("es-PY", { maximumFractionDigits: moneda === "USD" ? 2 : 0 });
}
function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function PresupuestoDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [presu, setPresu] = useState<Presu | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo cargar el presupuesto.");
        return;
      }
      setPresu(body.data.presupuesto as Presu);
      setItems((body.data.items ?? []) as ItemRow[]);
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiarEstado(nuevo: EstadoPresupuesto) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevo }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo cambiar el estado.");
        return;
      }
      setPresu(body.data.presupuesto as Presu);
      setOk(`Estado actualizado a "${ESTADO_LABEL[nuevo]}".`);
      setTimeout(() => setOk(null), 2500);
    } catch {
      setError("Error de red al cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }

  async function convertir() {
    if (busy) return;
    if (!confirm("¿Crear un pedido desde este presupuesto? No se descuenta stock ni se genera venta.")) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}/convertir`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo crear el pedido.");
        return;
      }
      setOk("Pedido creado correctamente.");
      await cargar();
    } catch {
      setError("Error de red al crear el pedido.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>;
  }
  if (!presu) {
    return (
      <div className="p-6 space-y-3">
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error ?? "Presupuesto no encontrado"}</div>
        <Link href="/presupuestos" className="text-sm text-[#4FAEB2] hover:underline">Volver a presupuestos</Link>
      </div>
    );
  }

  const condicionCredito = presu.condicion === "credito";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/presupuestos" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Volver a presupuestos
        </Link>
        <a
          href={`/api/presupuestos/${id}/pdf`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white shadow-sm shadow-[#4FAEB2]/30 transition-colors hover:bg-[#3F8E91]"
        >
          <Download className="h-4 w-4" /> Descargar PDF
        </a>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      {ok && <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">✓ {ok}</div>}

      {/* Documento */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Encabezado */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E5F4F4] ring-1 ring-[#4FAEB2]/30">
              <FileText className="h-6 w-6 text-[#3F8E91]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{presu.numero_control}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_BADGE[presu.estado]}`}>
                  {ESTADO_LABEL[presu.estado]}
                </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${condicionCredito ? "bg-amber-100 text-amber-700" : "bg-[#E5F4F4] text-[#3F8E91]"}`}>
                  {condicionCredito ? "Crédito" : "Contado"}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="text-slate-500">Emitido: <span className="font-medium text-slate-700">{fmtFecha(presu.fecha)}</span></p>
            {presu.fecha_vencimiento && (
              <p className="text-slate-500">Válido hasta: <span className="font-medium text-slate-700">{fmtFecha(presu.fecha_vencimiento)}</span></p>
            )}
          </div>
        </div>

        {/* Cliente + datos */}
        <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2">
          <div className="bg-white px-6 py-5">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#3F8E91]">Preparado para</h3>
            <p className="text-base font-semibold text-slate-900">{presu.cliente_nombre}</p>
            <div className="mt-1 space-y-0.5 text-sm text-slate-600">
              {presu.cliente_ruc && <p>RUC / CI: {presu.cliente_ruc}</p>}
              {presu.cliente_telefono && <p>Tel: {presu.cliente_telefono}</p>}
              {presu.cliente_direccion && <p>{presu.cliente_direccion}</p>}
            </div>
          </div>
          <div className="bg-white px-6 py-5">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#3F8E91]">Detalles</h3>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Condición</dt><dd className={`font-semibold ${condicionCredito ? "text-amber-700" : "text-[#3F8E91]"}`}>{condicionCredito ? "Crédito" : "Contado"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Moneda</dt><dd className="font-medium text-slate-700">{presu.moneda === "USD" ? "Dólares (USD)" : "Guaraníes (PYG)"}</dd></div>
              {presu.validez_dias != null && <div className="flex justify-between gap-4"><dt className="text-slate-500">Validez</dt><dd className="font-medium text-slate-700">{presu.validez_dias} día(s)</dd></div>}
              {presu.forma_pago && <div className="flex justify-between gap-4"><dt className="text-slate-500">Forma de pago</dt><dd className="font-medium text-slate-700">{presu.forma_pago}</dd></div>}
              {presu.plazo_entrega && <div className="flex justify-between gap-4"><dt className="text-slate-500">Plazo de entrega</dt><dd className="font-medium text-slate-700">{presu.plazo_entrega}</dd></div>}
            </dl>
          </div>
        </div>

        {/* Items */}
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-3 pl-6 pr-4 text-left font-bold">Descripción</th>
                <th className="px-4 py-3 text-center font-bold">Cant.</th>
                <th className="px-4 py-3 text-right font-bold">Precio unit.</th>
                <th className="px-4 py-3 text-center font-bold">IVA</th>
                <th className="px-4 py-3 text-right font-bold">Desc.</th>
                <th className="py-3 pl-4 pr-6 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => (
                <tr key={it.id} className="transition-colors hover:bg-slate-50/60">
                  <td className="py-3 pl-6 pr-4">
                    <span className="font-medium text-slate-800">{it.producto_nombre}</span>
                    {it.sku ? <span className="text-xs text-slate-400"> · {it.sku}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-600">{Number(it.cantidad).toLocaleString("es-PY")} {it.unidad_medida ?? ""}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtGs(it.precio_unitario, presu.moneda)}</td>
                  <td className="px-4 py-3 text-center text-slate-500">{it.iva_tipo}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{Number(it.descuento) > 0 ? fmtGs(it.descuento, presu.moneda) : "—"}</td>
                  <td className="py-3 pl-4 pr-6 text-right font-semibold tabular-nums text-slate-900">{fmtGs(it.total, presu.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totales */}
        <div className="flex justify-end border-t border-slate-100 px-6 py-5">
          <div className="w-full sm:w-80 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Subtotal (sin IVA)</span><span className="tabular-nums text-slate-700">{fmtGs(presu.subtotal, presu.moneda)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">IVA</span><span className="tabular-nums text-slate-700">{fmtGs(presu.monto_iva, presu.moneda)}</span></div>
            {Number(presu.descuento_total) > 0 && <div className="flex justify-between"><span className="text-slate-500">Descuentos</span><span className="tabular-nums text-slate-700">- {fmtGs(presu.descuento_total, presu.moneda)}</span></div>}
            <div className="mt-2 flex items-center justify-between rounded-lg bg-[#4FAEB2] px-4 py-2.5 text-white">
              <span className="text-sm font-bold uppercase tracking-wide">Total</span>
              <span className="text-lg font-bold tabular-nums">{fmtGs(presu.total, presu.moneda)}</span>
            </div>
          </div>
        </div>

        {presu.observaciones && (
          <div className="border-t border-slate-100 px-6 py-5">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#3F8E91]">Observaciones</h3>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{presu.observaciones}</p>
          </div>
        )}
      </div>

      {/* Acciones */}
      {presu.estado === "convertido" && presu.convertido_pedido_id && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-800">
          <span>Este presupuesto ya fue convertido en pedido.</span>
          <Link
            href={`/dashboard/proyectos/${presu.convertido_pedido_id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
          >
            <FileCheck2 className="h-3.5 w-3.5" /> Abrir pedido
          </Link>
        </div>
      )}

      {(SIGUIENTES[presu.estado].length > 0 || presu.estado === "aprobado") && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Acciones</h2>
          <div className="flex flex-wrap gap-2">
            {SIGUIENTES[presu.estado].map((s) => (
              <button key={s} onClick={() => cambiarEstado(s)} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">
                Marcar como {ESTADO_LABEL[s]}
              </button>
            ))}
            {presu.estado === "aprobado" && (
              <button onClick={convertir} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-50">
                <FileCheck2 className="h-4 w-4" /> Crear pedido
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
