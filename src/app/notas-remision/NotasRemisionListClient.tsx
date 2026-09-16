"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Filter, Loader2, Printer, Pencil, Truck } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Row = {
  id: string;
  numero: string;
  estado: string;
  fecha: string;
  observacion: string | null;
  anulada_motivo: string | null;
  usuario_creador_nombre: string | null;
  venta_id: string | null;
  factura_id: string | null;
  venta_numero: string | null;
  factura_numero: string | null;
  factura_autoimpresor: string | null;
  numero_orden_compra: string | null;
  cliente_nombre: string | null;
  total_items: number;
  total_cantidad: number;
  pendiente_entrega: number;
};

type ClienteOpt = { id: string; nombre: string };

const ESTADOS = [
  { v: "", l: "Todos los estados" },
  { v: "confirmada", l: "Confirmada" },
  { v: "anulada", l: "Anulada" },
  { v: "borrador", l: "Borrador" },
];

function fmtFecha(v: string): string {
  try {
    return new Date(v).toLocaleDateString("es-PY");
  } catch {
    return v;
  }
}

function fmtCant(n: number): string {
  return Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
}

export default function NotasRemisionListClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteOpt[]>([]);

  // Filtros aplicados (los que viajan a la API) vs. los que se están editando.
  const [form, setForm] = useState({ desde: "", hasta: "", cliente_id: "", estado: "", q: "" });
  const [aplicados, setAplicados] = useState({ desde: "", hasta: "", cliente_id: "", estado: "", q: "" });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(aplicados)) if (v) qs.set(k, v);
      const res = await fetchWithSupabaseSession(`/api/notas-remision?${qs.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? "No se pudo cargar.");
      setRows((j.data.rows ?? []) as Row[]);
      setTotal(Number(j.data.total) || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setCargando(false);
    }
  }, [aplicados]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/clientes?limit=500", { cache: "no-store" });
        const j = await res.json();
        const arr = (j?.data?.clientes ?? j?.data ?? []) as Array<Record<string, unknown>>;
        if (Array.isArray(arr)) {
          setClientes(
            arr
              .map((c) => ({
                id: String(c.id ?? ""),
                nombre: String(c.empresa || c.nombre_contacto || c.nombre || "").trim(),
              }))
              .filter((c) => c.id && c.nombre),
          );
        }
      } catch {
        /* el filtro de cliente queda vacío, no es bloqueante */
      }
    })();
  }, []);

  const totalUnidades = useMemo(() => rows.reduce((a, r) => a + (Number(r.total_cantidad) || 0), 0), [rows]);

  const inputCls =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-slate-400 focus:outline-none";
  const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3F8E91]">● Auditoría</p>
        <h1 className="text-2xl font-bold text-slate-800">Notas de remisión</h1>
        <p className="text-sm text-slate-500">
          Listado global de entregas, con su documento comercial y el cliente. Editables desde cada venta.
        </p>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-4 border-l-4 border-[#4FAEB2] pl-2 text-[11px] font-bold uppercase tracking-wider text-slate-600">
          Filtros
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className={labelCls}>Desde</label>
            <input type="date" value={form.desde} onChange={(e) => setForm((p) => ({ ...p, desde: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Hasta</label>
            <input type="date" value={form.hasta} onChange={(e) => setForm((p) => ({ ...p, hasta: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Cliente</label>
            <select value={form.cliente_id} onChange={(e) => setForm((p) => ({ ...p, cliente_id: e.target.value }))} className={inputCls}>
              <option value="">Todos los clientes</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Estado</label>
            <select value={form.estado} onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value }))} className={inputCls}>
              {ESTADOS.map((e) => (
                <option key={e.v} value={e.v}>
                  {e.l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Buscar</label>
            <input
              value={form.q}
              onChange={(e) => setForm((p) => ({ ...p, q: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") setAplicados({ ...form });
              }}
              placeholder="N.º remisión, venta, factura u observación"
              className={inputCls}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAplicados({ ...form })}
              className="inline-flex items-center gap-2 rounded-md bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91]"
            >
              <Filter className="h-4 w-4" /> Aplicar filtros
            </button>
            <button
              type="button"
              onClick={() => {
                const vacio = { desde: "", hasta: "", cliente_id: "", estado: "", q: "" };
                setForm(vacio);
                setAplicados(vacio);
              }}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Limpiar
            </button>
          </div>
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{total}</span> registros en total
            {rows.length > 0 && <> · {fmtCant(totalUnidades)} unidades remitidas</>}
          </p>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Fecha</th>
                <th className="px-4 py-3 text-left">N.º remisión</th>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Documento</th>
                <th className="px-4 py-3 text-left">O. Compra</th>
                <th className="px-4 py-3 text-right">Ítems</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Usuario</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                    <Truck className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                    No hay notas de remisión con estos filtros.
                    <br />
                    <span className="text-xs text-slate-400">
                      Se generan desde <Link href="/ventas" className="underline">Caja</Link>, con el botón “Entregas” de cada venta.
                    </span>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const doc = r.factura_autoimpresor
                    ? { txt: r.factura_autoimpresor, sub: r.venta_numero }
                    : r.factura_numero
                      ? { txt: r.factura_numero, sub: null }
                      : { txt: r.venta_numero ?? "—", sub: "sin factura emitida" };
                  // Se pasa ?editar=<remision> para abrir la edicion de una: sin esto
                  // el lapiz solo dejaba en la pagina y habia que buscar la fila.
                  const destino = r.venta_id
                    ? `/ventas/${r.venta_id}/remisiones?editar=${r.id}`
                    : r.factura_id
                      ? `/facturas/${r.factura_id}/remisiones?editar=${r.id}`
                      : null;
                  const pdf = r.venta_id ? `/api/ventas/remisiones/${r.id}/pdf?auto=1` : `/api/remisiones/${r.id}/pdf?auto=1`;
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-slate-600">{fmtFecha(r.fecha)}</td>
                      <td className="px-4 py-3 font-mono font-medium text-slate-800">{r.numero}</td>
                      <td className="px-4 py-3 text-slate-700">{r.cliente_nombre ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-700">{doc.txt}</span>
                        {doc.sub && <span className="block text-[11px] text-slate-400">{doc.sub}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.numero_orden_compra ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.total_items}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtCant(r.total_cantidad)}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          // Anulada manda sobre todo. Si no, lo que importa operativamente
                          // es si al cliente le falta recibir algo.
                          const anulada = r.estado === "anulada";
                          const pendiente = !anulada && r.pendiente_entrega > 0;
                          const cls = anulada
                            ? "bg-red-100 text-red-700"
                            : pendiente
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800";
                          const texto = anulada
                            ? "Anulada"
                            : pendiente
                              ? "Entrega pendiente"
                              : "Entregado";
                          const tip = anulada
                            ? r.anulada_motivo ?? ""
                            : pendiente
                              ? `Faltan ${fmtCant(r.pendiente_entrega)} unidades por entregar`
                              : r.observacion ?? "";
                          return (
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`} title={tip}>
                              {texto}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.usuario_creador_nombre ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <a href={pdf} target="_blank" rel="noopener" title="Imprimir" className="rounded p-1.5 text-slate-500 hover:bg-slate-100">
                            <Printer className="h-4 w-4" />
                          </a>
                          {destino && r.estado !== "anulada" && (
                            <Link href={destino} title="Editar destinatario, cantidades y fecha" className="rounded p-1.5 text-slate-500 hover:bg-slate-100">
                              <Pencil className="h-4 w-4" />
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
