"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, X, Check } from "lucide-react";

export type SmartOption = {
  id: string;
  /** Texto principal (ej. nombre del producto). */
  label: string;
  /** Línea secundaria (ej. "SKU-001 · stock: 4"). */
  sub?: string;
  /** Texto extra que también se busca pero no se muestra (ej. RUC, código de barras). */
  keywords?: string;
};

/** Normaliza para búsqueda: minúsculas y sin acentos. */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Puntaje de coincidencia. Mayor = mejor.
 * Todos los términos deben aparecer (búsqueda AND), en label/sub/keywords.
 * Prioriza: label empieza con el término > palabra del label empieza > contiene.
 */
function score(opt: SmartOption, terms: string[]): number {
  const label = norm(opt.label);
  const hay = `${label} ${norm(opt.sub ?? "")} ${norm(opt.keywords ?? "")}`;
  let total = 0;
  for (const t of terms) {
    if (!hay.includes(t)) return -1; // debe estar en algún campo
    if (label.startsWith(t)) total += 100;
    else if (label.split(/[\s/\-.]+/).some((w) => w.startsWith(t))) total += 60;
    else if (label.includes(t)) total += 30;
    else total += 10; // solo en sub/keywords
  }
  return total;
}

/** Parte el texto para resaltar las coincidencias. */
function highlight(text: string, terms: string[]) {
  if (terms.length === 0) return text;
  const n = norm(text);
  const marks: boolean[] = new Array(text.length).fill(false);
  for (const t of terms) {
    let from = 0;
    while (true) {
      const i = n.indexOf(t, from);
      if (i < 0) break;
      for (let k = i; k < i + t.length && k < marks.length; k++) marks[k] = true;
      from = i + t.length;
    }
  }
  const out: React.ReactNode[] = [];
  let buf = "";
  let cur = marks[0] ?? false;
  for (let i = 0; i < text.length; i++) {
    if ((marks[i] ?? false) !== cur) {
      out.push(cur ? <mark key={i} className="rounded bg-amber-200/70 px-0 text-inherit">{buf}</mark> : buf);
      buf = "";
      cur = marks[i] ?? false;
    }
    buf += text[i];
  }
  if (buf) out.push(cur ? <mark key="last" className="rounded bg-amber-200/70 px-0 text-inherit">{buf}</mark> : buf);
  return out;
}

/**
 * Combobox con búsqueda inteligente: escribís y filtra al instante.
 * - Multi-término sin orden ("compresor 100" encuentra "Compresor power de 100 litros").
 * - Ignora acentos y mayúsculas; busca también en SKU/RUC (`sub` / `keywords`).
 * - Navegación con ↑ ↓, Enter para elegir, Esc para cerrar.
 * Reemplaza a un <select> sin cambiar la lógica del formulario.
 */
export default function SmartSearchSelect({
  options,
  value,
  onChange,
  placeholder = "Buscar…",
  emptyText = "Sin resultados",
  required = false,
  name,
  maxResults = 50,
}: {
  options: SmartOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  required?: boolean;
  name?: string;
  maxResults?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const terms = useMemo(
    () => norm(query).split(/\s+/).filter(Boolean),
    [query]
  );

  const results = useMemo(() => {
    if (terms.length === 0) return options.slice(0, maxResults);
    return options
      .map((o) => ({ o, s: score(o, terms) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.o.label.localeCompare(b.o.label))
      .slice(0, maxResults)
      .map((x) => x.o);
  }, [options, terms, maxResults]);

  /** Cerrar al hacer clic fuera. */
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  /** Mantener la opción activa a la vista. */
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) choose(r.id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const base =
    "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white text-sm";

  return (
    <div ref={boxRef} className="relative">
      {/* Valor real para validación nativa del form */}
      {name && (
        <input
          type="text"
          name={name}
          value={value}
          required={required}
          onChange={() => {}}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      )}

      {open ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className={`${base} pl-9 pr-8`}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`${base} flex items-center justify-between gap-2 text-left`}
        >
          <span className={`min-w-0 flex-1 truncate ${selected ? "text-slate-900" : "text-slate-400"}`}>
            {selected ? selected.label : placeholder}
            {selected?.sub && <span className="ml-2 text-xs text-slate-400">{selected.sub}</span>}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      )}

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-slate-400">{emptyText}</li>
          ) : (
            results.map((o, i) => {
              const isSel = o.id === value;
              return (
                <li
                  key={o.id}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); choose(o.id); }}
                  className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${
                    i === active ? "bg-sky-50" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-800">{highlight(o.label, terms)}</span>
                    {o.sub && (
                      <span className="block truncate text-xs text-slate-500">{highlight(o.sub, terms)}</span>
                    )}
                  </span>
                  {isSel && <Check className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />}
                </li>
              );
            })
          )}
          {options.length > results.length && terms.length === 0 && (
            <li className="px-3 py-1.5 text-center text-[11px] text-slate-400">
              Mostrando {results.length} de {options.length} — escribí para buscar
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
