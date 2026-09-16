"use client";

/**
 * Modal de confirmación reutilizable para acciones irreversibles.
 *
 * Detalles pensados para que una confirmación no se dispare sola:
 *  - El foco inicial va al botón "Cancelar" (la opción segura), no al de
 *    confirmar.
 *  - Escape cancela.
 *  - El Enter que pudo haber abierto el modal NO confirma de inmediato: el
 *    handler de confirmar se habilita un tick después de montar.
 *  - `loading` (o el propio guard del padre) deshabilita ambos botones para
 *    evitar doble ejecución.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estilo del botón de confirmar. */
  tone?: "primary" | "danger";
  /** Deshabilita los botones mientras corre la acción (guard anti doble clic). */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "primary",
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // El confirmar recién se arma un tick después de abrir, para que el mismo
  // Enter/click que abrió el modal no lo confirme en el mismo gesto.
  const [armado, setArmado] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setArmado(true), 150);
    // Foco en Cancelar al abrir.
    const f = setTimeout(() => cancelRef.current?.focus(), 0);
    // El reset va en el cleanup: al cerrar (open→false) se desarma sin llamar
    // setState en el cuerpo del effect.
    return () => { clearTimeout(t); clearTimeout(f); setArmado(false); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); if (!loading) onCancel(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const confirmClasses =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-[#4FAEB2] hover:bg-[#3F8E91]";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => { if (!loading) onCancel(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <div className="mt-2 text-sm text-slate-600">{message}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => { if (armado && !loading) onConfirm(); }}
            disabled={!armado || loading}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${confirmClasses}`}
          >
            {loading ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
