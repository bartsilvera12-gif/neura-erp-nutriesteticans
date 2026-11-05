"use client";

/**
 * Panel de Pagos de una compra. Solo tiene sentido cuando la compra es a
 * crédito (muestra saldo + permite registrar un pago). Para contado muestra
 * la lista de pagos existentes (si los hay) en modo lectura.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, DollarSign, Trash2 } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import ConfirmModal from "@/components/ui/ConfirmModal";
import {
  anularCompraPago,
  getCompraPagos,
  registrarCompraPago,
  type CompraPago,
  type CompraResumen,
} from "@/lib/compras/storage";

function fmtGs(v: number) { return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`; }

export default function CompraPagosPanel({
  numeroControl,
  onChange,
}: {
  numeroControl: string;
  /** Avisa al padre si hubo un cambio (para refrescar listados externos). */
  onChange?: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [resumen, setResumen] = useState<CompraResumen | null>(null);
  const [pagos, setPagos] = useState<CompraPago[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [agregarOpen, setAgregarOpen] = useState(false);
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [monto, setMonto] = useState<number>(0);
  const [medio, setMedio] = useState("efectivo");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [pagoAAnular, setPagoAAnular] = useState<CompraPago | null>(null);
  const [anulandoPago, setAnulandoPago] = useState(false);

  const recargar = useCallback(async () => {
    setError(null);
    const r = await getCompraPagos(numeroControl);
    if (!r.ok) { setError(r.error); setCargando(false); return; }
    setResumen(r.resumen);
    setPagos(r.pagos);
    setCargando(false);
  }, [numeroControl]);

  useEffect(() => { recargar(); }, [recargar]);

  const saldo = resumen?.saldo ?? 0;
  const esCredito = resumen?.tipo_pago === "credito";
  const anulada = resumen?.estado === "anulada";

  // Sugerir el saldo cuando se abre el modal.
  useEffect(() => {
    if (agregarOpen) { setMonto(saldo > 0 ? saldo : 0); setObs(""); setMedio("efectivo"); }
  }, [agregarOpen, saldo]);

  async function guardarPago() {
    if (!(monto > 0)) { setError("El monto debe ser mayor a 0."); return; }
    if (monto > saldo + 0.009) { setError(`El monto supera el saldo (${fmtGs(saldo)}).`); return; }
    setGuardando(true);
    const r = await registrarCompraPago(numeroControl, { fecha, monto, medio_pago: medio, observacion: obs.trim() || null });
    setGuardando(false);
    if (!r.ok) { setError(r.error); return; }
    setAgregarOpen(false);
    await recargar();
    onChange?.();
  }

  async function anularPago() {
    if (!pagoAAnular) return;
    setAnulandoPago(true);
    const r = await anularCompraPago(numeroControl, pagoAAnular.id, "Anulado desde la UI");
    setAnulandoPago(false);
    if (!r.ok) { setError(r.error); return; }
    setPagoAAnular(null);
    await recargar();
    onChange?.();
  }

  const pagosActivos = useMemo(() => pagos.filter((p) => !p.anulado_at), [pagos]);

  if (cargando) {
    return (
      <section className="rounded-2xl border-2 border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-400 animate-pulse">Cargando pagos…</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-emerald-200/60 bg-white shadow-[0_2px_10px_-2px_rgba(16,185,129,0.12)]">
      <div className="flex items-center justify-between gap-2 border-b border-emerald-200/40 bg-gradient-to-r from-emerald-50 to-transparent px-5 py-3.5">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-600" />
          <h2 className="text-[15px] font-bold text-slate-800">Pagos de la compra</h2>
        </div>
        {esCredito && !anulada && saldo > 0 && (
          <button
            type="button"
            onClick={() => setAgregarOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" /> Registrar pago
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {resumen && (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Total</p>
              <p className="mt-0.5 font-bold text-slate-800">{fmtGs(resumen.total)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-emerald-700">Pagado</p>
              <p className="mt-0.5 font-bold text-emerald-700">{fmtGs(resumen.pagado)}</p>
            </div>
            <div className={`rounded-xl border px-3 py-2.5 ${saldo > 0 ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <p className={`text-[11px] uppercase tracking-wide ${saldo > 0 ? "text-amber-700" : "text-emerald-700"}`}>Saldo</p>
              <p className={`mt-0.5 font-bold ${saldo > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmtGs(saldo)}</p>
            </div>
          </div>
        )}

        {!esCredito && pagosActivos.length === 0 && (
          <p className="text-xs text-slate-500">Esta compra fue al contado. No se registran pagos adicionales.</p>
        )}

        {anulada && (
          <p className="text-xs text-rose-600">La compra está anulada; no acepta nuevos pagos.</p>
        )}

        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

        {pagos.length === 0 ? (
          esCredito && !anulada && (
            <p className="text-xs text-slate-500">
              No hay pagos registrados. Tocá <span className="font-semibold">Registrar pago</span> para cargar el primero.
            </p>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="pb-2">Fecha</th>
                  <th className="pb-2">Medio</th>
                  <th className="pb-2 text-right">Monto</th>
                  <th className="pb-2">Observación</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagos.map((p) => (
                  <tr key={p.id} className={p.anulado_at ? "text-slate-400 line-through" : "text-slate-700"}>
                    <td className="py-2">{p.fecha}</td>
                    <td className="py-2 capitalize">{p.medio_pago}</td>
                    <td className="py-2 text-right font-semibold">{fmtGs(p.monto)}</td>
                    <td className="py-2 text-xs">{p.observacion ?? ""}</td>
                    <td className="py-2 text-right">
                      {!p.anulado_at && !anulada && (
                        <button
                          type="button"
                          onClick={() => setPagoAAnular(p)}
                          className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800"
                          title="Anular pago"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Registrar pago */}
      {agregarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => !guardando && setAgregarOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-800">Registrar pago</h3>
            <p className="mt-0.5 text-xs text-slate-500">Compra {numeroControl} · Saldo {fmtGs(saldo)}</p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Fecha *</span>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Monto *</span>
                <MontoInput value={monto} onChange={setMonto} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Medio de pago</span>
                <select
                  value={medio}
                  onChange={(e) => setMedio(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="cheque">Cheque</option>
                  <option value="otro">Otro</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Observación</span>
                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Opcional"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAgregarOpen(false)}
                disabled={guardando}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardarPago}
                disabled={guardando || !(monto > 0)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Guardar pago
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!pagoAAnular}
        title="Anular pago"
        message={pagoAAnular ? `¿Anular el pago del ${pagoAAnular.fecha} por ${fmtGs(pagoAAnular.monto)}?` : ""}
        confirmLabel="Anular pago"
        loading={anulandoPago}
        onCancel={() => setPagoAAnular(null)}
        onConfirm={anularPago}
      />
    </section>
  );
}
