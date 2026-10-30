"use client";

import Link from "next/link";
import { AlertTriangle, Check, Clock3, Printer } from "lucide-react";

type PasoFacturacion = "venta" | "firma" | "set";

type DocumentosFactura = {
  numeroFactura: string | null;
  facturaId: string | null;
  kudeUrl: string | null;
  ticketUrl: string;
};

export type FacturacionProgreso =
  | { fase: "procesando"; paso: PasoFacturacion }
  | ({ fase: "aprobada" } & DocumentosFactura)
  | ({ fase: "pendiente" | "error"; titulo: string; mensaje: string } & DocumentosFactura);

const PASOS: { id: PasoFacturacion; label: string }[] = [
  { id: "venta", label: "Registrando la venta" },
  { id: "firma", label: "Generando y firmando la factura" },
  { id: "set", label: "Esperando la aprobación de la SET" },
];

interface Props {
  progreso: FacturacionProgreso;
  onNuevaVenta: () => void;
  onVerVentas: () => void;
}

const BOTON_SECUNDARIO =
  "min-h-[44px] flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";

export default function FacturacionProgressOverlay({ progreso, onNuevaVenta, onVerVentas }: Props) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-8"
      >
        {progreso.fase === "procesando" ? (
          <Procesando paso={progreso.paso} />
        ) : (
          <Resultado progreso={progreso} onNuevaVenta={onNuevaVenta} onVerVentas={onVerVentas} />
        )}
      </div>
    </div>
  );
}

function Procesando({ paso }: { paso: PasoFacturacion }) {
  const actual = PASOS.findIndex((p) => p.id === paso);
  return (
    <>
      <div className="flex flex-col items-center text-center">
        <div className="relative h-16 w-16" aria-hidden>
          <span className="absolute inset-0 rounded-full border-4 border-[#0EA5E9]/15" />
          <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-[#0EA5E9] motion-reduce:animate-none" />
          <span className="absolute inset-[18px] animate-pulse rounded-full bg-[#0EA5E9]/25 motion-reduce:animate-none" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Emitiendo tu factura</h2>
        <p className="mt-1 text-sm text-slate-500">No cierres esta pantalla.</p>
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div
          className="h-full rounded-full bg-[#0EA5E9] transition-all duration-700 ease-out"
          style={{ width: `${((actual + 0.6) / PASOS.length) * 100}%` }}
        />
      </div>

      <ol className="mt-5 space-y-3">
        {PASOS.map((p, i) => {
          const hecho = i < actual;
          const activo = i === actual;
          return (
            <li key={p.id} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  hecho
                    ? "bg-[#0EA5E9] text-white"
                    : activo
                      ? "border-2 border-[#0EA5E9]"
                      : "border-2 border-slate-200"
                }`}
              >
                {hecho && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                {activo && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#0EA5E9] motion-reduce:animate-none" />
                )}
              </span>
              <span className={activo ? "font-medium text-slate-900" : hecho ? "text-slate-600" : "text-slate-400"}>
                {p.label}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Resultado({
  progreso,
  onNuevaVenta,
  onVerVentas,
}: {
  progreso: Exclude<FacturacionProgreso, { fase: "procesando" }>;
  onNuevaVenta: () => void;
  onVerVentas: () => void;
}) {
  const aprobada = progreso.fase === "aprobada";
  const error = progreso.fase === "error";
  const titulo = aprobada ? "Factura aprobada por la SET" : progreso.titulo;
  const mensaje = aprobada ? progreso.numeroFactura : progreso.mensaje;
  const urlImpresion = progreso.kudeUrl ?? (error ? progreso.ticketUrl : null);

  return (
    <div className="flex flex-col items-center text-center">
      <span
        className={`flex h-16 w-16 items-center justify-center rounded-full ${
          aprobada ? "bg-emerald-100 text-emerald-600" : error ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
        }`}
      >
        {aprobada ? (
          <Check className="h-8 w-8" strokeWidth={3} />
        ) : error ? (
          <AlertTriangle className="h-8 w-8" />
        ) : (
          <Clock3 className="h-8 w-8" />
        )}
      </span>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">{titulo}</h2>
      {mensaje && <p className="mt-1 break-words text-sm text-slate-500">{mensaje}</p>}

      <div className="mt-6 w-full space-y-2">
        {urlImpresion && (
          <a
            href={urlImpresion}
            target="_blank"
            rel="noopener"
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#0EA5E9] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#0284C7]"
          >
            <Printer className="h-4 w-4" />
            {progreso.kudeUrl ? "Imprimir factura" : "Imprimir ticket"}
          </a>
        )}
        {!aprobada && progreso.facturaId && (
          <Link
            href={`/facturas/${progreso.facturaId}`}
            className="flex min-h-[44px] w-full items-center justify-center rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Ver detalle de la factura
          </Link>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onVerVentas} className={BOTON_SECUNDARIO}>
            Ver ventas
          </button>
          <button type="button" onClick={onNuevaVenta} className={BOTON_SECUNDARIO}>
            Nueva venta
          </button>
        </div>
      </div>
    </div>
  );
}
