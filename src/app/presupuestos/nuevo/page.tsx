"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft, Plus, Trash2, Loader2, Search, ImageIcon } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { calcMontoIvaIncluido, type IvaTipoPresupuesto, type CondicionPresupuesto } from "@/lib/presupuestos/types";

/** Miniatura de producto con fallback a un placeholder si no hay imagen o falla. */
function ProductoThumb({ url, alt }: { url?: string | null; alt: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-100 bg-slate-50 text-slate-300">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading="lazy" onError={() => setErr(true)} className="h-10 w-10 shrink-0 rounded-md border border-slate-100 object-cover" />;
}

/** Resultado del autocomplete de productos (búsqueda server-side, todo el catálogo). */
type ComboHit = {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
  unidad_medida: string;
  stock_actual: number;
  controla_stock: boolean;
  imagen_url: string | null;
};
type ClienteLite = {
  id: string;
  nombre: string;
  ruc: string | null;
  telefono: string | null;
  direccion: string | null;
};
type Item = {
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  unidad_medida: string | null;
  precio_unitario: number;
  iva_tipo: IvaTipoPresupuesto;
  descuento: number;
  /** Costo estimado por unidad. Interno: no sale en el PDF del cliente. */
  costo_unitario: number | null;
};

function fmtGs(n: number) {
  return "Gs. " + (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}
/** Muestra vacío cuando es 0 y sin ceros a la izquierda (evita el "0" pegado en inputs numéricos). */
function numInput(n: number): string {
  return !n || Number.isNaN(n) ? "" : String(n);
}
/** Parsea un input numérico entero quitando ceros a la izquierda; vacío/inválido → 0. */
function parseNumInput(s: string): number {
  const d = String(s).replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  return d === "" ? 0 : Number(d);
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function itemTotals(it: Item) {
  const bruto = (Number(it.precio_unitario) || 0) * (Number(it.cantidad) || 0);
  const total = Math.max(0, bruto - (Number(it.descuento) || 0));
  const iva = round2(calcMontoIvaIncluido(it.iva_tipo, total));
  return { total: round2(total), iva, subtotal: round2(total - iva) };
}

const IVAS: IvaTipoPresupuesto[] = ["10%", "5%", "EXENTA"];
const labelClass = "block text-xs font-medium text-gray-600 mb-1";
const inputClass = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

export default function NuevoPresupuestoPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<ClienteLite[]>([]);

  // Autocomplete de productos (mismo comportamiento que el buscador de Caja):
  // búsqueda server-side por tokens sobre TODO el catálogo, agrega al instante.
  const [comboQuery, setComboQuery] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [comboHits, setComboHits] = useState<ComboHit[]>([]);
  const [comboBuscando, setComboBuscando] = useState(false);
  const [comboHighlight, setComboHighlight] = useState(-1);
  const comboInputRef = useRef<HTMLInputElement>(null);
  const comboContainerRef = useRef<HTMLDivElement>(null);
  const comboTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cliente
  const [clienteId, setClienteId] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteRuc, setClienteRuc] = useState("");
  const [clienteTel, setClienteTel] = useState("");
  const [clienteDir, setClienteDir] = useState("");

  // Items
  const [items, setItems] = useState<Item[]>([]);

  // Condiciones
  const [condicion, setCondicion] = useState<CondicionPresupuesto>("contado");
  const [validezDias, setValidezDias] = useState("15");
  const [formaPago, setFormaPago] = useState("");
  const [plazoEntrega, setPlazoEntrega] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithSupabaseSession("/api/clientes", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && Array.isArray(j.data)) {
          const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
          setClientes(
            (j.data as Record<string, unknown>[]).map((r) => ({
              id: String(r.id),
              nombre: s(r.empresa) || s(r.nombre_contacto) || s(r.nombre) || "Cliente",
              ruc: s(r.ruc) || null,
              telefono: s(r.telefono) || null,
              direccion: s(r.direccion) || null,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  function seleccionarCliente(id: string) {
    setClienteId(id);
    const c = clientes.find((x) => x.id === id);
    if (c) {
      setClienteNombre(c.nombre);
      setClienteRuc(c.ruc ?? "");
      setClienteTel(c.telefono ?? "");
      setClienteDir(c.direccion ?? "");
    }
  }

  // Autocomplete: búsqueda server-side por tokens (todo el catálogo), con debounce.
  useEffect(() => {
    const q = comboQuery.trim();
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    if (q.length < 2) {
      setComboHits([]);
      setComboBuscando(false);
      return;
    }
    setComboBuscando(true);
    comboTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/productos/search?q=${encodeURIComponent(q)}&limit=20`,
          { cache: "no-store" }
        );
        const j = await res.json();
        const items = ((j?.data?.items ?? []) as Record<string, unknown>[]).map((p): ComboHit => ({
          id: String(p.id),
          nombre: String(p.nombre ?? ""),
          sku: String(p.sku ?? ""),
          precio_venta: Number(p.precio_venta) || 0,
          unidad_medida: String(p.unidad_medida ?? "UNIDAD"),
          stock_actual: Number(p.stock_actual) || 0,
          controla_stock: p.controla_stock !== false,
          imagen_url: (p.imagen_url as string | null) ?? null,
        }));
        setComboHits(items);
      } catch {
        setComboHits([]);
      } finally {
        setComboBuscando(false);
      }
    }, 220);
    return () => {
      if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    };
  }, [comboQuery]);

  // Cerrar el panel al hacer clic fuera.
  useEffect(() => {
    if (!comboOpen) return;
    function onDoc(e: MouseEvent) {
      if (comboContainerRef.current && !comboContainerRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [comboOpen]);

  /** Agrega un producto del inventario al instante: si ya está, suma +1; si no, crea la línea. */
  function agregarProductoRapido(p: ComboHit) {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.producto_id === p.id);
      if (idx >= 0) {
        return prev.map((it, i) => (i === idx ? { ...it, cantidad: (Number(it.cantidad) || 0) + 1 } : it));
      }
      return [
        ...prev,
        {
          producto_id: p.id,
          producto_nombre: p.nombre,
          sku: p.sku || null,
          cantidad: 1,
          unidad_medida: p.unidad_medida,
          precio_unitario: p.precio_venta,
          iva_tipo: "10%",
          descuento: 0,
          costo_unitario: null,
        },
      ];
    });
    setComboQuery("");
    setComboHits([]);
    setComboOpen(false);
    setComboHighlight(-1);
    setTimeout(() => comboInputRef.current?.focus(), 0);
  }

  /** Teclado del autocomplete: ↑/↓ navega, Enter agrega el resaltado, Esc cierra. */
  function onComboKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setComboOpen(true);
      setComboHighlight((h) => Math.min(h + 1, comboHits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setComboHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = comboHits[comboHighlight] ?? comboHits[0];
      if (sel) agregarProductoRapido(sel);
    } else if (e.key === "Escape") {
      setComboOpen(false);
      setComboHighlight(-1);
    }
  }

  function agregarManual() {
    setItems((prev) => [
      ...prev,
      {
        producto_id: null,
        producto_nombre: "",
        sku: null,
        cantidad: 1,
        unidad_medida: null,
        precio_unitario: 0,
        iva_tipo: "10%",
        descuento: 0,
        costo_unitario: null,
      },
    ]);
  }

  function updItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function delItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const totales = useMemo(() => {
    let subtotal = 0,
      iva = 0,
      desc = 0,
      total = 0;
    for (const it of items) {
      const t = itemTotals(it);
      subtotal += t.subtotal;
      iva += t.iva;
      total += t.total;
      desc += Number(it.descuento) || 0;
    }
    // Costo estimado: solo suma las líneas donde se cargó un costo.
    const costo = items.reduce((s, it) => s + (it.costo_unitario ?? 0) * (Number(it.cantidad) || 0), 0);
    return {
      subtotal: round2(subtotal),
      iva: round2(iva),
      desc: round2(desc),
      total: round2(total),
      costo: round2(costo),
    };
  }, [items]);
  const hayCostoEstimado = items.some((it) => (it.costo_unitario ?? 0) > 0);

  const valido =
    clienteNombre.trim().length > 0 &&
    items.length > 0 &&
    items.every((it) => it.producto_nombre.trim() && it.cantidad > 0 && it.precio_unitario >= 0);

  async function guardar() {
    if (guardando || !valido) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/presupuestos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId || null,
          cliente_nombre: clienteNombre.trim(),
          cliente_ruc: clienteRuc.trim() || null,
          cliente_telefono: clienteTel.trim() || null,
          cliente_direccion: clienteDir.trim() || null,
          moneda: "PYG",
          condicion,
          validez_dias: validezDias.trim() === "" ? null : parseInt(validezDias, 10),
          forma_pago: formaPago.trim() || null,
          plazo_entrega: plazoEntrega.trim() || null,
          observaciones: observaciones.trim() || null,
          items: items.map((it) => ({
            producto_id: it.producto_id,
            producto_nombre: it.producto_nombre.trim(),
            sku: it.sku,
            cantidad: Number(it.cantidad),
            unidad_medida: it.unidad_medida,
            precio_unitario: Number(it.precio_unitario),
            iva_tipo: it.iva_tipo,
            descuento: Number(it.descuento) || 0,
            costo_unitario: it.costo_unitario,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo guardar el presupuesto.");
        return;
      }
      router.push(`/presupuestos/${body.data.id}`);
    } catch {
      setError("Error de red al guardar el presupuesto.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/presupuestos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Volver a presupuestos
      </Link>

      <div className="flex items-center gap-3">
        <FileText className="h-7 w-7 text-[#4FAEB2]" />
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Nuevo presupuesto</h1>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Cliente */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Cliente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Cliente existente (opcional)</label>
            <select value={clienteId} onChange={(e) => seleccionarCliente(e.target.value)} className={`${inputClass} bg-white`}>
              <option value="">— Cargar manualmente —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}{c.ruc ? ` (${c.ruc})` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Nombre / Razón social *</label>
            <input value={clienteNombre} onChange={(e) => { setClienteId(""); setClienteNombre(e.target.value); }} className={inputClass} placeholder="Nombre del cliente" />
          </div>
          <div>
            <label className={labelClass}>RUC / CI</label>
            <input value={clienteRuc} onChange={(e) => setClienteRuc(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Teléfono</label>
            <input value={clienteTel} onChange={(e) => setClienteTel(e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Dirección</label>
            <input value={clienteDir} onChange={(e) => setClienteDir(e.target.value)} className={inputClass} />
          </div>
        </div>
      </div>

      {/* Productos */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Productos</h2>
          <button type="button" onClick={agregarManual} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Ítem manual
          </button>
        </div>

        {/* Autocomplete: al elegir un producto se agrega solo y se limpia (igual que Caja). */}
        <div ref={comboContainerRef} className="relative mb-4">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#4FAEB2]" />
          <input
            ref={comboInputRef}
            type="text"
            value={comboQuery}
            onChange={(e) => { setComboQuery(e.target.value); setComboOpen(true); setComboHighlight(-1); }}
            onFocus={() => setComboOpen(true)}
            onKeyDown={onComboKeyDown}
            placeholder="Buscar producto por nombre, SKU o palabras clave…"
            className="h-12 w-full rounded-xl border-2 border-[#4FAEB2]/30 bg-white pl-12 pr-4 text-base text-slate-800 outline-none transition-all focus:border-[#4FAEB2] focus:ring-4 focus:ring-[#4FAEB2]/15"
            autoComplete="off"
          />
          {comboOpen && comboQuery.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[56vh] overflow-y-auto rounded-xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_16px_40px_-12px_rgba(15,23,42,0.28)]">
              {comboBuscando && comboHits.length === 0 ? (
                <div className="px-4 py-5 text-center text-sm text-slate-400">Buscando…</div>
              ) : comboHits.length === 0 ? (
                <div className="px-4 py-5 text-center text-sm text-slate-400">Sin resultados para &quot;{comboQuery}&quot;.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {comboHits.map((p, i) => {
                    const sinStock = p.stock_actual <= 0;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setComboHighlight(i)}
                          onClick={() => agregarProductoRapido(p)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === comboHighlight ? "bg-[#4FAEB2]/[0.08]" : "hover:bg-slate-50"}`}
                        >
                          <ProductoThumb url={p.imagen_url} alt={p.nombre} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800">{p.nombre}</p>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-mono">{p.sku || "—"}</span>
                              <span className="text-slate-300">·</span>
                              <span className={`font-semibold ${sinStock ? "text-red-600" : p.stock_actual < 5 ? "text-amber-600" : "text-emerald-700"}`}>
                                {sinStock ? "Sin stock" : `${p.stock_actual} ${p.unidad_medida ?? ""}`}
                              </span>
                            </div>
                          </div>
                          <span className="shrink-0 text-sm font-bold tabular-nums text-slate-800">{fmtGs(p.precio_venta)}</span>
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2]/10 px-2.5 py-1 text-xs font-bold text-[#3F8E91]">
                            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Agregar
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {comboHits.length >= 20 && (
                    <li className="px-4 py-2 text-center text-[11px] text-slate-400">
                      Mostrando los primeros 20. Refiná la búsqueda para acotar.
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-500">Buscá un producto arriba y se agrega al instante. También podés cargar un ítem manual.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="py-2 pr-2">Descripción</th>
                  <th className="py-2 px-2 w-20">Cant.</th>
                  <th className="py-2 px-2 w-32">Precio unit.</th>
                  <th className="py-2 px-2 w-24">IVA</th>
                  <th className="py-2 px-2 w-28">Descuento</th>
                  {/* Interno: sirve para ver el margen, no sale en el PDF del cliente. */}
                  <th className="py-2 px-2 w-32">Costo estim.</th>
                  <th className="py-2 px-2 w-32 text-right">Total</th>
                  <th className="py-2 pl-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it, i) => {
                  const t = itemTotals(it);
                  return (
                    <tr key={i}>
                      <td className="py-2 pr-2">
                        <input value={it.producto_nombre} onChange={(e) => updItem(i, { producto_nombre: e.target.value })} className={inputClass} placeholder="Descripción" />
                      </td>
                      <td className="py-2 px-2">
                        <input type="text" inputMode="numeric" value={numInput(it.cantidad)} placeholder="0" onChange={(e) => updItem(i, { cantidad: parseNumInput(e.target.value) })} className={inputClass} />
                      </td>
                      <td className="py-2 px-2">
                        <input type="text" inputMode="numeric" value={numInput(it.precio_unitario)} placeholder="0" onChange={(e) => updItem(i, { precio_unitario: parseNumInput(e.target.value) })} className={inputClass} />
                      </td>
                      <td className="py-2 px-2">
                        <select value={it.iva_tipo} onChange={(e) => updItem(i, { iva_tipo: e.target.value as IvaTipoPresupuesto })} className={`${inputClass} bg-white`}>
                          {IVAS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input type="text" inputMode="numeric" value={numInput(it.descuento)} placeholder="0" onChange={(e) => updItem(i, { descuento: parseNumInput(e.target.value) })} className={inputClass} />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number" min="0" step="1"
                          value={it.costo_unitario ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            updItem(i, { costo_unitario: v === "" ? null : Math.max(0, Number(v) || 0) });
                          }}
                          placeholder="0"
                          title="Cuánto estimás que cuesta (repuestos + mano de obra). Interno."
                          className={inputClass}
                        />
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtGs(t.total)}</td>
                      <td className="py-2 pl-2 text-right">
                        <button onClick={() => delItem(i)} className="text-red-600 hover:text-red-700" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4 ml-auto w-full sm:w-72 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal (sin IVA)</span><span className="tabular-nums">{fmtGs(totales.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">IVA</span><span className="tabular-nums">{fmtGs(totales.iva)}</span></div>
            {totales.desc > 0 && <div className="flex justify-between"><span className="text-gray-500">Descuentos</span><span className="tabular-nums">- {fmtGs(totales.desc)}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-base"><span>Total</span><span className="tabular-nums text-[#4FAEB2]">{fmtGs(totales.total)}</span></div>
            {/* Margen estimado — interno, no sale en el PDF que ve el cliente. */}
            {hayCostoEstimado && (
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex justify-between text-xs text-gray-500"><span>Costo estimado</span><span className="tabular-nums">{fmtGs(totales.costo)}</span></div>
                <div className="mt-1 flex justify-between font-semibold">
                  <span className="text-gray-700">Ganancia estimada</span>
                  <span className={`tabular-nums ${totales.total - totales.costo >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtGs(totales.total - totales.costo)}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-gray-400">Solo uso interno: no aparece en el presupuesto del cliente.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Condiciones */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Condiciones comerciales</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Condición</label>
            <div className="flex gap-2">
              {(["contado", "credito"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCondicion(c)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    condicion === c
                      ? "border-[#4FAEB2] bg-[#4FAEB2]/[0.10] text-[#3F8E91]"
                      : "border-gray-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {c === "contado" ? "Contado" : "Crédito"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Validez (días)</label>
            <input type="number" min="0" value={validezDias} onChange={(e) => setValidezDias(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Forma de pago</label>
            <input value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={inputClass} placeholder="Ej: 50% anticipo, saldo contra entrega" />
          </div>
          <div>
            <label className={labelClass}>Plazo de entrega</label>
            <input value={plazoEntrega} onChange={(e) => setPlazoEntrega(e.target.value)} className={inputClass} placeholder="Ej: 5 días hábiles" />
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass}>Observaciones</label>
            <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} className={inputClass} />
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Link href="/presupuestos" className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
          Cancelar
        </Link>
        <button onClick={guardar} disabled={!valido || guardando} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
          {guardando ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : "Guardar presupuesto"}
        </button>
      </div>
    </div>
  );
}
