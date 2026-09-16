"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Trash2, X } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import { saveCompraMulti, uploadComprobante, type CompraItemPayload } from "@/lib/compras/storage";
import { getProveedores, proveedorExiste, createProveedor } from "@/lib/proveedores/storage";
import { productoExiste, saveProducto } from "@/lib/inventario/storage";
import type { TipoIva, TipoPago, Moneda } from "@/lib/compras/types";
import type { Proveedor } from "@/lib/proveedores/types";
import type { MetodoValuacion } from "@/lib/inventario/types";
import ProductoBuscadorInline from "@/components/inventario/ProductoBuscadorInline";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import { parseCantidad, pasoCantidad, permiteDecimales } from "@/lib/productos/unidades";
import { FancySelect } from "@/components/ui/FancySelect";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}
function margenColor(m: number) {
  if (m >= 40) return "text-green-600";
  if (m >= 20) return "text-yellow-600";
  return "text-red-600";
}
/**
 * IVA INCLUIDO (modelo PY, igual que Caja): el costo ya contiene el IVA.
 * Se desglosa desde adentro: base = bruto / factor; iva = bruto − base.
 * No se suma nada encima del costo.
 */
function desglosarIva(bruto: number, iva: TipoIva): { subtotal: number; monto_iva: number } {
  if (iva === "exenta") return { subtotal: bruto, monto_iva: 0 };
  const factor = iva === "5" ? 1.05 : 1.1;
  const subtotal = bruto / factor;
  return { subtotal, monto_iva: bruto - subtotal };
}

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const inputSmClass = inputClass;
const labelClass = "block text-sm font-medium text-slate-700 mb-2";
const labelSmClass = "block text-xs font-medium text-slate-600 mb-1.5";

// ── Tipos locales ────────────────────────────────────────────────────────────

type LineaCompra = {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  unidad_medida: string;
  es_insumo_no_vendible: boolean;
  cantidad: number;
  costo_unitario_input: number; // en la moneda de la cabecera
  costo_unitario_pyg: number;
  iva_tipo: TipoIva;
  precio_venta: number;
  subtotal: number;
  monto_iva: number;
  total: number;
  margen_venta: number | null;
};

// ── SegmentedControl ───────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  value, options, onChange, small = false,
}: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className="flex border border-slate-200 rounded-lg overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 font-medium transition-colors ${small ? "py-2 text-xs" : "py-2.5 text-sm"} ${
            value === opt.value ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function NuevaCompraPage() {
  const router = useRouter();

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);

  // Cabecera (compartida por toda la compra)
  const [cab, setCab] = useState({
    proveedor_id: "",
    nro_timbrado: "",
    numero_factura: "",
    tipo_pago: "contado" as TipoPago,
    plazo_dias: "",
    moneda: "PYG" as Moneda,
    tipo_cambio: "",
  });

  // Líneas de la compra (editables inline)
  const [lineas, setLineas] = useState<LineaCompra[]>([]);

  // Inline crear proveedor / producto
  const [mostrarFormProveedor, setMostrarFormProveedor] = useState(false);
  const [formProveedor, setFormProveedor] = useState({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  const [errorRuc, setErrorRuc] = useState<string | null>(null);
  const [proveedorCreado, setProveedorCreado] = useState<string | null>(null);

  const [mostrarFormProducto, setMostrarFormProducto] = useState(false);
  const [formProducto, setFormProducto] = useState({
    nombre: "", sku: "", unidad_medida: "Unidad", metodo_valuacion: "CPP" as MetodoValuacion,
    stock_minimo: "0", precio_venta_sugerido: "", tipo: "reventa" as "reventa" | "menu" | "materia",
    tipo_producto: "reventa" as "reventa" | "repuesto",
  });
  const [errorSku, setErrorSku] = useState<string | null>(null);
  const [generandoSku, setGenerandoSku] = useState(false);
  const [productoCreado, setProductoCreado] = useState<string | null>(null);

  // Comprobante / factura del proveedor (opcional, para toda la compra)
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);
  const [comprobanteError, setComprobanteError] = useState<string | null>(null);

  const [errorLinea, setErrorLinea] = useState<string | null>(null);
  const [errorSubmit, setErrorSubmit] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleComprobanteChange(e: React.ChangeEvent<HTMLInputElement>) {
    setComprobanteError(null);
    const f = e.target.files?.[0] ?? null;
    if (f && !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.type)) {
      setComprobanteError("Formato no permitido. Usá JPG, PNG, WebP o PDF.");
      setComprobanteFile(null);
      return;
    }
    if (f && f.size > 10 * 1024 * 1024) {
      setComprobanteError("Archivo demasiado grande (máx. 10 MB).");
      setComprobanteFile(null);
      return;
    }
    setComprobanteFile(f);
  }

  async function recargarProveedores() {
    const data = await getProveedores();
    setProveedores(data.filter((p) => p.estado === "activo"));
  }
  useEffect(() => { recargarProveedores(); }, []);

  const tipoCambioNum = cab.moneda === "USD" ? parseFloat(cab.tipo_cambio) || 0 : 1;

  // ── Recalcular derivados de una línea (usa el tipo de cambio actual) ─────────
  function recomputeLinea(base: LineaCompra): LineaCompra {
    const costoPyg = (base.costo_unitario_input || 0) * tipoCambioNum;
    // IVA incluido: el total de la línea es costo × cantidad (el IVA ya está dentro).
    const total = (base.cantidad || 0) * costoPyg;
    const { subtotal, monto_iva } = desglosarIva(total, base.iva_tipo);
    const margen_venta = base.precio_venta > 0 && costoPyg > 0 ? ((base.precio_venta - costoPyg) / base.precio_venta) * 100 : null;
    return { ...base, costo_unitario_pyg: costoPyg, subtotal, monto_iva, total, margen_venta };
  }

  // Si cambia el tipo de cambio (o la moneda), recalcular todas las líneas.
  useEffect(() => {
    setLineas((prev) =>
      prev.map((l) => {
        const costoPyg = (l.costo_unitario_input || 0) * tipoCambioNum;
        const total = (l.cantidad || 0) * costoPyg;
        const { subtotal, monto_iva } = desglosarIva(total, l.iva_tipo);
        const margen_venta = l.precio_venta > 0 && costoPyg > 0 ? ((l.precio_venta - costoPyg) / l.precio_venta) * 100 : null;
        return { ...l, costo_unitario_pyg: costoPyg, subtotal, monto_iva, total, margen_venta };
      })
    );
  }, [tipoCambioNum]);

  // ── Totales de la compra ───────────────────────────────────────────────────
  const totales = useMemo(() => {
    return lineas.reduce(
      (acc, l) => ({
        subtotal: acc.subtotal + l.subtotal,
        iva: acc.iva + l.monto_iva,
        total: acc.total + l.total,
      }),
      { subtotal: 0, iva: 0, total: 0 }
    );
  }, [lineas]);

  // ── Agregar / editar / quitar línea ─────────────────────────────────────────
  function agregarProducto(prod: {
    id: string; nombre: string; sku: string; unidad_medida?: string;
    es_insumo?: boolean; es_vendible?: boolean; costo_promedio?: number; precio_venta?: number;
  }) {
    setErrorLinea(null);
    if (lineas.some((l) => l.producto_id === prod.id)) {
      setErrorLinea(`"${prod.nombre}" ya está en la compra. Ajustá su cantidad en la lista.`);
      return;
    }
    const insumoNoVendible = prod.es_insumo === true && prod.es_vendible !== true;
    setLineas((prev) => [
      ...prev,
      recomputeLinea({
        producto_id: prod.id,
        producto_nombre: prod.nombre,
        sku: prod.sku,
        unidad_medida: prod.unidad_medida || "UNIDAD",
        es_insumo_no_vendible: insumoNoVendible,
        cantidad: 1,
        costo_unitario_input: prod.costo_promedio || 0,
        costo_unitario_pyg: 0,
        iva_tipo: "10",
        precio_venta: insumoNoVendible ? 0 : (prod.precio_venta || 0),
        subtotal: 0,
        monto_iva: 0,
        total: 0,
        margen_venta: null,
      }),
    ]);
  }

  function editarLinea(idx: number, patch: Partial<LineaCompra>) {
    setLineas((prev) => prev.map((l, i) => (i === idx ? recomputeLinea({ ...l, ...patch }) : l)));
  }

  function handleQuitarLinea(idx: number) {
    setLineas((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorSubmit(null);
    if (!cab.proveedor_id) return setErrorSubmit("Seleccioná o agregá un proveedor.");
    if (!cab.nro_timbrado.trim()) return setErrorSubmit("Ingresá el N° de timbrado.");
    if (!cab.numero_factura.trim()) return setErrorSubmit("Ingresá el N° de factura.");
    if (lineas.length === 0) return setErrorSubmit("Agregá al menos un producto a la compra.");
    if (cab.moneda === "USD" && tipoCambioNum <= 0)
      return setErrorSubmit("Cargá el tipo de cambio (USD → Gs.).");
    const invalida = lineas.find((l) => l.cantidad <= 0 || l.costo_unitario_pyg <= 0);
    if (invalida) return setErrorSubmit(`Revisá "${invalida.producto_nombre}": la cantidad y el costo deben ser mayores a 0.`);
    const sinPrecio = lineas.find((l) => !l.es_insumo_no_vendible && l.precio_venta <= 0);
    if (sinPrecio) return setErrorSubmit(`Cargá el precio de venta de "${sinPrecio.producto_nombre}".`);

    const proveedor = proveedores.find((p) => String(p.id) === cab.proveedor_id);
    if (!proveedor) return setErrorSubmit("Proveedor no encontrado. Recargá e intentá de nuevo.");

    const items: CompraItemPayload[] = lineas.map((l) => ({
      producto_id: l.producto_id,
      producto_nombre: l.producto_nombre,
      cantidad: l.cantidad,
      costo_unitario: l.costo_unitario_pyg,
      costo_unitario_original: l.costo_unitario_input,
      iva_tipo: l.iva_tipo,
      subtotal: l.subtotal,
      monto_iva: l.monto_iva,
      total: l.total,
      precio_venta: l.precio_venta,
      margen_venta: l.margen_venta ?? 0,
    }));

    setSubmitting(true);
    try {
      // Subir comprobante primero (si hay) para asociarlo a toda la compra.
      let comprobante: { comprobante_storage_path: string; comprobante_nombre: string; comprobante_mime_type: string } | null = null;
      if (comprobanteFile) {
        const up = await uploadComprobante(comprobanteFile);
        if (!up.ok) { setErrorSubmit(`Comprobante: ${up.error}`); return; }
        comprobante = up.data;
      }

      const res = await saveCompraMulti(
        {
          proveedor_id: String(proveedor.id),
          proveedor_nombre: proveedor.nombre,
          moneda: cab.moneda,
          tipo_cambio: tipoCambioNum,
          tipo_pago: cab.tipo_pago,
          plazo_dias: cab.tipo_pago === "credito" && cab.plazo_dias ? parseInt(cab.plazo_dias) : undefined,
          nro_timbrado: cab.nro_timbrado,
          numero_factura: cab.numero_factura,
          comprobante_storage_path: comprobante?.comprobante_storage_path ?? null,
          comprobante_nombre: comprobante?.comprobante_nombre ?? null,
          comprobante_mime_type: comprobante?.comprobante_mime_type ?? null,
        },
        items
      );
      if (!res.success) { setErrorSubmit(res.error); return; }
      if (res.warning) alert(res.warning);
      router.push("/compras");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Inline proveedor ─────────────────────────────────────────────────────────
  function handleProveedorInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.name === "ruc") setErrorRuc(null);
    const { name, value, type } = e.target;
    let normalized = value;
    if (name === "email" || type === "email") normalized = value.toLowerCase();
    else if (["nombre", "contacto"].includes(name)) normalized = value.toUpperCase();
    setFormProveedor((prev) => ({ ...prev, [name]: normalized }));
  }
  async function handleAgregarProveedor() {
    if (!formProveedor.nombre.trim() || !formProveedor.ruc.trim()) return;
    setErrorRuc(null);
    const dup = await proveedorExiste(formProveedor.ruc);
    if (dup) { setErrorRuc(`RUC ya registrado para "${dup.nombre}".`); return; }
    const resultado = await createProveedor({
      nombre: formProveedor.nombre.trim().toUpperCase(), ruc: formProveedor.ruc.trim(),
      telefono: formProveedor.telefono.trim(), email: formProveedor.email.trim(),
      contacto: formProveedor.contacto.trim().toUpperCase(), direccion: "", estado: "activo",
    });
    if (!resultado.ok) { setErrorRuc(resultado.error); return; }
    await recargarProveedores();
    setCab((prev) => ({ ...prev, proveedor_id: String(resultado.proveedor.id) }));
    setProveedorCreado(resultado.proveedor.nombre);
    setMostrarFormProveedor(false);
    setFormProveedor({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  }
  function handleCancelarProveedor() {
    setMostrarFormProveedor(false);
    setFormProveedor({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
    setErrorRuc(null);
  }

  // ── Inline producto ──────────────────────────────────────────────────────────
  function handleProductoInputChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    if (e.target.name === "sku") setErrorSku(null);
    setFormProducto((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }
  /** Autogenera el próximo SKU según el tipo (REV/MEN/MP), usando el endpoint del sistema. */
  async function generarSku() {
    setGenerandoSku(true);
    setErrorSku(null);
    try {
      const res = await fetch(`/api/productos/sku-sugerencias?tipo=${formProducto.tipo}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok && json?.success && json.data?.sugerido) {
        setFormProducto((prev) => ({ ...prev, sku: String(json.data.sugerido) }));
      }
    } catch {
      /* no bloquea: el usuario puede escribir el SKU a mano */
    } finally {
      setGenerandoSku(false);
    }
  }
  async function handleAgregarProducto() {
    if (!formProducto.nombre.trim() || !formProducto.sku.trim()) return;
    setErrorSku(null);
    const dup = await productoExiste(formProducto.sku, formProducto.nombre);
    if (dup) { setErrorSku(`Ya existe un producto con ese SKU o nombre ("${dup.nombre}" — ${dup.sku}).`); return; }
    // Mapear el tipo elegido a los flags del producto (igual que en Inventario → Nuevo).
    const flags =
      formProducto.tipo === "materia"
        ? { es_vendible: false, es_insumo: true, controla_stock: false }
        : formProducto.tipo === "menu"
        ? { es_vendible: true, es_insumo: false, controla_stock: false }
        : { es_vendible: true, es_insumo: false, controla_stock: true };
    const creado = await saveProducto({
      nombre: formProducto.nombre.trim().toUpperCase(), sku: formProducto.sku.trim().toUpperCase(),
      unidad_medida: formProducto.unidad_medida.toUpperCase(), metodo_valuacion: formProducto.metodo_valuacion,
      stock_actual: 0, stock_minimo: parseInt(formProducto.stock_minimo) || 0,
      costo_promedio: 0, precio_venta: parseFloat(formProducto.precio_venta_sugerido) || 0,
      tipo_producto: formProducto.tipo_producto,
      ...flags,
    });
    if (!creado) return;
    // Recién creado: se agrega como línea de la compra (auto-cargado).
    agregarProducto(creado);
    setProductoCreado(creado.nombre);
    setMostrarFormProducto(false);
    setFormProducto({ nombre: "", sku: "", unidad_medida: "Unidad", metodo_valuacion: "CPP", stock_minimo: "0", precio_venta_sugerido: "", tipo: "reventa", tipo_producto: "reventa" });
  }
  function handleCancelarProducto() {
    setMostrarFormProducto(false);
    setFormProducto({ nombre: "", sku: "", unidad_medida: "Unidad", metodo_valuacion: "CPP", stock_minimo: "0", precio_venta_sugerido: "", tipo: "reventa", tipo_producto: "reventa" });
    setErrorSku(null);
  }

  const monedaLabel = cab.moneda === "USD" ? "USD" : "Gs.";

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-800">Nueva compra</h1>
        <p className="text-gray-600">Una compra puede tener varios productos del mismo proveedor. Impacta el inventario al guardar.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-4xl">
        <form className="space-y-8" onSubmit={handleSubmit}>

          {/* ── Cabecera ─────────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Comprobante y proveedor</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>N° de timbrado <span className="text-red-500">*</span></label>
                <input type="text" name="nro_timbrado" value={cab.nro_timbrado}
                  onChange={(e) => setCab((p) => ({ ...p, nro_timbrado: e.target.value }))}
                  placeholder="Ej: 001-001-0000001" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>N° de factura <span className="text-red-500">*</span></label>
                <input type="text" name="numero_factura" value={cab.numero_factura}
                  onChange={(e) => setCab((p) => ({ ...p, numero_factura: e.target.value }))}
                  placeholder="Ej: 001-001-0000123" className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Proveedor <span className="text-red-500">*</span></label>
                <ProveedorBuscador
                  proveedores={proveedores}
                  value={cab.proveedor_id}
                  onSelect={(id) => { setCab((p) => ({ ...p, proveedor_id: id })); setProveedorCreado(null); }}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Comprobante / factura <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleComprobanteChange}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#4FAEB2] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-[#3F8E91]"
                />
                {comprobanteFile && !comprobanteError && (
                  <p className="mt-1.5 text-xs text-green-600">✓ {comprobanteFile.name} listo para subir al guardar.</p>
                )}
                {comprobanteError && <p className="mt-1.5 text-xs text-red-600">{comprobanteError}</p>}
                <p className="mt-1 text-xs text-gray-400">JPG, PNG, WebP o PDF — máx. 10 MB. Se asocia a toda la compra.</p>
              </div>
            </div>

            {proveedorCreado && (
              <p className="text-xs text-green-600">✓ Proveedor &quot;{proveedorCreado}&quot; creado y seleccionado.</p>
            )}
            {!mostrarFormProveedor ? (
              <button type="button" onClick={() => { setMostrarFormProveedor(true); setProveedorCreado(null); }}
                className="text-xs text-gray-400 hover:text-gray-700 underline transition-colors">
                ¿No encontrás el proveedor? Crear nuevo
              </button>
            ) : (
              <InlineFormBox titulo="Nuevo proveedor" onCancel={handleCancelarProveedor} onSave={handleAgregarProveedor}
                saveDisabled={!formProveedor.nombre.trim() || !formProveedor.ruc.trim()}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelSmClass}>Nombre / Razón social <span className="text-red-500">*</span></label>
                    <input type="text" name="nombre" value={formProveedor.nombre} onChange={handleProveedorInputChange}
                      placeholder="Ej: DISTRIBUIDORA SUR S.A." className={`${inputSmClass} uppercase`} />
                  </div>
                  <div>
                    <label className={labelSmClass}>RUC <span className="text-red-500">*</span></label>
                    <input type="text" name="ruc" value={formProveedor.ruc} onChange={handleProveedorInputChange}
                      placeholder="Ej: 80012345-1" className={`${inputSmClass} ${errorRuc ? "border-red-300 bg-red-50" : ""}`} />
                    {errorRuc && <p className="mt-1 text-xs text-red-600">{errorRuc}</p>}
                  </div>
                  <div>
                    <label className={labelSmClass}>Teléfono</label>
                    <input type="text" name="telefono" value={formProveedor.telefono} onChange={handleProveedorInputChange}
                      placeholder="Ej: 0981 111 222" className={inputSmClass} />
                  </div>
                  <div>
                    <label className={labelSmClass}>Email</label>
                    <input type="email" name="email" value={formProveedor.email} onChange={handleProveedorInputChange}
                      placeholder="Ej: ventas@empresa.com" className={inputSmClass} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelSmClass}>Persona de contacto</label>
                    <input type="text" name="contacto" value={formProveedor.contacto} onChange={handleProveedorInputChange}
                      placeholder="Ej: CARLOS MENDOZA" className={`${inputSmClass} uppercase`} />
                  </div>
                </div>
              </InlineFormBox>
            )}
          </section>

          {/* ── Condiciones + moneda ─────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Condiciones y moneda</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Tipo de pago</label>
                <SegmentedControl<TipoPago> value={cab.tipo_pago}
                  options={[{ value: "contado", label: "Contado" }, { value: "credito", label: "Crédito" }]}
                  onChange={(v) => setCab((p) => ({ ...p, tipo_pago: v }))} />
              </div>
              <div>
                <label className={labelClass}>Moneda</label>
                <SegmentedControl<Moneda> value={cab.moneda}
                  options={[{ value: "PYG", label: "Guaraníes (₲)" }, { value: "USD", label: "Dólares (USD)" }]}
                  onChange={(v) => setCab((p) => ({ ...p, moneda: v, tipo_cambio: "" }))} />
              </div>
              {cab.tipo_pago === "credito" && (
                <div>
                  <label className={labelClass}>Plazo (días)</label>
                  <input type="number" value={cab.plazo_dias} onChange={(e) => setCab((p) => ({ ...p, plazo_dias: e.target.value }))}
                    placeholder="Ej: 30" className={inputClass} min={1} />
                </div>
              )}
              {cab.moneda === "USD" && (
                <div>
                  <label className={labelClass}>Tipo de cambio (USD → Gs.) <span className="text-red-500">*</span></label>
                  <MontoInput value={cab.tipo_cambio} onChange={(n) => setCab((p) => ({ ...p, tipo_cambio: String(n) }))}
                    placeholder="Ej: 7500" className={inputClass} decimals={false} />
                </div>
              )}
            </div>
          </section>

          {/* ── Productos de la compra ───────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Productos de la compra</SectionTitle>

            {/* Buscador: cada producto que elegís se agrega a la lista de abajo */}
            <div className="rounded-xl border border-dashed border-slate-300 p-4 space-y-3 bg-slate-50/40">
              <label className={labelSmClass}>Buscá y agregá productos <span className="text-red-500">*</span></label>
              <ProductoBuscadorInline
                excludeIds={lineas.map((l) => l.producto_id)}
                onSelect={agregarProducto}
              />
              {productoCreado && (
                <p className="text-xs text-green-600">✓ Producto &quot;{productoCreado}&quot; creado y agregado a la compra.</p>
              )}
              {errorLinea && <p className="text-xs text-red-600">{errorLinea}</p>}
              {!mostrarFormProducto ? (
                <button type="button" onClick={() => { setMostrarFormProducto(true); setProductoCreado(null); }}
                  className="text-xs text-gray-400 hover:text-gray-700 underline transition-colors">
                  ¿No encontrás el producto? Crear nuevo
                </button>
              ) : (
                <InlineFormBox titulo="Nuevo producto" onCancel={handleCancelarProducto} onSave={handleAgregarProducto}
                  saveDisabled={!formProducto.nombre.trim() || !formProducto.sku.trim()}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="col-span-2">
                      <label className={labelSmClass}>Tipo de producto</label>
                      <SegmentedControl<"reventa" | "repuesto"> small value={formProducto.tipo_producto}
                        options={[
                          { value: "reventa", label: "Reventa" },
                          { value: "repuesto", label: "Repuesto" },
                        ]}
                        onChange={(v) => setFormProducto((prev) => ({ ...prev, tipo_producto: v }))} />
                      <p className="mt-1.5 text-xs text-slate-500">
                        {formProducto.tipo_producto === "repuesto"
                          ? "Repuesto: entra al inventario y se descuenta al usarse en un servicio (no se detalla en la factura)."
                          : "Reventa: mercadería que se compra y se revende tal cual."}
                      </p>
                    </div>
                    <div>
                      <label className={labelSmClass}>Nombre <span className="text-red-500">*</span></label>
                      <input type="text" name="nombre" value={formProducto.nombre} onChange={handleProductoInputChange}
                        placeholder="Ej: CHÍA 500G" className={`${inputSmClass} uppercase`} />
                    </div>
                    <div>
                      <label className={labelSmClass}>SKU / Código <span className="text-red-500">*</span></label>
                      <div className="flex gap-2">
                        <input type="text" name="sku" value={formProducto.sku} onChange={handleProductoInputChange}
                          placeholder="Ej: CHIA-500" className={`${inputSmClass} uppercase ${errorSku ? "border-red-300 bg-red-50" : ""}`} />
                        <button type="button" onClick={generarSku} disabled={generandoSku}
                          title="Generar el próximo SKU según el tipo (REV/MEN/MP)"
                          className="shrink-0 rounded-lg border border-[#4FAEB2]/40 bg-white px-3 text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/10 disabled:opacity-50 disabled:cursor-not-allowed">
                          {generandoSku ? "…" : "Generar"}
                        </button>
                      </div>
                      {errorSku && <p className="mt-1 text-xs text-red-600">{errorSku}</p>}
                    </div>
                    <div>
                      <label className={labelSmClass}>Unidad de medida</label>
                      <FancySelect
                        ariaLabel="Unidad de medida"
                        size="sm"
                        value={formProducto.unidad_medida}
                        onChange={(v) =>
                          handleProductoInputChange({
                            target: { name: "unidad_medida", value: v },
                          } as React.ChangeEvent<HTMLInputElement>)
                        }
                        options={["Unidad", "Kg", "G", "Litro", "Caja"].map((u) => ({ value: u, label: u }))}
                      />
                    </div>
                    <div>
                      <label className={labelSmClass}>Stock mínimo</label>
                      <input type="number" name="stock_minimo" value={formProducto.stock_minimo} onChange={handleProductoInputChange}
                        placeholder="Ej: 5" min={0} className={inputSmClass} />
                    </div>
                    {formProducto.tipo !== "materia" && (
                      <div className="col-span-2">
                        <label className={labelSmClass}>Precio de venta sugerido (Gs.)</label>
                        <MontoInput value={formProducto.precio_venta_sugerido}
                          onChange={(n) => setFormProducto((prev) => ({ ...prev, precio_venta_sugerido: String(n) }))}
                          placeholder="Ej: 25000" className={inputSmClass} decimals={false} />
                      </div>
                    )}
                  </div>
                </InlineFormBox>
              )}
            </div>

            {/* Tabla editable de líneas */}
            {lineas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                Todavía no agregaste productos. Buscá arriba y hacé clic para cargarlos.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="bg-slate-50 text-gray-500">
                    <tr>
                      <th className="py-2 px-3 font-medium">Producto</th>
                      <th className="py-2 px-3 font-medium text-right w-20">Cant.</th>
                      <th className="py-2 px-3 font-medium text-right w-32">Costo unit. ({monedaLabel})</th>
                      <th className="py-2 px-3 font-medium w-32">IVA</th>
                      <th className="py-2 px-3 font-medium text-right w-32">Precio venta</th>
                      <th className="py-2 px-3 font-medium text-right">Total línea</th>
                      <th className="py-2 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l, i) => (
                      <tr key={l.producto_id} className="border-t border-slate-100 align-top">
                        <td className="py-2 px-3">
                          <div className="font-medium text-gray-800">{l.producto_nombre}</div>
                          <div className="font-mono text-[11px] text-gray-400">{l.sku}</div>
                          {l.es_insumo_no_vendible && (
                            <span className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Materia prima</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min={0}
                              step={pasoCantidad(l.unidad_medida)}
                              inputMode={permiteDecimales(l.unidad_medida) ? "decimal" : "numeric"}
                              value={l.cantidad || ""}
                              onChange={(e) => {
                                const n = parseCantidad(e.target.value, l.unidad_medida);
                                editarLinea(i, { cantidad: n ?? 0 });
                              }}
                              onBlur={(e) => {
                                const n = parseCantidad(e.target.value, l.unidad_medida);
                                editarLinea(i, { cantidad: n && n > 0 ? n : 0 });
                              }}
                              className={`rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 ${
                                permiteDecimales(l.unidad_medida) ? "w-24" : "w-16"
                              }`}
                            />
                            <span className="text-[10px] uppercase text-slate-400">{l.unidad_medida}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <MontoInput value={l.costo_unitario_input}
                            onChange={(n) => editarLinea(i, { costo_unitario_input: n })}
                            decimals={cab.moneda === "USD"}
                            className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20" />
                          {cab.moneda === "USD" && l.costo_unitario_pyg > 0 && (
                            <div className="mt-0.5 text-right text-[10px] text-gray-400">≈ {formatGs(l.costo_unitario_pyg)}</div>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <FancySelect
                            ariaLabel="Tipo de IVA"
                            size="sm"
                            value={l.iva_tipo}
                            onChange={(v) => editarLinea(i, { iva_tipo: v as TipoIva })}
                            options={[
                              { value: "exenta", label: "Exenta" },
                              { value: "5", label: "IVA 5%" },
                              { value: "10", label: "IVA 10%" },
                            ]}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <MontoInput value={l.precio_venta}
                            onChange={(n) => editarLinea(i, { precio_venta: n })}
                            decimals={false}
                            placeholder={l.es_insumo_no_vendible ? "Opcional" : "0"}
                            className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20" />
                          {l.margen_venta !== null && (
                            <div className={`mt-0.5 text-right text-[10px] ${margenColor(l.margen_venta)}`}>Margen {l.margen_venta.toFixed(1)}%</div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-800">{formatGs(l.total)}</td>
                        <td className="py-2 px-2 text-right">
                          <button type="button" onClick={() => handleQuitarLinea(i)}
                            className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600" aria-label="Quitar línea">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/60">
                      <td className="py-2 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500" colSpan={5}>
                        Total compra ({lineas.length} {lineas.length === 1 ? "ítem" : "ítems"})
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-bold text-[#0EA5E9]">{formatGs(totales.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* ── Totales generales ────────────────────────────────────────────── */}
          {lineas.length > 0 && (
            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Subtotal</p>
                <p className="text-sm font-semibold tabular-nums text-gray-700">{formatGs(totales.subtotal)}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 text-center">
                <p className="text-xs text-gray-400 mb-1">IVA</p>
                <p className="text-sm font-semibold tabular-nums text-gray-700">{formatGs(totales.iva)}</p>
              </div>
              <div className="bg-[#0EA5E9] text-white rounded-lg px-3 py-3 text-center">
                <p className="text-xs text-gray-200 mb-1">Total compra</p>
                <p className="text-sm font-bold tabular-nums">{formatGs(totales.total)}</p>
              </div>
            </section>
          )}

          {errorSubmit && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{errorSubmit}</p>
            </div>
          )}

          <div className="flex gap-4 pt-2">
            <button type="submit" disabled={lineas.length === 0 || submitting}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-5 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
              {submitting ? "Guardando..." : "Guardar compra"}
            </button>
            <button type="button" onClick={() => router.push("/compras")}
              className="border border-slate-200 px-5 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{children}</h3>;
}

/**
 * Buscador de proveedor (una sola selección). Filtra por nombre o RUC. Al
 * elegir muestra un "chip" con el proveedor; la X vuelve a la búsqueda.
 */
function ProveedorBuscador({
  proveedores,
  value,
  onSelect,
}: {
  proveedores: Proveedor[];
  value: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
    onSelect(String(p.id));
    setQuery("");
    setOpen(false);
    setHl(-1);
  }

  if (selected) {
    return (
      <div className="flex h-[42px] items-center justify-between gap-2 rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.06] px-3 shadow-sm">
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-slate-800">{selected.nombre}</span>
          {selected.ruc && <span className="ml-2 text-xs text-slate-500">RUC {selected.ruc}</span>}
        </span>
        <button
          type="button"
          onClick={() => { onSelect(""); setQuery(""); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
          className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
          aria-label="Cambiar proveedor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
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
  );
}

function InlineFormBox({
  titulo, children, onSave, onCancel, saveDisabled,
}: {
  titulo: string; children: React.ReactNode; onSave: () => void; onCancel: () => void; saveDisabled: boolean;
}) {
  return (
    <div className="mt-4 border border-gray-200 rounded-xl p-4 bg-white space-y-4">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{titulo}</p>
      {children}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onSave} disabled={saveDisabled}
          className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
          Guardar {titulo.toLowerCase()}
        </button>
        <button type="button" onClick={onCancel}
          className="border border-slate-200 px-4 py-2 rounded-lg text-xs hover:bg-white transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  );
}
