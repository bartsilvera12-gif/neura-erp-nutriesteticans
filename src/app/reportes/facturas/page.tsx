"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { FancySelect } from "@/components/ui/FancySelect";

type FacturaReporte = {
  id: string;
  numero_factura: string;
  fecha: string;
  fecha_vencimiento: string;
  monto: number;
  saldo: number;
  estado: string;
  tipo: string;
  moneda: string;
  cliente_id: string;
  cliente_display?: string;
  estado_sifen?: string | null;
  fecha_pago_registro?: string | null;
};

function formatFecha(str: string | null | undefined) {
  if (!str) return "—";
  const [y, m, d] = String(str).slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

function montoLabel(v: number, moneda: string) {
  const pref = moneda === "USD" ? "USD" : "Gs.";
  return `${pref} ${Number(v || 0).toLocaleString(moneda === "USD" ? "en-US" : "es-PY")}`;
}

/** Color del chip de estado comercial. */
function estadoTone(estado: string): string {
  const e = estado.toLowerCase();
  if (e.includes("anul")) return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  if (e.includes("pag")) return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
  if (e.includes("pend") || e.includes("saldo")) return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

const SIFEN_LABEL: Record<string, string> = {
  borrador: "Borrador",
  generado: "XML generado",
  firmado: "Firmado",
  enviado: "Enviado a SET",
  en_proceso: "En proceso",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  error_envio: "Error de envío",
  cancelado: "Cancelado",
};

function sifenTone(estado: string): string {
  switch (estado) {
    case "aprobado":
      return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
    case "rechazado":
    case "error_envio":
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
    case "cancelado":
      return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
    case "enviado":
    case "en_proceso":
      return "bg-sky-50 text-sky-800 ring-1 ring-sky-200";
    default:
      return "bg-slate-50 text-slate-600 ring-1 ring-slate-200";
  }
}

export default function ReporteFacturasPage() {
  const [facturas, setFacturas] = useState<FacturaReporte[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithSupabaseSession("/api/facturas", { cache: "no-store" });
        const j = (await res.json()) as { success?: boolean; data?: FacturaReporte[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !j.success || !Array.isArray(j.data)) {
          setError(j.error ?? "No se pudieron cargar las facturas");
          setFacturas([]);
          return;
        }
        setFacturas(j.data);
      } catch {
        if (!cancelled) setError("Error de red al cargar facturas");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const estadosDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const f of facturas) if (f.estado?.trim()) set.add(f.estado.trim());
    return Array.from(set).sort();
  }, [facturas]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return facturas.filter((f) => {
      if (q) {
        const hay =
          f.numero_factura?.toLowerCase().includes(q) ||
          (f.cliente_display ?? "").toLowerCase().includes(q);
        if (!hay) return false;
      }
      if (filtroEstado && f.estado !== filtroEstado) return false;
      const fecha = String(f.fecha).slice(0, 10);
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
      return true;
    });
  }, [facturas, busqueda, filtroEstado, desde, hasta]);

  const totales = useMemo(() => {
    let monto = 0;
    let saldo = 0;
    for (const f of filtradas) {
      monto += Number(f.monto || 0);
      saldo += Number(f.saldo || 0);
    }
    return { monto, saldo, cobrado: monto - saldo };
  }, [filtradas]);

  const hayFiltros = Boolean(busqueda || filtroEstado || desde || hasta);

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-6 px-4 sm:px-6 w-full">
      <div>
        <Link href="/reportes" className="text-xs font-medium text-[#0EA5E9] hover:underline">
          ← Reportes
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Reporte de facturas</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Todas las facturas de la empresa. Filtrá por cliente, estado o rango de fechas.
        </p>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Facturas</p>
          <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{filtradas.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Monto total</p>
          <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">Gs. {Math.round(totales.monto).toLocaleString("es-PY")}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cobrado</p>
          <p className="mt-1 text-xl font-bold text-emerald-700 tabular-nums">Gs. {Math.round(totales.cobrado).toLocaleString("es-PY")}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Saldo pendiente</p>
          <p className="mt-1 text-xl font-bold text-amber-700 tabular-nums">Gs. {Math.round(totales.saldo).toLocaleString("es-PY")}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Buscar</label>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Número o cliente…"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white"
          />
        </div>
        <div className="w-44">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Estado</label>
          <FancySelect
            value={filtroEstado}
            onChange={(v) => setFiltroEstado(v)}
            ariaLabel="Filtrar por estado"
            size="sm"
            options={[
              { value: "", label: "Todos los estados" },
              ...estadosDisponibles.map((e) => ({ value: e, label: e })),
            ]}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white"
          />
        </div>
        {hayFiltros && (
          <button
            type="button"
            onClick={() => {
              setBusqueda("");
              setFiltroEstado("");
              setDesde("");
              setHasta("");
            }}
            className="text-sm text-slate-400 hover:text-slate-600 px-2 py-2"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[52rem]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="py-3 px-4 font-semibold">Número</th>
                <th className="py-3 px-4 font-semibold">Cliente</th>
                <th className="py-3 px-4 font-semibold">Emisión</th>
                <th className="py-3 px-4 font-semibold">Vencimiento</th>
                <th className="py-3 px-4 font-semibold text-right">Monto</th>
                <th className="py-3 px-4 font-semibold text-right">Saldo</th>
                <th className="py-3 px-4 font-semibold">Estado</th>
                <th className="py-3 px-4 font-semibold">SIFEN</th>
                <th className="py-3 px-4 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">Cargando facturas…</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-rose-600">{error}</td>
                </tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    {facturas.length === 0 ? "No hay facturas registradas." : "Ninguna factura coincide con los filtros."}
                  </td>
                </tr>
              ) : (
                filtradas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-slate-700">{f.numero_factura}</td>
                    <td className="py-3 px-4 text-slate-800">{f.cliente_display ?? "Cliente"}</td>
                    <td className="py-3 px-4 text-slate-600 tabular-nums">{formatFecha(f.fecha)}</td>
                    <td className="py-3 px-4 text-slate-600 tabular-nums">{formatFecha(f.fecha_vencimiento)}</td>
                    <td className="py-3 px-4 text-right tabular-nums font-semibold text-slate-900">{montoLabel(f.monto, f.moneda)}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-slate-700">{montoLabel(f.saldo, f.moneda)}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${estadoTone(f.estado)}`}>
                        {f.estado}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {f.estado_sifen ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${sifenTone(f.estado_sifen)}`}>
                          {SIFEN_LABEL[f.estado_sifen] ?? f.estado_sifen}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/facturas/${f.id}`}
                        className="text-xs font-semibold text-[#0EA5E9] hover:underline"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
