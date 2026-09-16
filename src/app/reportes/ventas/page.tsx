"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import RangoFechasSelector from "@/components/reportes/RangoFechasSelector";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";
import {
  ETIQUETA_FORMA,
  ventasDeForma,
  type Forma,
  type FilaDia,
  type ResumenVentas,
  type VentaReporte,
} from "@/lib/ventas/reporte-formas-pago";

/**
 * Ventas por forma de pago.
 *
 * Contesta la pregunta del cierre del día: de todo lo que se vendió, cuánto
 * entró por cada medio. El arqueo mira un turno; esto cruza todos los turnos y
 * todas las cajas del período.
 */

const hoyAsuncion = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

function fmtDia(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}/${m[2]}` : d;
}

function fmtHora(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-PY", {
    timeZone: "America/Asuncion",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* Cada forma con su color, para poder leer la barra de un vistazo. Crédito y
   lo que falta cobrar van en gris y ámbar: no son plata en la mano. */
const COLOR_FORMA: Record<Forma, string> = {
  efectivo: "bg-emerald-500",
  transferencia: "bg-sky-500",
  tarjeta: "bg-violet-500",
  qr: "bg-cyan-500",
  billetera: "bg-teal-500",
  saldo_favor: "bg-indigo-400",
  otro: "bg-slate-400",
  credito: "bg-slate-300",
  pendiente: "bg-amber-400",
  sin_definir: "bg-red-500",
};

type Respuesta = {
  rango: { desde: string; hasta: string };
  resumen: ResumenVentas;
  por_dia: FilaDia[];
  ventas: VentaReporte[];
};

export default function ReporteVentasPage() {
  const [desde, setDesde] = useState(`${mesActualAsuncion()}-01`);
  const [hasta, setHasta] = useState(hoyAsuncion());
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forma, setForma] = useState<Forma | "todas">("todas");

  const cargar = useCallback(async (d: string, h: string) => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/reportes/ventas?desde=${encodeURIComponent(d)}&hasta=${encodeURIComponent(h)}`,
        { cache: "no-store" }
      );
      const j = (await r.json()) as { data?: Respuesta; error?: string };
      if (!r.ok || !j.data) {
        setError(j.error ?? "No se pudo cargar el reporte.");
        setData(null);
        return;
      }
      setData(j.data);
    } catch {
      setError("No se pudo cargar el reporte.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar(desde, hasta);
  }, [desde, hasta, cargar]);

  const resumen = data?.resumen;
  const formasUsadas = useMemo(() => (resumen?.por_forma ?? []).map((f) => f.forma), [resumen]);

  const ventasVisibles = useMemo(() => {
    const todas = data?.ventas ?? [];
    const vivas = todas.filter((v) => String(v.estado ?? "").toLowerCase() !== "anulada");
    return forma === "todas" ? vivas : ventasDeForma(vivas, forma);
  }, [data, forma]);

  function exportarCsv() {
    const cab = ["Fecha", "Comprobante", "Cliente", "Total", "Forma de pago"];
    const filas = ventasVisibles.map((v) => [
      `${v.dia} ${fmtHora(v.fecha)}`,
      v.numero_control ?? "",
      v.cliente ?? "",
      String(Math.round(v.total)),
      formaDeVenta(v),
    ]);
    /* Punto y coma: Excel en español no parte por coma y saldría todo en una
       sola columna. Y comillas dobladas, que un nombre con comillas rompe el
       archivo. */
    const escapar = (x: unknown) => '"' + String(x).replace(/"/g, '""') + '"';
    const csv = [cab, ...filas].map((f) => f.map(escapar).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ventas-formas-de-pago-${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Ventas por forma de pago"
        description="Cuánto entró por cada medio en el período, cruzando todas las cajas y turnos."
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <RangoFechasSelector
              desde={desde}
              hasta={hasta}
              onChange={(r) => {
                setDesde(r.desde);
                setHasta(r.hasta);
              }}
            />
            <button
              type="button"
              onClick={exportarCsv}
              disabled={ventasVisibles.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-[#4FAEB2]/30 bg-white px-4 py-2.5 text-sm font-bold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/10 disabled:opacity-40"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar
            </button>
          </div>
        }
      />

      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {cargando ? (
        <p className="animate-pulse text-slate-500">Cargando…</p>
      ) : !resumen ? null : resumen.cantidad_ventas === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
          No hubo ventas en este período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Vendido"
              value={fmtGs(resumen.total_vendido)}
              hint={`${resumen.cantidad_ventas} venta(s)${resumen.anuladas > 0 ? ` · ${resumen.anuladas} anulada(s)` : ""}`}
              accent
            />
            <StatCard
              label="Cobrado"
              value={fmtGs(resumen.total_cobrado)}
              hint="entró por algún medio"
            />
            <StatCard
              label="A crédito"
              value={fmtGs(montoDe(resumen, "credito"))}
              hint="se cobra después"
            />
            <StatCard
              label="Sin cobrar"
              value={fmtGs(montoDe(resumen, "pendiente"))}
              hint="entregado, todavía no pagado"
            />
          </div>

          {/* La barra: la proporción se ve antes que los números. */}
          <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
            <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
              Por dónde entró
            </h2>

            <div className="mb-5 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
              {resumen.por_forma.map((f) => (
                <div
                  key={f.forma}
                  className={COLOR_FORMA[f.forma]}
                  style={{ width: `${f.porcentaje}%` }}
                  title={`${f.etiqueta}: ${fmtGs(f.monto)}`}
                />
              ))}
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Forma de pago</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ventas</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Monto</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resumen.por_forma.map((f) => (
                    <tr key={f.forma} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 text-slate-700">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_FORMA[f.forma]}`} />
                          {f.etiqueta}
                          {f.forma === "sin_definir" && (
                            <span className="text-[11px] font-semibold text-red-600">
                              · falta clasificar
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{f.ventas}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{fmtGs(f.monto)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{f.porcentaje}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {montoDe(resumen, "sin_definir") > 0 && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                Hay {fmtGs(montoDe(resumen, "sin_definir"))} sin clasificar. Son ventas
                anteriores al control de métodos de pago: el arqueo de esos turnos las
                contó como efectivo.
              </p>
            )}
          </div>

          {/* Día por día: es lo que se mira para cerrar la jornada. */}
          {(data?.por_dia.length ?? 0) > 1 && (
            <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
              <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
                Día por día
              </h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Día</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ventas</th>
                      {formasUsadas.map((f) => (
                        <th key={f} className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          {ETIQUETA_FORMA[f]}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data?.por_dia ?? []).map((d) => (
                      <tr key={d.dia} className="hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{fmtDia(d.dia)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{d.ventas}</td>
                        {formasUsadas.map((f) => (
                          <td key={f} className="px-3 py-2 text-right tabular-nums text-slate-600">
                            {d.por_forma[f] ? fmtGs(d.por_forma[f] as number) : "—"}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{fmtGs(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* El detalle, filtrable: de acá sale la respuesta a "¿cuál fue?". */}
          <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
                Ventas del período
              </h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setForma("todas")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    forma === "todas"
                      ? "bg-[#4FAEB2] text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Todas
                </button>
                {resumen.por_forma.map((f) => (
                  <button
                    key={f.forma}
                    type="button"
                    onClick={() => setForma(f.forma)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      forma === f.forma
                        ? "bg-[#4FAEB2] text-white"
                        : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {f.etiqueta}
                    <span className="ml-1 opacity-70">{f.ventas}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Fecha</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Comprobante</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Cliente</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Forma de pago</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ventasVisibles.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                        Ninguna venta de esa forma en el período.
                      </td>
                    </tr>
                  ) : (
                    ventasVisibles.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">
                          {fmtDia(v.dia)} {fmtHora(v.fecha)}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{v.numero_control ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{v.cliente ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{formaDeVenta(v)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{fmtGs(v.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function montoDe(r: ResumenVentas, forma: Forma): number {
  return r.por_forma.find((f) => f.forma === forma)?.monto ?? 0;
}

/** Cómo se pagó esta venta, en una línea. Una combinada muestra las dos partes. */
function formaDeVenta(v: VentaReporte): string {
  if (String(v.tipo_venta ?? "").toUpperCase() === "CREDITO") return "Crédito";
  if (v.cobro_diferido && !v.cobrado_at) return "Sin cobrar";
  const partes = Object.entries(v.detalle ?? {}).filter(([, m]) => (m ?? 0) > 0);
  if (partes.length > 0) {
    return partes
      .map(([f, m]) => `${ETIQUETA_FORMA[f as Forma]} ${fmtGs(m as number)}`)
      .join(" + ");
  }
  const m = String(v.metodo_pago ?? "").toLowerCase() as Forma;
  return ETIQUETA_FORMA[m] ?? "Sin definir";
}
