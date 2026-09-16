"use client";

/**
 * Buscador de productos reutilizable (inline, con autocomplete).
 *
 * Pensado para flujos donde se cargan productos por teclado (compra manual,
 * órdenes de compra). Busca del lado del servidor reutilizando el endpoint de
 * búsqueda multi-token, así encuentra por nombre, SKU, código de barras,
 * categoría, proveedor y ubicación, en cualquier orden de palabras.
 *
 * NO trae ningún control propio de ventas (IVA, tipo de precio, "agregar a la
 * venta"): solo selecciona un producto y delega en `onSelect`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { formatStockConUnidad } from "@/lib/productos/unidades";

export interface ProductoHit {
  id: string;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  unidad_medida: string;
  stock_actual: number;
  costo_promedio: number;
  precio_venta: number;
  categoria_nombre: string | null;
  proveedor_nombre: string | null;
  ubicacion_nombre: string | null;
  es_vendible: boolean;
  es_insumo: boolean;
  controla_stock: boolean;
}

interface Props {
  onSelect: (p: ProductoHit) => void;
  /** Productos ya cargados: no se ofrecen de nuevo. */
  excludeIds?: string[];
  /** Endpoint de búsqueda. Por defecto el de compras (incluye no vendibles). */
  searchUrl?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

const fmtGs = (n: number) =>
  "Gs. " + Math.round(Number(n) || 0).toLocaleString("es-PY");

export default function ProductoBuscadorInline({
  onSelect,
  excludeIds = [],
  searchUrl = "/api/productos/search-compras",
  placeholder = "Buscar por nombre, SKU, código, categoría, proveedor…",
  autoFocus = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(-1);
  const [items, setItems] = useState<ProductoHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reqId = useRef(0);

  const excluidos = new Set(excludeIds);
  const visibles = items.filter((p) => !excluidos.has(p.id));

  // Búsqueda server-side con debounce. Cada respuesta lleva el id de su
  // request: si llega una vieja después de una nueva, se descarta.
  const buscar = useCallback(
    async (q: string) => {
      const mine = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${searchUrl}?q=${encodeURIComponent(q)}&limit=30`, {
          credentials: "include",
          cache: "no-store",
        });
        const j = await r.json().catch(() => null);
        if (mine !== reqId.current) return; // respuesta obsoleta
        if (!r.ok || j?.success === false) {
          setItems([]);
          setError(j?.error ?? "No se pudo buscar productos.");
          return;
        }
        setItems((j.data?.items ?? []) as ProductoHit[]);
      } catch {
        if (mine !== reqId.current) return;
        setItems([]);
        setError("Error de conexión al buscar.");
      } finally {
        if (mine === reqId.current) setLoading(false);
      }
    },
    [searchUrl]
  );

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    // No buscar con query vacía: evita traer TODOS los productos y tapar la
    // pantalla al enfocar. Los resultados se muestran solo al escribir.
    if (q === "") {
      setItems([]);
      return;
    }
    const t = setTimeout(() => buscar(q), 220);
    return () => clearTimeout(t);
  }, [query, open, buscar]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (open && hl >= 0) {
      listRef.current?.querySelector(`[data-idx="${hl}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, hl]);

  function pick(p: ProductoHit) {
    onSelect(p);
    setQuery("");
    setItems([]);
    setHl(-1);
    // Queda enfocado y abierto para cargar el siguiente producto.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {loading && (
        <Loader2 className="pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 animate-spin text-[#4FAEB2]" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHl(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHl((h) => Math.min(h + 1, visibles.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && hl >= 0 && visibles[hl]) pick(visibles[hl]); }
          else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm shadow-sm outline-none transition-all placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
      />
      {open && query.trim().length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1.5">
          <ul ref={listRef} className="max-h-[min(50vh,320px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-[#4FAEB2]/15">
            {error ? (
              <li className="px-3 py-3 text-center text-xs text-red-500">{error}</li>
            ) : loading && visibles.length === 0 ? (
              <li className="px-3 py-3 text-center text-xs text-slate-400">Buscando…</li>
            ) : visibles.length === 0 ? (
              <li className="px-3 py-3 text-center text-xs text-slate-400">
                {query.trim() ? "Sin productos que coincidan." : "Escribí para buscar un producto."}
              </li>
            ) : (
              visibles.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    data-idx={i}
                    onMouseEnter={() => setHl(i)}
                    onClick={() => pick(p)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      i === hl ? "bg-[#4FAEB2]/10 text-[#2F6E71]" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        <span className="font-medium">{p.nombre}</span>
                        <span className="ml-2 font-mono text-xs text-slate-400">{p.sku}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                        {formatStockConUnidad(p.stock_actual, p.unidad_medida)} · costo {fmtGs(p.costo_promedio)}
                        {p.categoria_nombre ? ` · ${p.categoria_nombre}` : ""}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${p.stock_actual <= 0 ? "text-amber-500" : "text-slate-400"}`}>
                      {p.stock_actual <= 0 ? "sin stock" : ""}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
