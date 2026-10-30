"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, CircleAlert, CircleOff, Coins } from "lucide-react";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { getProductos } from "@/lib/inventario/storage";
import type { Producto } from "@/lib/inventario/types";

type EstadoStock = "sin_stock" | "bajo" | "ok";

const ETIQUETA_ESTADO: Record<EstadoStock, { label: string; clase: string }> = {
  sin_stock: { label: "Sin stock", clase: "bg-rose-50 text-rose-700 ring-rose-200" },
  bajo: { label: "Stock bajo", clase: "bg-amber-50 text-amber-700 ring-amber-200" },
  ok: { label: "Normal", clase: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

const FILTROS: { value: EstadoStock | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "sin_stock", label: "Sin stock" },
  { value: "bajo", label: "Stock bajo" },
  { value: "ok", label: "Normal" },
];

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

function estadoDe(p: Producto): EstadoStock {
  if (p.stock_actual <= 0) return "sin_stock";
  return p.stock_actual <= p.stock_minimo ? "bajo" : "ok";
}

export default function ReporteInventarioPage() {
  const { isAdmin } = useIsAdmin();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<EstadoStock | "todos">("todos");

  useEffect(() => {
    let cancelado = false;
    void getProductos().then((data) => {
      if (cancelado) return;
      setProductos(data);
      setCargando(false);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const conStock = useMemo(
    () => productos.filter((p) => p.controla_stock !== false && p.tipo_producto !== "servicio"),
    [productos]
  );

  const resumen = useMemo(() => {
    let sinStock = 0;
    let bajo = 0;
    let valorCosto = 0;
    let valorVenta = 0;
    for (const p of conStock) {
      const estado = estadoDe(p);
      if (estado === "sin_stock") sinStock += 1;
      if (estado === "bajo") bajo += 1;
      const unidades = Math.max(p.stock_actual, 0);
      valorCosto += unidades * p.costo_promedio;
      valorVenta += unidades * p.precio_venta;
    }
    return { sinStock, bajo, valorCosto, valorVenta };
  }, [conStock]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return conStock.filter((p) => {
      if (filtro !== "todos" && estadoDe(p) !== filtro) return false;
      return !q || p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    });
  }, [conStock, busqueda, filtro]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Inventario"
        description="Stock actual, productos por reponer y valor de la mercadería."
        backHref="/reportes"
        backLabel="Reportes"
        actions={isAdmin ? <ExportExcelButton url="/api/inventario/productos/export" /> : undefined}
      />

      {cargando ? (
        <p className="animate-pulse text-slate-500">Cargando…</p>
      ) : conStock.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
          Todavía no hay productos con control de stock.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Productos" value={conStock.length} icon={<Boxes className="h-5 w-5" />} />
            <StatCard label="Sin stock" value={resumen.sinStock} icon={<CircleOff className="h-5 w-5" />} />
            <StatCard label="Stock bajo" value={resumen.bajo} icon={<CircleAlert className="h-5 w-5" />} />
            <StatCard
              label="Valor a precio de venta"
              value={fmtGs(resumen.valorVenta)}
              hint={isAdmin ? `Al costo: ${fmtGs(resumen.valorCosto)}` : undefined}
              icon={<Coins className="h-5 w-5" />}
              accent
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o SKU…"
              aria-label="Buscar producto"
              className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#4FAEB2]"
            />
            <div className="flex flex-wrap gap-1.5">
              {FILTROS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={filtro === f.value}
                  onClick={() => setFiltro(f.value)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                    filtro === f.value
                      ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Mínimo</th>
                  <th className="px-4 py-3">Estado</th>
                  {isAdmin && <th className="px-4 py-3 text-right">Costo</th>}
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3 text-right">Valor en stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibles.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6} className="px-4 py-10 text-center text-slate-400">
                      No hay productos con ese filtro.
                    </td>
                  </tr>
                ) : (
                  visibles.map((p) => {
                    const estado = ETIQUETA_ESTADO[estadoDe(p)];
                    return (
                      <tr key={p.id}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{p.nombre}</p>
                          <p className="font-mono text-[11px] text-slate-500">{p.sku}</p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{p.stock_actual.toLocaleString("es-PY")}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                          {p.stock_minimo.toLocaleString("es-PY")}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${estado.clase}`}>
                            {estado.label}
                          </span>
                        </td>
                        {isAdmin && <td className="px-4 py-3 text-right tabular-nums">{fmtGs(p.costo_promedio)}</td>}
                        <td className="px-4 py-3 text-right tabular-nums">{fmtGs(p.precio_venta)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {fmtGs(Math.max(p.stock_actual, 0) * p.precio_venta)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
