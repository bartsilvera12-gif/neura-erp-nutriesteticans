"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, Plus, Printer, Ban, Search, Loader2, X } from "lucide-react";
import {
  fetchRecibos,
  crearReciboManual,
  anularRecibo,
  abrirReciboPdf,
  type Recibo,
  type ReciboOrigen,
} from "@/lib/recibos/client";
import { FancySelect } from "@/components/ui/FancySelect";
import MontoInput from "@/components/ui/MontoInput";

const ORIGEN_LABEL: Record<ReciboOrigen, string> = {
  venta_contado: "Venta contado",
  cobro_cxc: "Cobro de cuenta",
  manual: "Manual",
};

const ORIGEN_TONE: Record<ReciboOrigen, string> = {
  venta_contado: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cobro_cxc: "bg-sky-50 text-sky-700 ring-sky-200",
  manual: "bg-amber-50 text-amber-700 ring-amber-200",
};

const METODOS = ["efectivo", "transferencia", "tarjeta", "cheque", "otro"];

function fmtMonto(monto: number, moneda: string): string {
  const n = Number(monto) || 0;
  return moneda === "USD"
    ? `USD ${n.toLocaleString("es-PY", { minimumFractionDigits: 2 })}`
    : `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

function fmtFecha(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

export default function RecibosPage() {
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [origen, setOrigen] = useState<ReciboOrigen | "">("");
  const [buscar, setBuscar] = useState("");
  const [incluirAnulados, setIncluirAnulados] = useState(false);

  const [modalAbierto, setModalAbierto] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const r = await fetchRecibos({
      desde: desde || undefined,
      hasta: hasta || undefined,
      origen: origen || undefined,
      buscar: buscar || undefined,
      incluirAnulados,
    });
    if (r.ok) setRecibos(r.data.recibos);
    else setError(r.error);
    setCargando(false);
  }, [desde, hasta, origen, buscar, incluirAnulados]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const totales = useMemo(() => {
    const vivos = recibos.filter((r) => !r.anulado);
    return {
      cantidad: vivos.length,
      gs: vivos.filter((r) => r.moneda !== "USD").reduce((s, r) => s + (Number(r.monto) || 0), 0),
      usd: vivos.filter((r) => r.moneda === "USD").reduce((s, r) => s + (Number(r.monto) || 0), 0),
    };
  }, [recibos]);

  async function handleAnular(r: Recibo) {
    const motivo = window.prompt(`Anular el recibo ${r.numero_recibo}. Motivo (opcional):`);
    if (motivo === null) return;
    const res = await anularRecibo(r.id, motivo);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    void cargar();
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Receipt className="h-6 w-6 text-[#4FAEB2]" />
            Recibos de dinero
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Comprobante interno de dinero recibido. No es un documento fiscal.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalAbierto(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
        >
          <Plus className="h-4 w-4" />
          Emitir recibo
        </button>
      </div>

      {/* Filtros */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className={labelCls}>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Origen</label>
            <FancySelect
              ariaLabel="Origen del recibo"
              value={origen}
              onChange={(v) => setOrigen(v as ReciboOrigen | "")}
              options={[
                { value: "", label: "Todos" },
                { value: "venta_contado", label: "Venta contado" },
                { value: "cobro_cxc", label: "Cobro de cuenta" },
                { value: "manual", label: "Manual" },
              ]}
            />
          </div>
          <div className="lg:col-span-2">
            <label className={labelCls}>Buscar</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Nº de recibo, cliente o concepto…"
                className={`${inputCls} pl-9`}
              />
            </div>
          </div>
        </div>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={incluirAnulados}
            onChange={(e) => setIncluirAnulados(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Mostrar anulados
        </label>
      </div>

      {/* Totales */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Recibos</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totales.cantidad}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total guaraníes</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">Gs. {Math.round(totales.gs).toLocaleString("es-PY")}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total dólares</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            USD {totales.usd.toLocaleString("es-PY", { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Listado */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {error ? (
          <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>
        ) : cargando ? (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando recibos…
          </p>
        ) : recibos.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500">Todavía no hay recibos.</p>
            <button
              type="button"
              onClick={() => setModalAbierto(true)}
              className="mt-2 text-sm font-medium text-[#3F8E91] hover:underline"
            >
              Emitir el primero →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Nº</th>
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Origen</th>
                  <th className="px-4 py-3 text-left">Concepto</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recibos.map((r) => (
                  <tr key={r.id} className={r.anulado ? "bg-slate-50/60 text-slate-400" : "hover:bg-slate-50/60"}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold">
                      {r.numero_recibo}
                      {r.anulado && (
                        <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ring-red-200 bg-red-50 text-red-600">
                          Anulado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs">{fmtFecha(r.fecha)}</td>
                    <td className="px-4 py-3">
                      <span className="block font-medium">{r.cliente_nombre}</span>
                      {r.cliente_documento && (
                        <span className="block text-xs text-slate-400">{r.cliente_documento}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${ORIGEN_TONE[r.origen]}`}>
                        {ORIGEN_LABEL[r.origen]}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-slate-600">{r.concepto ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                      {fmtMonto(r.monto, r.moneda)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => abrirReciboPdf(r.id)}
                          title="Imprimir recibo"
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition-colors hover:border-[#4FAEB2] hover:text-[#3F8E91]"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        {!r.anulado && (
                          <button
                            type="button"
                            onClick={() => handleAnular(r)}
                            title="Anular recibo"
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition-colors hover:border-red-300 hover:text-red-600"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalAbierto && (
        <ModalReciboManual
          onClose={() => setModalAbierto(false)}
          onCreado={(id) => {
            setModalAbierto(false);
            void cargar();
            abrirReciboPdf(id);
          }}
        />
      )}
    </div>
  );
}

/** Alta de recibo manual: dinero recibido que no viene de una venta ni de un cobro. */
function ModalReciboManual({
  onClose,
  onCreado,
}: {
  onClose: () => void;
  onCreado: (id: string) => void;
}) {
  const [clienteNombre, setClienteNombre] = useState("");
  const [monto, setMonto] = useState(0);
  const [moneda, setMoneda] = useState("PYG");
  const [metodo, setMetodo] = useState("efectivo");
  const [referencia, setReferencia] = useState("");
  const [concepto, setConcepto] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const montoNum = Number(monto);
  const valido = Number.isFinite(montoNum) && montoNum > 0;

  async function guardar() {
    if (!valido) {
      setErr("Ingresá un monto mayor a 0.");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await crearReciboManual({
      cliente_nombre: clienteNombre.trim() || null,
      monto: montoNum,
      moneda,
      metodo_pago: metodo,
      referencia: referencia.trim() || undefined,
      concepto: concepto.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    onCreado(r.data.recibo.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Receipt className="h-5 w-5 text-[#4FAEB2]" />
            Emitir recibo de dinero
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className={labelCls}>Recibí de</label>
            <input
              value={clienteNombre}
              onChange={(e) => setClienteNombre(e.target.value)}
              placeholder="Nombre de quien entrega el dinero"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-slate-400">Si lo dejás vacío se emite a &quot;Consumidor final&quot;.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Monto <span className="text-red-500">*</span></label>
              <MontoInput value={monto} onChange={setMonto} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Moneda</label>
              <FancySelect
                ariaLabel="Moneda"
                value={moneda}
                onChange={setMoneda}
                options={[
                  { value: "PYG", label: "Guaraníes" },
                  { value: "USD", label: "Dólares" },
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Método de pago</label>
              <FancySelect
                ariaLabel="Método de pago"
                value={metodo}
                onChange={setMetodo}
                options={METODOS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))}
              />
            </div>
            <div>
              <label className={labelCls}>Referencia</label>
              <input
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="Nº de transferencia, cheque…"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Concepto</label>
            <input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="En concepto de…"
              className={inputCls}
            />
          </div>

          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={busy || !valido}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Emitir e imprimir
          </button>
        </div>
      </div>
    </div>
  );
}
