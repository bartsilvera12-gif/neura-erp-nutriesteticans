"use client";

/**
 * Selector de estado de presupuesto: reemplaza el <select> nativo por un
 * dropdown vistoso (punto de color por estado + check en el actual). El panel
 * se posiciona con `position: fixed` anclado al trigger para no quedar recortado
 * por el `overflow-x-auto` del contenedor de la tabla.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Check } from "lucide-react";
import { ESTADO_LABEL, type EstadoPresupuesto } from "@/lib/presupuestos/types";

const OPCIONES: EstadoPresupuesto[] = ["creado", "enviado", "aprobado", "rechazado"];

const BADGE: Record<EstadoPresupuesto, string> = {
  creado: "bg-slate-100 text-slate-700",
  enviado: "bg-sky-100 text-sky-700",
  aprobado: "bg-emerald-100 text-emerald-700",
  rechazado: "bg-red-100 text-red-700",
  convertido: "bg-violet-100 text-violet-700",
};
const DOT: Record<EstadoPresupuesto, string> = {
  creado: "bg-slate-400",
  enviado: "bg-sky-500",
  aprobado: "bg-emerald-500",
  rechazado: "bg-red-500",
  convertido: "bg-violet-500",
};

interface Props {
  value: EstadoPresupuesto;
  updating?: boolean;
  onChange: (nuevo: EstadoPresupuesto) => void;
  label?: string;
}

const PANEL_W = 176;
const PANEL_H = 168; // alto aprox del panel (4 opciones)

export default function EstadoSelect({ value, updating, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const reposicionar = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const abajo = r.bottom + PANEL_H + 8 > window.innerHeight;
    setCoords({
      top: abajo ? r.top - PANEL_H - 6 : r.bottom + 6,
      left: Math.min(r.left, window.innerWidth - PANEL_W - 8),
      up: abajo,
    });
  };

  useLayoutEffect(() => {
    if (open) reposicionar();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const cerrar = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [open]);

  function elegir(s: EstadoPresupuesto) {
    setOpen(false);
    if (s !== value) onChange(s);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={updating}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={`inline-flex h-8 w-36 items-center gap-2 rounded-lg pl-3 pr-2.5 text-xs font-semibold transition-shadow focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40 disabled:opacity-60 ${BADGE[value]} ${open ? "ring-2 ring-[#4FAEB2]/40" : ""}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[value]}`} aria-hidden />
        <span className="flex-1 text-left">{ESTADO_LABEL[value]}</span>
        {updating ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" />
        ) : (
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-70 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="listbox"
          style={{ position: "fixed", top: coords.top, left: coords.left, width: PANEL_W }}
          className="z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.28)]"
        >
          {OPCIONES.map((s) => {
            const activo = s === value;
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={activo}
                onClick={() => elegir(s)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  activo ? "bg-[#4FAEB2]/[0.10] text-slate-900" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[s]}`} aria-hidden />
                <span className="flex-1">{ESTADO_LABEL[s]}</span>
                {activo && <Check className="h-3.5 w-3.5 shrink-0 text-[#3F8E91]" />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
