"use client";

/**
 * ProveedorPicker — buscador de proveedor (una sola selección) con "crear nuevo"
 * inline, autocontenido: carga la lista de proveedores activos por su cuenta.
 *
 * Mismo look & feel que el buscador de Nueva compra, extraído para reusarse en
 * Nueva orden de compra (y donde haga falta elegir/crear un proveedor).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { getProveedores, createProveedor, proveedorExiste } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";
import { productoMatchesQuery } from "@/lib/productos/token-search";

const inputSmClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 focus:border-[#4FAEB2] bg-white text-sm";
const labelSmClass = "block text-xs font-medium text-slate-600 mb-1.5";

export default function ProveedorPicker({
  value,
  onChange,
}: {
  value: string;
  /** Devuelve el id (o "" al limpiar) y el nombre del proveedor elegido. */
  onChange: (id: string, nombre: string) => void;
}) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Crear nuevo (inline)
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  const [errorRuc, setErrorRuc] = useState<string | null>(null);
  const [creado, setCreado] = useState<string | null>(null);

  async function recargar() {
    const data = await getProveedores();
    setProveedores(data.filter((p) => p.estado === "activo"));
  }
  useEffect(() => { recargar(); }, []);

  const selected = useMemo(() => proveedores.find((p) => String(p.id) === value) ?? null, [proveedores, value]);

  const resultados = useMemo(() => {
    const filt = query.trim()
      ? proveedores.filter((p) => productoMatchesQuery(query, p.nombre, p.ruc))
      : proveedores;
    return filt.slice(0, 50);
  }, [proveedores, query]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (open && hl >= 0) listRef.current?.querySelector(`[data-idx="${hl}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, hl]);

  function pick(p: Proveedor) {
    onChange(String(p.id), p.nombre);
    setCreado(null);
    setQuery("");
    setOpen(false);
    setHl(-1);
  }

  function onFormChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.name === "ruc") setErrorRuc(null);
    const { name, value: v, type } = e.target;
    let normalized = v;
    if (name === "email" || type === "email") normalized = v.toLowerCase();
    else if (["nombre", "contacto"].includes(name)) normalized = v.toUpperCase();
    setForm((prev) => ({ ...prev, [name]: normalized }));
  }

  async function guardarNuevo() {
    if (!form.nombre.trim() || !form.ruc.trim()) return;
    setErrorRuc(null);
    const dup = await proveedorExiste(form.ruc);
    if (dup) { setErrorRuc(`RUC ya registrado para "${dup.nombre}".`); return; }
    const res = await createProveedor({
      nombre: form.nombre.trim().toUpperCase(), ruc: form.ruc.trim(),
      telefono: form.telefono.trim(), email: form.email.trim(),
      contacto: form.contacto.trim().toUpperCase(), direccion: "", estado: "activo",
    });
    if (!res.ok) { setErrorRuc(res.error); return; }
    await recargar();
    onChange(String(res.proveedor.id), res.proveedor.nombre);
    setCreado(res.proveedor.nombre);
    setMostrarForm(false);
    setForm({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  }

  function cancelarNuevo() {
    setMostrarForm(false);
    setForm({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
    setErrorRuc(null);
  }

  return (
    <div>
      {selected ? (
        <div className="flex h-[42px] items-center justify-between gap-2 rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.06] px-3 shadow-sm">
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold text-slate-800">{selected.nombre}</span>
            {selected.ruc && <span className="ml-2 text-xs text-slate-500">RUC {selected.ruc}</span>}
          </span>
          <button
            type="button"
            onClick={() => { onChange("", ""); setQuery(""); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
            aria-label="Cambiar proveedor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div ref={boxRef} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setHl(-1); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHl((h) => Math.min(h + 1, resultados.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (open && hl >= 0 && resultados[hl]) pick(resultados[hl]); }
              else if (e.key === "Escape") { setOpen(false); }
            }}
            placeholder="Buscar proveedor por nombre o RUC…"
            autoComplete="off"
            className="h-[42px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm shadow-sm outline-none transition-all placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
          {open && (
            <div className="absolute left-0 right-0 z-50 mt-1.5">
              <ul ref={listRef} className="max-h-[260px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-[#4FAEB2]/15">
                {resultados.length === 0 ? (
                  <li className="px-3 py-3 text-center text-xs text-slate-400">
                    {proveedores.length === 0 ? "No hay proveedores. Creá uno abajo." : "Sin proveedores que coincidan."}
                  </li>
                ) : (
                  resultados.map((p, i) => (
                    <li key={p.id}>
                      <button type="button" data-idx={i}
                        onMouseEnter={() => setHl(i)} onClick={() => pick(p)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          i === hl ? "bg-[#4FAEB2]/10 text-[#2F6E71]" : "text-slate-700 hover:bg-slate-50"
                        }`}>
                        <span className="min-w-0 flex-1 truncate font-medium">{p.nombre}</span>
                        {p.ruc && <span className="shrink-0 text-xs text-slate-400">RUC {p.ruc}</span>}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {creado && <p className="mt-1.5 text-xs text-green-600">✓ Proveedor &quot;{creado}&quot; creado y seleccionado.</p>}

      {!mostrarForm ? (
        <button type="button" onClick={() => { setMostrarForm(true); setCreado(null); }}
          className="mt-2 text-xs text-slate-400 underline transition-colors hover:text-slate-700">
          ¿No encontrás el proveedor? Crear nuevo
        </button>
      ) : (
        <div className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Nuevo proveedor</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelSmClass}>Nombre / Razón social <span className="text-red-500">*</span></label>
              <input type="text" name="nombre" value={form.nombre} onChange={onFormChange}
                placeholder="Ej: DISTRIBUIDORA SUR S.A." className={`${inputSmClass} uppercase`} />
            </div>
            <div>
              <label className={labelSmClass}>RUC <span className="text-red-500">*</span></label>
              <input type="text" name="ruc" value={form.ruc} onChange={onFormChange}
                placeholder="Ej: 80012345-1" className={`${inputSmClass} ${errorRuc ? "border-red-300 bg-red-50" : ""}`} />
              {errorRuc && <p className="mt-1 text-xs text-red-600">{errorRuc}</p>}
            </div>
            <div>
              <label className={labelSmClass}>Teléfono</label>
              <input type="text" name="telefono" value={form.telefono} onChange={onFormChange}
                placeholder="Ej: 0981 111 222" className={inputSmClass} />
            </div>
            <div>
              <label className={labelSmClass}>Email</label>
              <input type="email" name="email" value={form.email} onChange={onFormChange}
                placeholder="Ej: ventas@empresa.com" className={inputSmClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelSmClass}>Persona de contacto</label>
              <input type="text" name="contacto" value={form.contacto} onChange={onFormChange}
                placeholder="Ej: CARLOS MENDOZA" className={`${inputSmClass} uppercase`} />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={guardarNuevo} disabled={!form.nombre.trim() || !form.ruc.trim()}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-40">
              Guardar proveedor
            </button>
            <button type="button" onClick={cancelarNuevo}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs transition-colors hover:bg-slate-50">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
