"use client";

/**
 * /compras/[numero]/editar — Corrige una compra ya registrada.
 *
 * No reescribe la historia: al guardar, cada cambio de cantidad genera un
 * movimiento nuevo "edición de compra" (origen edicion_compra) que ajusta el
 * stock por la diferencia. Los datos de factura se corrigen en toda la compra.
 *
 * Las compras que vienen de una orden de compra NO se editan acá (descuadraría
 * la orden): se muestra un aviso.
 */
import { useEffect, useMemo, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Save, ArrowLeft, Trash2, Package as PackageIcon, FileText, Paperclip, Upload } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ProductoBuscadorInline from "@/components/inventario/ProductoBuscadorInline";
import { getCompras, editarCompra, uploadComprobante, type EditarCompraLineaPayload } from "@/lib/compras/storage";
import type { Compra, TipoIva } from "@/lib/compras/types";
import { parseCantidad, pasoCantidad, permiteDecimales, formatCantidad } from "@/lib/productos/unidades";

function fmtGs(v: number) { return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`; }

/** IVA incluido: el bruto ya contiene el impuesto; se desglosa desde adentro. */
function desglosarIva(bruto: number, iva: TipoIva): { subtotal: number; monto_iva: number } {
  if (iva === "exenta") return { subtotal: bruto, monto_iva: 0 };
  const factor = iva === "5" ? 1.05 : 1.1;
  const subtotal = bruto / factor;
  return { subtotal, monto_iva: bruto - subtotal };
}

interface LineaEdit {
  /** Clave estable para React y para editar (las nuevas no tienen id de BD). */
  key: string;
  /** id real de la fila `compras` (existente) o null si es una línea nueva. */
  id: string | null;
  producto_id: string;
  producto_nombre: string;
  unidad_medida: string;
  cantidad: number;
  cantidadOriginal: number;
  costo_unitario: number; // PYG
  iva_tipo: TipoIva;
  precio_venta: number;
}


export default function EditarCompraPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = use(params);
  const numeroControl = decodeURIComponent(numero);
  const router = useRouter();

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bloqueada, setBloqueada] = useState<string | null>(null);
  const [proveedor, setProveedor] = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [nroTimbrado, setNroTimbrado] = useState("");
  const [fechaFactura, setFechaFactura] = useState("");
  const [observacion, setObservacion] = useState("");
  const [lineas, setLineas] = useState<LineaEdit[]>([]);
  const [eliminadas, setEliminadas] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const keySeq = useRef(0);
  // Comprobante (imagen/PDF) de la compra: el actual + el nuevo si se sube.
  const [compActual, setCompActual] = useState<{ path: string | null; nombre: string | null }>({ path: null, nombre: null });
  const [compNuevo, setCompNuevo] = useState<{ storage_path: string; nombre: string; mime: string } | null>(null);
  const [subiendoComp, setSubiendoComp] = useState(false);

  useEffect(() => {
    let cancel = false;
    getCompras().then((todas) => {
      if (cancel) return;
      const rows = todas.filter((c) => c.numero_control === numeroControl);
      if (rows.length === 0) { setError("Compra no encontrada."); setCargando(false); return; }
      if (rows.some((r) => r.orden_compra_numero)) {
        setBloqueada("Esta compra proviene de una orden de compra. Para corregirla, ajustá la orden de compra correspondiente.");
      }
      const cab = rows[0];
      setProveedor(cab.proveedor_nombre);
      setNumeroFactura(cab.numero_factura ?? "");
      setNroTimbrado(cab.nro_timbrado ?? "");
      setFechaFactura((cab.fecha_factura ?? "").slice(0, 10));
      setObservacion(cab.observacion ?? "");
      setCompActual({ path: cab.comprobante_storage_path ?? null, nombre: cab.comprobante_nombre ?? null });
      setLineas(rows.map((r: Compra) => ({
        key: r.id,
        id: r.id,
        producto_id: r.producto_id,
        producto_nombre: r.producto_nombre,
        unidad_medida: r.unidad_medida || "UNIDAD",
        cantidad: r.cantidad,
        cantidadOriginal: r.cantidad,
        costo_unitario: r.costo_unitario,
        iva_tipo: r.iva_tipo,
        precio_venta: r.precio_venta,
      })));
      setCargando(false);
    }).catch(() => { if (!cancel) { setError("No se pudo cargar la compra."); setCargando(false); } });
    return () => { cancel = true; };
  }, [numeroControl]);

  function setLinea(key: string, patch: Partial<LineaEdit>) {
    setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function quitarLinea(l: LineaEdit) {
    // Si la línea ya existía en la compra, se marca para eliminar en el backend.
    if (l.id) setEliminadas((prev) => [...prev, l.id!]);
    setLineas((prev) => prev.filter((x) => x.key !== l.key));
  }
  function agregarProducto(p: { id: string; nombre: string; unidad_medida?: string; costo_promedio?: number; precio_venta?: number }) {
    if (lineas.some((l) => l.producto_id === p.id)) {
      setError(`"${p.nombre}" ya está en la compra.`);
      return;
    }
    setError(null);
    setLineas((prev) => [...prev, {
      key: `nueva-${keySeq.current++}`,
      id: null,
      producto_id: p.id,
      producto_nombre: p.nombre,
      unidad_medida: p.unidad_medida || "UNIDAD",
      cantidad: 1,
      cantidadOriginal: 0,
      costo_unitario: p.costo_promedio || 0,
      iva_tipo: "10",
      precio_venta: p.precio_venta || 0,
    }]);
  }

  const totales = useMemo(() => {
    return lineas.reduce((acc, l) => {
      const bruto = (l.cantidad || 0) * (l.costo_unitario || 0);
      const { subtotal, monto_iva } = desglosarIva(bruto, l.iva_tipo);
      acc.subtotal += subtotal; acc.iva += monto_iva; acc.total += bruto;
      return acc;
    }, { subtotal: 0, iva: 0, total: 0 });
  }, [lineas]);

  const hayCambios = useMemo(
    () => eliminadas.length > 0 || lineas.some((l) => !l.id || l.cantidad !== l.cantidadOriginal),
    [lineas, eliminadas]
  );

  async function subirComprobante(file: File) {
    setError(null);
    setSubiendoComp(true);
    const r = await uploadComprobante(file);
    setSubiendoComp(false);
    if (!r.ok) { setError(`Comprobante: ${r.error}`); return; }
    setCompNuevo({ storage_path: r.data.comprobante_storage_path, nombre: r.data.comprobante_nombre, mime: r.data.comprobante_mime_type });
  }

  async function guardar() {
    setError(null);
    if (lineas.length === 0) { setError("La compra debe tener al menos un producto."); return; }
    for (const l of lineas) {
      if (!(l.cantidad > 0)) { setError(`${l.producto_nombre}: la cantidad debe ser mayor a 0.`); return; }
      if (!(l.costo_unitario > 0)) { setError(`${l.producto_nombre}: el costo debe ser mayor a 0.`); return; }
    }
    setGuardando(true);
    const payloadLineas: EditarCompraLineaPayload[] = lineas.map((l) => {
      const bruto = l.cantidad * l.costo_unitario;
      const { subtotal, monto_iva } = desglosarIva(bruto, l.iva_tipo);
      const margen = l.precio_venta > 0 && l.costo_unitario > 0
        ? ((l.precio_venta - l.costo_unitario) / l.precio_venta) * 100 : null;
      return {
        id: l.id,
        producto_id: l.id ? undefined : l.producto_id,
        producto_nombre: l.id ? undefined : l.producto_nombre,
        cantidad: l.cantidad,
        costo_unitario_original: l.costo_unitario,
        costo_unitario: l.costo_unitario,
        iva_tipo: l.iva_tipo,
        subtotal, monto_iva, total: bruto,
        precio_venta: l.precio_venta,
        margen_venta: margen,
      };
    });
    const r = await editarCompra(numeroControl, {
      numero_factura: numeroFactura.trim() || null,
      nro_timbrado: nroTimbrado.trim() || null,
      fecha_factura: fechaFactura || null,
      observacion: observacion.trim() || null,
      lineas: payloadLineas,
      eliminar: eliminadas,
      comprobante_storage_path: compNuevo?.storage_path ?? null,
      comprobante_nombre: compNuevo?.nombre ?? null,
      comprobante_mime_type: compNuevo?.mime ?? null,
    });
    setGuardando(false);
    if (!r.ok) { setError(r.error); return; }
    router.push("/compras");
  }

  if (cargando) return <p className="py-10 text-center text-slate-500 animate-pulse">Cargando…</p>;

  const inputFactura = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm outline-none transition-all hover:border-[#4FAEB2]/50 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div className="w-full space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Encabezado */}
      <div>
        <Link href="/compras" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#3F8E91]">
          <ArrowLeft className="h-4 w-4" /> Compras
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Zentra · Compras</p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">Editar compra {numeroControl}</h1>
            <p className="mt-0.5 text-xs text-slate-500">Proveedor: <span className="font-medium text-slate-700">{proveedor}</span></p>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {bloqueada ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{bloqueada}</div>
      ) : (
        <>
          {/* Productos */}
          <section className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
            <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
              <PackageIcon className="h-4 w-4 text-[#4FAEB2]" />
              <h2 className="text-[15px] font-bold text-slate-800">Productos</h2>
              <span className="inline-flex h-[22px] min-w-[24px] items-center justify-center rounded-full bg-[#4FAEB2] px-2 text-[11px] font-bold tabular-nums text-white">{lineas.length}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-semibold">Producto</th>
                    <th className="px-3 py-3 text-center font-semibold">Cantidad</th>
                    <th className="px-3 py-3 text-right font-semibold">Costo unit.</th>
                    <th className="px-3 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lineas.map((l) => {
                    const cambio = !l.id || l.cantidad !== l.cantidadOriginal;
                    return (
                      <tr key={l.key} className="align-middle transition-colors hover:bg-[#4FAEB2]/[0.03]">
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-800">
                            {l.producto_nombre}
                            {!l.id && <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Nuevo</span>}
                          </p>
                          {l.id && cambio && (
                            <p className="mt-0.5 text-[11px] text-amber-600">antes: {formatCantidad(l.cantidadOriginal, l.unidad_medida)} {l.unidad_medida}</p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="mx-auto flex w-fit items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <input
                              type="number"
                              min={0}
                              step={pasoCantidad(l.unidad_medida)}
                              inputMode={permiteDecimales(l.unidad_medida) ? "decimal" : "numeric"}
                              value={l.cantidad || ""}
                              onChange={(e) => { const n = parseCantidad(e.target.value, l.unidad_medida); setLinea(l.key, { cantidad: n ?? 0 }); }}
                              className={`h-9 border-0 text-center text-sm tabular-nums outline-none ${permiteDecimales(l.unidad_medida) ? "w-20" : "w-14"}`}
                            />
                            <span className="border-l border-slate-200 bg-slate-50 px-2 py-2 text-[10px] font-semibold uppercase text-slate-400">{l.unidad_medida}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <MontoInput
                            value={l.costo_unitario}
                            onChange={(n) => setLinea(l.key, { costo_unitario: n })}
                            className="h-9 w-32 rounded-lg border border-slate-200 px-2 text-right text-sm tabular-nums outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
                          />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-bold text-[#3F8E91]">{fmtGs(l.cantidad * l.costo_unitario)}</td>
                        <td className="px-4 py-3 text-center">
                          <button type="button" onClick={() => quitarLinea(l)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600" aria-label="Quitar">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Agregar producto */}
            <div className="border-t border-slate-100 px-5 py-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agregar producto</p>
              <ProductoBuscadorInline onSelect={agregarProducto} excludeIds={lineas.map((l) => l.producto_id)} />
            </div>

            {/* Totales */}
            <div className="flex flex-wrap justify-end gap-8 border-t border-slate-100 bg-slate-50/50 px-5 py-3.5 text-sm">
              <span className="text-slate-500">IVA <span className="ml-1 font-semibold tabular-nums text-slate-700">{fmtGs(totales.iva)}</span></span>
              <span className="text-slate-500">Total <span className="ml-1 text-base font-bold tabular-nums text-[#3F8E91]">{fmtGs(totales.total)}</span></span>
            </div>
          </section>

          {/* Datos de la factura */}
          <section className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
            <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
              <FileText className="h-4 w-4 text-[#4FAEB2]" />
              <h2 className="text-[15px] font-bold text-slate-800">Datos de la factura</h2>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">N° de factura</span>
                <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} className={inputFactura} />
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">N° de timbrado</span>
                <input value={nroTimbrado} onChange={(e) => setNroTimbrado(e.target.value)} className={inputFactura} />
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de factura</span>
                <input type="date" value={fechaFactura} onChange={(e) => setFechaFactura(e.target.value)} className={inputFactura} />
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Observación</span>
                <input value={observacion} onChange={(e) => setObservacion(e.target.value)} className={inputFactura} />
              </label>
            </div>

            {/* Comprobante */}
            <div className="border-t border-slate-100 px-5 pb-5 pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Comprobante (imagen / PDF)</p>
              <div className="flex flex-wrap items-center gap-3">
                {compNuevo ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    <Paperclip className="h-3.5 w-3.5" /> Nuevo: {compNuevo.nombre}
                  </span>
                ) : compActual.path ? (
                  <a
                    href={`/api/compras/comprobante?numero_control=${encodeURIComponent(numeroControl)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#4FAEB2]/30 px-3 py-2 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/10"
                  >
                    <Paperclip className="h-3.5 w-3.5" /> Ver comprobante actual
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">No hay comprobante cargado.</span>
                )}

                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-[#4FAEB2] hover:text-[#3F8E91]">
                  <Upload className="h-3.5 w-3.5" />
                  {subiendoComp ? "Subiendo…" : compActual.path || compNuevo ? "Cambiar" : "Subir comprobante"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    disabled={subiendoComp}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) subirComprobante(f); e.target.value = ""; }}
                  />
                </label>
                {compNuevo && (
                  <button type="button" onClick={() => setCompNuevo(null)} className="text-xs text-slate-400 hover:text-slate-600 underline">
                    deshacer
                  </button>
                )}
              </div>
            </div>
          </section>

          {hayCambios && (
            <p className="text-xs text-amber-700">
              Cambiar cantidades ajusta el stock con un movimiento &quot;edición de compra&quot; (queda registrado).
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Link href="/compras" className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Cancelar
            </Link>
            <button
              type="button"
              onClick={() => setConfirmar(true)}
              disabled={guardando}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-[#4FAEB2]/30 transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
            >
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar cambios
            </button>
          </div>

          <ConfirmModal
            open={confirmar}
            title="Guardar cambios de la compra"
            message={
              hayCambios
                ? "Cambiaste cantidades: se ajustará el stock con un movimiento de edición de compra. ¿Confirmás?"
                : "¿Guardar los cambios de esta compra?"
            }
            confirmLabel="Guardar"
            loading={guardando}
            onCancel={() => setConfirmar(false)}
            onConfirm={() => { setConfirmar(false); guardar(); }}
          />
        </>
      )}
    </div>
  );
}
