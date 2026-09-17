"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Minus, Trash2, ImageIcon, Wallet } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import { FancySelect } from "@/components/ui/FancySelect";
import ProductPickerModal, { type ProductoPickerItem, type AgregarVentaPayload } from "@/components/inventario/ProductPickerModal";
import { saveVenta, type FaltanteStock } from "@/lib/ventas/storage";
import { getProductos } from "@/lib/inventario/storage";
import CrearClienteModal, { type ClienteCreado } from "@/components/clientes/CrearClienteModal";
import { apiCreateCliente } from "@/lib/api/client";
import type { ConsultaRucSetOk } from "@/lib/set/use-consulta-ruc";
import { generarYAbrirRecibo } from "@/lib/recibos/client";
import type { TipoIvaVenta, TipoVenta, MonedaVenta, LineaVenta, MetodoPago, TipoPrecioVenta } from "@/lib/ventas/types";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import {
  permiteDecimales, pasoCantidad, clampCantidad,
  formatStockConUnidad,
} from "@/lib/productos/unidades";
import CantidadInput from "@/components/ui/CantidadInput";
import type { Producto, MetodoValuacion } from "@/lib/inventario/types";
import { useConsultaRucSet } from "@/lib/set/use-consulta-ruc";

/** Miniatura de producto con fallback a un placeholder si no hay imagen o falla. */
function ProductoThumb({ url, alt, size = "h-10 w-10" }: { url?: string | null; alt: string; size?: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className={`flex ${size} shrink-0 items-center justify-center rounded-md border border-slate-100 bg-slate-50 text-slate-300`}>
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading="lazy" onError={() => setErr(true)} className={`${size} shrink-0 rounded-md border border-slate-100 object-cover`} />;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

/**
 * IVA INCLUIDO: el precio de venta ya contiene el IVA. `total` es precio × cantidad
 * (= total de la línea). El IVA se desglosa desde adentro, NO se suma encima.
 *   EXENTA → 0 · 5% → total - total/1.05 · 10% → total - total/1.10
 */
function calcIva(tipo: TipoIvaVenta, total: number) {
  if (tipo === "EXENTA") return 0;
  if (tipo === "5%")     return total - total / 1.05;
  return total - total / 1.10;
}

/**
 * Precio unitario (Gs.) según el tipo elegido, con fallbacks:
 *  minorista → precio_venta;
 *  mayorista → precio_mayorista (>0) o fallback a precio_venta;
 *  costo     → costo_promedio.
 */
function precioPorTipo(p: Producto, tipo: TipoPrecioVenta): number {
  if (tipo === "mayorista") return p.precio_mayorista != null && p.precio_mayorista > 0 ? p.precio_mayorista : p.precio_venta;
  if (tipo === "distribuidor") return p.precio_distribuidor != null && p.precio_distribuidor > 0 ? p.precio_distribuidor : p.precio_venta;
  if (tipo === "costo") return p.costo_promedio ?? 0; // histórico: ya no se ofrece en la UI
  return p.precio_venta;
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

/** Tipos de precio ofrecidos en la UI (sin 'costo', que queda solo como histórico). */
const TIPOS_PRECIO_UI: TipoPrecioVenta[] = ["minorista", "mayorista", "distribuidor"];

const tipoPrecioLabel: Record<TipoPrecioVenta, string> = {
  minorista: "Minorista",
  mayorista: "Mayorista",
  distribuidor: "Distribuidor",
  costo: "Al costo",
};

// ── Estilos ────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

// ── Sub-componentes ───────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex border border-slate-200 rounded-lg overflow-hidden ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            value === opt.value
              ? "bg-[#0EA5E9] text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

const ivaLabel: Record<TipoIvaVenta, string> = {
  EXENTA: "Exenta",
  "5%":   "5%",
  "10%":  "10%",
};

// ── Componente principal ───────────────────────────────────────────────────────

export default function NuevaVentaPage() {
  const router = useRouter();

  // ── Estado global ──────────────────────────────────────────────────────────
  const [productos, setProductos]   = useState<Producto[]>([]);
  const [items, setItems]           = useState<LineaVenta[]>([]);
  const [errorLinea, setErrorLinea] = useState<string | null>(null);
  const [errorVenta, setErrorVenta] = useState<string | null>(null);
  const [emitirFactura, setEmitirFactura] = useState(false);
  // Venta sin stock: faltantes devueltos por el backend + modal de confirmación.
  const [faltantes, setFaltantes] = useState<FaltanteStock[]>([]);
  const [confirmSinStockOpen, setConfirmSinStockOpen] = useState(false);
  // Panel post-venta: tras confirmar, ofrece abrir ticket y (si aplica) nota de remisión.
  const [postVenta, setPostVenta] = useState<{ id: string; numero: string; generaNota: boolean; credito: boolean } | null>(null);
  // Guard anti doble-submit: estado para UI (botón/spinner) + ref para bloqueo síncrono
  // inmediato (React puede tardar en aplicar el estado; el ref corta el segundo disparo ya).
  const [guardando, setGuardando] = useState(false);
  const isSubmittingRef = useRef(false);
  // Emision de la nota de remision desde el panel post-venta (spinner en el boton).
  const [remitiendoPostVenta, setRemitiendoPostVenta] = useState(false);

  /**
   * Nota de remision por el TOTAL de la venta recien registrada. Lee el
   * pendiente del resumen para no asumir cantidades, arma la NR entregando todo
   * lo pendiente y abre el PDF imprimible en una pestaña nueva.
   */
  async function generarRemisionDeVenta() {
    if (!postVenta) return;
    setRemitiendoPostVenta(true);
    setErrorVenta(null);
    try {
      const resR = await fetchWithSupabaseSession(`/api/ventas/${postVenta.id}/remisiones`, { cache: "no-store" });
      const jR = await resR.json();
      if (!resR.ok || !jR.success) throw new Error(jR.error ?? "No se pudo leer la venta.");
      const lineas = (jR.data?.resumen?.lineas ?? []) as Array<{ venta_item_id: string; pendiente: number }>;
      const items = lineas
        .filter((l) => Number(l.pendiente) > 0)
        .map((l) => ({ venta_item_id: l.venta_item_id, cantidad: Number(l.pendiente) }));
      if (items.length === 0) throw new Error("Esta venta ya esta totalmente remitida.");

      const res = await fetchWithSupabaseSession(`/api/ventas/${postVenta.id}/remisiones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? "No se pudo generar la nota de remision.");
      try { window.open(`/api/ventas/remisiones/${j.data.remision_id}/pdf?auto=1`, "_blank", "noopener"); } catch {}
    } catch (e) {
      setErrorVenta(e instanceof Error ? e.message : "Error al generar la nota de remision.");
    } finally {
      setRemitiendoPostVenta(false);
    }
  }

  // Facturación de un pedido enviado a Caja (?pedido_id=...). Precarga items + cliente.
  const [pedidoId, setPedidoId] = useState<string | null>(null);
  const [pedidoNumero, setPedidoNumero] = useState<string | null>(null);
  // Pedido del modulo Consulta (?pedido_caja_id=...). Flujo paralelo,
  // independiente del legacy proyectos.
  const [pedidoCajaId, setPedidoCajaId] = useState<string | null>(null);
  const [pedidoCajaTitulo, setPedidoCajaTitulo] = useState<string | null>(null);

  // ── Caja activa (múltiples cajas) ─────────────────────────────────────────
  // La venta se asocia a la caja abierta activa del cajero. Si hay varias, elige.
  const [cajasAbiertas, setCajasAbiertas] = useState<{ id: string; numero_caja: number }[]>([]);
  const [cajaActivaId, setCajaActivaId] = useState<string>("");

  // ── Condiciones de la venta ───────────────────────────────────────────────
  // Instancia dedicada: siempre Guaraníes.
  const moneda: MonedaVenta = "GS";

  // Contado / Crédito (campos ya existentes en `ventas`: tipo_venta + plazo_dias).
  const [tipoVenta, setTipoVenta] = useState<TipoVenta>("CONTADO");
  const [plazoDias, setPlazoDias] = useState("");

  // Cliente (opcional). Si se selecciona, se envía cliente_id al crear la venta.
  type ClienteLite = { id: string; label: string; ruc: string | null; usa_nota_remision: boolean };
  // Perfil sin costos (vendedor): oculta la columna Costo y la ganancia de líneas manuales.
  const { isAdmin } = useIsAdmin();
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const clienteContainerRef = useRef<HTMLDivElement>(null);
  const consultaSet = useConsultaRucSet();
  /** Datos crudos de la última respuesta SET, para autocrear el cliente
   *  al confirmar la venta cuando no está en el catálogo. */
  const [datoClienteSet, setDatoClienteSet] = useState<ConsultaRucSetOk | null>(null);
  // Nota de remisión: activada si el cliente la usa; toggle manual solo con cliente.
  const [generaNotaRemision, setGeneraNotaRemision] = useState(false);

  // Modal de alta rápida de cliente (crea en el módulo Clientes + lo selecciona).
  const [showCrearCliente, setShowCrearCliente] = useState(false);

  /**
   * Saldo a favor del cliente elegido. Se consulta al seleccionarlo para poder
   * avisarle al cajero que tiene crédito disponible.
   */
  useEffect(() => {
    let cancel = false;
    if (!clienteId) { setSaldoFavor(0); setUsarSaldo(0); return; }
    fetchWithSupabaseSession(`/api/clientes/${clienteId}/saldo-favor`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancel) { setSaldoFavor(Number(j?.data?.saldo) || 0); setUsarSaldo(0); } })
      .catch(() => { if (!cancel) { setSaldoFavor(0); setUsarSaldo(0); } });
    return () => { cancel = true; };
  }, [clienteId]);

  function handleClienteCreado(c: ClienteCreado) {
    setClientes((prev) => [c, ...prev.filter((x) => x.id !== c.id)]);
    setClienteId(c.id);
    setClienteQuery("");
    setGeneraNotaRemision(c.usa_nota_remision);
    setShowCrearCliente(false);
  }

  // ── Saldo a favor del cliente (crédito por devoluciones) ──────────────────
  const [saldoFavor, setSaldoFavor] = useState(0);
  /** Cuánto de ese saldo se aplica a ESTA venta (el resto queda como crédito). */
  const [usarSaldo, setUsarSaldo] = useState(0);
  /** El cliente pide llevarse el excedente en efectivo (egreso de caja). */
  const [retirarExcedente, setRetirarExcedente] = useState(false);

  // ── Cobro (solo CONTADO, no se persiste — solo ayuda al cajero) ───────────
  const [montoRecibido, setMontoRecibido] = useState("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo");

  // ── Detalle de cobro (conciliación bancaria) ──────────────────────────────
  const [entidades, setEntidades] = useState<{ id: string; codigo: string | null; nombre: string; tipo: string | null }[]>([]);
  const [pagoEntidadId, setPagoEntidadId] = useState("");
  const [pagoReferencia, setPagoReferencia] = useState("");
  const [pagoTitular, setPagoTitular] = useState("");
  const [pagoObservacion] = useState("");
  // Monto cobrado por el medio (transferencia/tarjeta). Se precarga con lo que
  // resta cobrar y el cajero lo puede ajustar.
  const [pagoMonto, setPagoMonto] = useState(0);
  // Modal de cobro (transferencia / tarjeta) + buscador de entidad.
  const [cobroModalOpen, setCobroModalOpen] = useState(false);
  const [entidadQuery, setEntidadQuery] = useState("");
  const [cobroError, setCobroError] = useState<string | null>(null);
  // Cobro MIXTO: varias líneas de pago (efectivo + transferencia + tarjeta…).
  type PagoMixto = { key: number; metodo: "efectivo" | "transferencia" | "tarjeta"; monto: number; entidadId: string; referencia: string; titular: string };
  const [pagosMixtos, setPagosMixtos] = useState<PagoMixto[]>([]);
  const mixtoSeq = useRef(0);

  // ── Combobox de producto (búsqueda server-side por tokens sobre todo el catálogo) ──
  const [comboQuery,     setComboQuery]     = useState("");
  const [comboOpen,      setComboOpen]      = useState(false);
  const [comboHighlight, setComboHighlight] = useState(-1);
  const [comboHits,      setComboHits]      = useState<Producto[]>([]);
  const [comboBuscando,  setComboBuscando]  = useState(false);
  const comboInputRef    = useRef<HTMLInputElement>(null);
  const comboContainerRef = useRef<HTMLDivElement>(null);
  const comboTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Modal buscador (F3) ────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);

  function pickerToProducto(p: ProductoPickerItem): Producto {
    return {
      id: p.id,
      nombre: p.nombre,
      sku: p.sku,
      precio_venta: p.precio_venta,
      precio_mayorista: p.precio_mayorista ?? null,
      precio_distribuidor: p.precio_distribuidor ?? null,
      stock_actual: p.stock_actual,
      unidad_medida: p.unidad_medida,
      costo_promedio: p.costo_promedio ?? 0,
      stock_minimo: 0,
      metodo_valuacion: "CPP",
      codigo_barras: p.codigo_barras,
      codigo_barras_interno: p.codigo_barras_interno,
      imagen_path: null,
      imagen_url: p.imagen_url,
    };
  }

  /**
   * Agregado directo desde el modal: arma la LineaVenta usando la misma
   * logica que handleAgregarLinea pero con datos del modal, sin pasar
   * por el form inline. Mantiene el modal abierto si todo OK.
   */
  function handleAgregarDesdePicker(payload: AgregarVentaPayload): boolean {
    const {
      producto: p,
      cantidad,
      precio_input,
      iva,
      tipo_precio,
      presentacion_id,
      presentacion_nombre,
      presentacion_cantidad_base,
    } = payload;
    const precioPyg = precio_input;
    // Verificar stock vs lo ya cargado SOLO si el producto controla stock.
    // Venta sin stock (Fase 5): NO se bloquea por falta de stock al agregar; la
    // confirmación se pide al registrar la venta. El Menú (controla_stock=false) tampoco valida.
    // IVA incluido: el total de la línea es precio × cantidad; el IVA se desglosa
    // desde adentro y el subtotal (base imponible) = total − IVA.
    const totalLinea = cantidad * precioPyg;
    const montoIva = calcIva(iva, totalLinea);
    const subtotal = totalLinea - montoIva;

    // Asegurar que el producto este en el array local (para que stock_actual
    // se conozca en validaciones posteriores del form inline).
    const prodLocal = pickerToProducto(p);
    setProductos((prev) => (prev.find((x) => x.id === prodLocal.id) ? prev : [...prev, prodLocal]));

    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku,
        cantidad,
        unidad_medida: p.unidad_medida ?? "UNIDAD",
        precio_venta_original: precio_input,
        precio_venta: precioPyg,
        tipo_iva: iva,
        tipo_precio,
        // El modal ya definió cantidad, tipo y precio: se respeta (manual).
        precio_manual: true,
        subtotal,
        monto_iva: montoIva,
        total_linea: totalLinea,
        presentacion_id: presentacion_id ?? null,
        presentacion_nombre: presentacion_nombre ?? null,
        presentacion_cantidad_base: presentacion_cantidad_base ?? null,
      },
    ]);
    setErrorVenta(null);
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    getProductos().then((data) => {
      if (!cancelled) setProductos(data);
    });
    return () => { cancelled = true; };
  }, []);

  // Precarga al facturar un pedido (Caja): lee ?pedido_id=, trae el pedido y carga sus
  // items + cliente en el carrito. NO crea nada acá; la venta se genera al confirmar.
  useEffect(() => {
    let cancelled = false;
    let pid: string | null = null;
    try {
      pid = new URLSearchParams(window.location.search).get("pedido_id");
    } catch { pid = null; }
    if (!pid) return;
    setPedidoId(pid);
    (async () => {
      try {
        const res = await fetch(`/api/proyectos/${pid}`, { credentials: "include", cache: "no-store" });
        const j = await res.json();
        if (cancelled || !j?.success || !j.data?.proyecto) return;
        const p = j.data.proyecto as { brief_data?: unknown; cliente_id?: string | null; metadata?: unknown };
        const brief = (p.brief_data && typeof p.brief_data === "object" && !Array.isArray(p.brief_data))
          ? (p.brief_data as Record<string, unknown>) : {};
        const meta = (p.metadata && typeof p.metadata === "object" && !Array.isArray(p.metadata))
          ? (p.metadata as Record<string, unknown>) : {};
        setPedidoNumero(
          (typeof brief.numero_control === "string" && brief.numero_control) ||
          (typeof brief.numero_presupuesto === "string" && brief.numero_presupuesto) ||
          (typeof meta.numero_presupuesto === "string" && meta.numero_presupuesto) || null
        );
        const itemsRaw = Array.isArray(brief.items) ? (brief.items as Record<string, unknown>[]) : [];
        const lineas: LineaVenta[] = itemsRaw
          .filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0)
          .map((it) => {
            const cantidad = Number(it.cantidad) || 0;
            const precio = Number(it.precio_venta) || 0;
            const iva: TipoIvaVenta = "10%";
            // IVA incluido: total de línea = precio × cantidad; IVA desglosado desde adentro.
            const totalLinea = cantidad * precio;
            const montoIva = calcIva(iva, totalLinea);
            const subtotal = totalLinea - montoIva;
            return {
              producto_id: String(it.producto_id),
              producto_nombre: typeof it.producto_nombre === "string" ? it.producto_nombre : "",
              sku: typeof it.sku === "string" ? it.sku : "",
              unidad_medida: (typeof it.unidad_medida === "string" && it.unidad_medida) ? it.unidad_medida : "UNIDAD",
              cantidad,
              precio_venta_original: precio,
              precio_venta: precio,
              tipo_iva: iva,
              tipo_precio: "minorista" as TipoPrecioVenta,
              // El pedido ya vino con su precio: se respeta tal cual.
              precio_manual: true,
              subtotal,
              monto_iva: montoIva,
              total_linea: totalLinea,
            };
          });
        if (!cancelled && lineas.length) setItems(lineas);
        if (!cancelled && p.cliente_id) setClienteId(String(p.cliente_id));
      } catch { /* el aviso seguirá visible; el cajero puede cargar manualmente */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Precarga al cobrar un pedido del modulo Consulta (?pedido_caja_id=...):
  // trae el pedido y carga sus items + cliente en el carrito.
  useEffect(() => {
    let cancelled = false;
    let pid: string | null = null;
    try {
      pid = new URLSearchParams(window.location.search).get("pedido_caja_id");
    } catch { pid = null; }
    if (!pid) return;
    setPedidoCajaId(pid);
    (async () => {
      try {
        const res = await fetch(`/api/pedidos-caja/${pid}`, {
          credentials: "include",
          cache: "no-store",
        });
        const j = await res.json();
        if (cancelled || !j?.success || !j.data?.pedido) return;
        const p = j.data.pedido as {
          titulo: string;
          cliente_id?: string | null;
          items: Array<{
            producto_id: string;
            producto_nombre: string;
            sku: string | null;
            unidad_medida?: string | null;
            cantidad: number;
            precio_venta: number;
            tipo_precio?: "minorista" | "mayorista" | "distribuidor";
            tipo_iva?: "EXENTA" | "5%" | "10%";
            presentacion_id?: string | null;
            presentacion_nombre?: string | null;
            presentacion_cantidad_base?: number | null;
          }>;
        };
        setPedidoCajaTitulo(p.titulo);
        const lineas: LineaVenta[] = (p.items ?? [])
          .filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0)
          .map((it) => {
            const cantidad = Number(it.cantidad) || 0;
            const precio = Number(it.precio_venta) || 0;
            // IVA del pedido si vino; default 10% para items legacy.
            const iva: TipoIvaVenta =
              it.tipo_iva === "EXENTA" || it.tipo_iva === "5%" || it.tipo_iva === "10%"
                ? it.tipo_iva
                : "10%";
            const totalLinea = cantidad * precio;
            const montoIva = calcIva(iva, totalLinea);
            const subtotal = totalLinea - montoIva;
            return {
              producto_id: String(it.producto_id),
              producto_nombre: it.producto_nombre,
              sku: it.sku ?? "",
              unidad_medida: (typeof it.unidad_medida === "string" && it.unidad_medida) ? it.unidad_medida : "UNIDAD",
              cantidad,
              precio_venta_original: precio,
              precio_venta: precio,
              tipo_iva: iva,
              tipo_precio: (it.tipo_precio ?? "minorista") as TipoPrecioVenta,
              // El pedido ya vino con su precio y tipo: se respeta tal cual.
              precio_manual: true,
              subtotal,
              monto_iva: montoIva,
              total_linea: totalLinea,
              presentacion_id: it.presentacion_id ?? null,
              presentacion_nombre: it.presentacion_nombre ?? null,
              presentacion_cantidad_base: it.presentacion_cantidad_base ?? null,
            };
          });
        if (!cancelled && lineas.length) setItems(lineas);
        if (!cancelled && p.cliente_id) setClienteId(String(p.cliente_id));
      } catch { /* fallback: el cajero carga manualmente */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cargar entidades bancarias (caja/banco/tarjeta/billetera) para el detalle de cobro.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/entidades-bancarias", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.success) setEntidades(j.data?.entidades ?? []); })
      .catch(() => { /* no bloquea la venta si falla */ });
    return () => { cancelled = true; };
  }, []);

  // Cargar clientes (buscador opcional de cliente en la venta).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clientes", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.success || !Array.isArray(j.data)) return;
        const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        const lite: ClienteLite[] = (j.data as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          label: s(r.empresa) || s(r.nombre_contacto) || s(r.nombre) || "Cliente",
          ruc: s(r.ruc) || null,
          usa_nota_remision: r.usa_nota_remision === true,
        }));
        setClientes(lite);
      })
      .catch(() => { /* el buscador de cliente es opcional, no bloquea la venta */ });
    return () => { cancelled = true; };
  }, []);

  // UX rápida: al entrar, enfocar el autocompletar para empezar a cargar de una
  // (sin abrir modales). El "Buscador avanzado" (picker) queda a un clic.
  useEffect(() => {
    const t = setTimeout(() => comboInputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  // Autocomplete: búsqueda server-side por tokens (todo el catálogo), con debounce.
  useEffect(() => {
    const q = comboQuery.trim();
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    if (q.length < 2) { setComboHits([]); setComboBuscando(false); return; }
    setComboBuscando(true);
    comboTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/productos/search?q=${encodeURIComponent(q)}&limit=20`,
          { cache: "no-store" }
        );
        const j = await res.json();
        const items = ((j?.data?.items ?? []) as Record<string, unknown>[]).map((p): Producto => ({
          id: String(p.id),
          nombre: String(p.nombre ?? ""),
          sku: String(p.sku ?? ""),
          costo_promedio: Number(p.costo_promedio) || 0,
          precio_venta: Number(p.precio_venta) || 0,
          precio_mayorista: p.precio_mayorista != null ? Number(p.precio_mayorista) : null,
          precio_distribuidor: p.precio_distribuidor != null ? Number(p.precio_distribuidor) : null,
          cantidad_minima_mayorista: p.cantidad_minima_mayorista != null ? Number(p.cantidad_minima_mayorista) : null,
          stock_actual: Number(p.stock_actual) || 0,
          stock_minimo: Number(p.stock_minimo) || 0,
          unidad_medida: String(p.unidad_medida ?? "UNIDAD"),
          metodo_valuacion: (typeof p.metodo_valuacion === "string" ? p.metodo_valuacion : "CPP") as MetodoValuacion,
          es_vendible: p.es_vendible !== false,
          controla_stock: p.controla_stock !== false,
          imagen_url: (p.imagen_url as string | null) ?? null,
          imagen_path: (p.imagen_path as string | null) ?? null,
        }));
        setComboHits(items);
        // Merge a `productos` para que los lookups (tipo de precio, stock) resuelvan.
        if (items.length > 0) {
          setProductos((prev) => {
            const byId = new Map(prev.map((x) => [x.id, x]));
            for (const it of items) byId.set(it.id, { ...byId.get(it.id), ...it });
            return [...byId.values()];
          });
        }
      } catch {
        setComboHits([]);
      } finally {
        setComboBuscando(false);
      }
    }, 220);
    return () => { if (comboTimerRef.current) clearTimeout(comboTimerRef.current); };
  }, [comboQuery]);

  // Esta instancia no usa el módulo Caja: no se consulta el estado de cajas y
  // la venta no depende de tener una caja abierta.

  // Persistir la caja activa elegida (por navegador del cajero).
  useEffect(() => {
    try { if (cajaActivaId) localStorage.setItem("caja_activa_id", cajaActivaId); } catch { /* noop */ }
  }, [cajaActivaId]);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboContainerRef.current && !comboContainerRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
      if (clienteContainerRef.current && !clienteContainerRef.current.contains(e.target as Node)) {
        setClienteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll a la opción destacada en el dropdown
  useEffect(() => {
    if (comboHighlight >= 0) {
      document.getElementById(`combo-opt-${comboHighlight}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [comboHighlight]);

  // ── Cálculos ───────────────────────────────────────────────────────────────
  const tipoCambioNum = 1;

  const totalSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const totalIva      = items.reduce((s, i) => s + i.monto_iva, 0);
  const totalGeneral  = items.reduce((s, i) => s + i.total_linea, 0);

  // Condición de venta: si es Crédito, exigir plazo de al menos 1 día y un cliente.
  const plazoDiasNum = parseInt(plazoDias) || 0;
  const creditoValido = tipoVenta === "CONTADO" || (plazoDiasNum >= 1 && !!clienteId);
  // Cliente obligatorio si se emite factura (SIFEN requiere receptor) o si es crédito (necesita CxC).
  const clienteObligatorio = emitirFactura || tipoVenta === "CREDITO";
  // Una línea manual sin descripción saldría como un renglón vacío en la factura.
  const manualesValidas = items.every((i) => !i.es_manual || i.producto_nombre.trim().length > 0);
  const ventaValida   = items.length > 0 && creditoValido && manualesValidas;

  // Ganancia de los trabajos cargados a mano: precio facturado − costo cargado.
  // Solo cuenta las líneas manuales; en las de catálogo el costo sale del stock.
  const totalCostoManual = items.reduce(
    (s, i) => s + (i.es_manual ? (i.costo_unitario ?? 0) * i.cantidad : 0),
    0
  );
  const totalVentaManual = items.reduce((s, i) => s + (i.es_manual ? i.total_linea : 0), 0);
  const hayCostoManual = items.some((i) => i.es_manual && (i.costo_unitario ?? 0) > 0);

  // Cliente (opcional) — selección + filtrado del buscador.
  const clienteSel = clientes.find((c) => c.id === clienteId) ?? null;
  const clientesFiltrados = (clienteQuery.trim() === ""
    ? clientes
    : clientes.filter((c) => productoMatchesQuery(clienteQuery, c.label, c.ruc))
  ).slice(0, 50);

  // Cobro: entidad seleccionada + filtrado por código/nombre (tokens).
  const entidadSel = entidades.find((e) => e.id === pagoEntidadId) ?? null;
  const entidadesFiltradas = (entidadQuery.trim() === ""
    ? entidades
    : entidades.filter((e) => productoMatchesQuery(entidadQuery, e.nombre, e.codigo))
  ).slice(0, 50);

  // ── Saldo a favor aplicado a esta venta ───────────────────────────────────
  /** No puede superar ni el saldo del cliente ni el total de la venta. */
  const saldoAplicado = Math.max(0, Math.min(usarSaldo, saldoFavor, totalGeneral));
  /** Lo que falta cobrar por los medios normales (efectivo, tarjeta, etc.). */
  const restaCobrar = Math.max(0, totalGeneral - saldoAplicado);

  // Al abrir el modal de cobro, precargar el monto con lo que resta cobrar.
  useEffect(() => {
    if (cobroModalOpen) setPagoMonto(restaCobrar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobroModalOpen]);
  /** Crédito que le sobra al cliente después de pagar esta venta. */
  const saldoRestante = Math.max(0, saldoFavor - saldoAplicado);

  // Vuelto (solo informativo, no se persiste). Se calcula sobre lo que resta
  // cobrar: si parte se pagó con saldo, el cajero recibe menos efectivo.
  const montoRecibidoNum = parseFloat(montoRecibido) || 0;
  const vuelto           = montoRecibidoNum - restaCobrar;
  // Efectivo insuficiente: se cargó un monto recibido que no cubre lo que resta
  // cobrar. Bloquea la confirmación (el campo vacío = pago exacto, no bloquea).
  const efectivoInsuficiente =
    metodoPago === "efectivo" && montoRecibidoNum > 0 && montoRecibidoNum < restaCobrar - 0.5;

  // ── Cobro mixto: totales y validación ──────────────────────────────────────
  const pagadoMixto = pagosMixtos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const faltaMixto = Math.max(0, restaCobrar - pagadoMixto);
  const vueltoMixto = pagadoMixto - restaCobrar;
  const mixtoEntidadFaltante = pagosMixtos.some((p) => p.metodo !== "efectivo" && !p.entidadId);
  const mixtoInvalido =
    metodoPago === "mixto" &&
    (pagosMixtos.length === 0 || pagadoMixto < restaCobrar - 0.5 || mixtoEntidadFaltante);

  function addPagoMixto() {
    setCobroError(null);
    setPagosMixtos((prev) => {
      const yaPagado = prev.reduce((s, p) => s + (Number(p.monto) || 0), 0);
      const sugerido = Math.max(0, Math.round((restaCobrar - yaPagado) * 100) / 100);
      return [...prev, { key: mixtoSeq.current++, metodo: "efectivo", monto: sugerido, entidadId: "", referencia: "", titular: "" }];
    });
  }
  function updatePagoMixto(key: number, patch: Partial<PagoMixto>) {
    setCobroError(null);
    setPagosMixtos((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }
  function removePagoMixto(key: number) {
    setPagosMixtos((prev) => prev.filter((p) => p.key !== key));
  }

  // ── Productos filtrados para el combobox ──────────────────────────────────
  // Solo vendibles (Reventa + Menú). Excluye materia prima / insumos.
  // Resultados del autocomplete: vienen del endpoint de búsqueda server-side
  // (token search sobre TODO el catálogo, no un subconjunto en memoria).
  const comboResultados = comboHits;

  /** Selecciona método de cobro. Efectivo no pide datos; transferencia/tarjeta abren modal. */
  function handleSelectMetodo(m: MetodoPago) {
    setMetodoPago(m);
    setCobroError(null);
    if (m === "mixto") {
      setCobroModalOpen(false);
      // Sembrar con una línea de efectivo por el total a cobrar; el cajero la
      // ajusta y agrega otras (transferencia, tarjeta…).
      setPagosMixtos([{ key: mixtoSeq.current++, metodo: "efectivo", monto: Math.round(restaCobrar * 100) / 100, entidadId: "", referencia: "", titular: "" }]);
      return;
    }
    if (m === "efectivo") {
      setCobroModalOpen(false);
      // "Caja efectivo" por defecto si existe una entidad tipo caja.
      const caja = entidades.find((e) => e.tipo === "caja");
      setPagoEntidadId(caja ? caja.id : "");
      setPagoTitular("");
    } else {
      setEntidadQuery("");
      setCobroModalOpen(true);
    }
  }

  function handleEliminarLinea(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Reglas de precio por canal ─────────────────────────────────────────────
  /** Precio de la línea para un tipo, según su snapshot de precios. */
  function precioDeTipoLinea(l: LineaVenta, tipo: TipoPrecioVenta): number {
    const base = l.precio_minorista ?? l.precio_venta;
    if (tipo === "mayorista") return l.precio_mayorista != null && l.precio_mayorista > 0 ? l.precio_mayorista : base;
    if (tipo === "distribuidor") return l.precio_distribuidor != null && l.precio_distribuidor > 0 ? l.precio_distribuidor : base;
    return base;
  }
  /** Tipo automático por cantidad: mayorista al llegar a la cantidad mínima. */
  function tipoPorCantidad(l: LineaVenta): TipoPrecioVenta {
    const min = l.cantidad_minima_mayorista;
    const may = l.precio_mayorista;
    if (may != null && may > 0 && min != null && min > 0 && l.cantidad >= min) return "mayorista";
    return "minorista";
  }

  // ── Autocomplete rápido + edición inline ──────────────────────────────────
  // Recalcula subtotal/IVA/total de una línea (IVA incluido, igual que calcIva).
  // Además aplica el precio por canal según la cantidad, salvo que el cajero
  // haya fijado el precio/tipo a mano (precio_manual).
  function recomputeLinea(l: LineaVenta): LineaVenta {
    let out = l;
    if (!l.precio_manual) {
      const tipo = tipoPorCantidad(l);
      const precio = precioDeTipoLinea(l, tipo);
      out = { ...l, tipo_precio: tipo, precio_venta: precio, precio_venta_original: precio };
    }
    const total_linea = out.cantidad > 0 && out.precio_venta > 0 ? out.cantidad * out.precio_venta : 0;
    const monto_iva = calcIva(out.tipo_iva, total_linea);
    return { ...out, total_linea, monto_iva, subtotal: total_linea - monto_iva };
  }

  /** Agrega un producto directo desde el autocomplete: si ya está (sin presentación)
   *  suma +1; si no, crea la línea. Luego limpia el input y devuelve el foco. */
  function agregarProductoRapido(p: Producto) {
    const precio = precioPorTipo(p, "minorista");
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.producto_id === p.id && !it.presentacion_id);
      if (idx >= 0) {
        return prev.map((it, i) => (i === idx ? recomputeLinea({ ...it, cantidad: it.cantidad + 1 }) : it));
      }
      return [
        ...prev,
        recomputeLinea({
          producto_id: p.id,
          producto_nombre: p.nombre,
          sku: p.sku,
          cantidad: 1,
          unidad_medida: p.unidad_medida ?? "UNIDAD",
          precio_venta_original: precio,
          precio_venta: precio,
          tipo_iva: "10%",
          tipo_precio: "minorista",
          precio_minorista: precioPorTipo(p, "minorista"),
          precio_mayorista: p.precio_mayorista ?? null,
          precio_distribuidor: p.precio_distribuidor ?? null,
          cantidad_minima_mayorista: p.cantidad_minima_mayorista ?? null,
          precio_manual: false,
          subtotal: 0,
          monto_iva: 0,
          total_linea: 0,
          presentacion_id: null,
          presentacion_nombre: null,
          presentacion_cantidad_base: null,
        }),
      ];
    });
    setComboQuery("");
    setComboOpen(false);
    setComboHighlight(-1);
    setErrorLinea(null);
    setTimeout(() => comboInputRef.current?.focus(), 0);
  }

  /**
   * Agrega una línea escrita a mano: un trabajo completo en un solo renglón
   * ("Mantenimiento de compresor: cambio de pistones, aceite y válvulas"), sin
   * tener que cargar repuesto por repuesto. No toca stock; el costo se escribe
   * a mano para que quede la ganancia del trabajo.
   */
  function agregarItemManual() {
    setItems((prev) => [
      ...prev,
      {
        producto_id: "",           // el backend lo guarda como NULL
        producto_nombre: "",
        sku: "",
        es_manual: true,
        costo_unitario: null,
        cantidad: 1,
        unidad_medida: "UNIDAD",
        precio_venta_original: 0,
        precio_venta: 0,
        tipo_iva: "10%",
        // precio_manual evita que las reglas de precio por canal pisen el importe.
        precio_manual: true,
        subtotal: 0,
        monto_iva: 0,
        total_linea: 0,
        presentacion_id: null,
        presentacion_nombre: null,
        presentacion_cantidad_base: null,
      },
    ]);
    setErrorLinea(null);
  }

  function updateItemCampo(idx: number, patch: Partial<LineaVenta>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? recomputeLinea({ ...it, ...patch }) : it)));
  }
  /** delta viene en "pasos": el tamaño real depende de la unidad del producto. */
  function changeCantidadItem(idx: number, delta: number) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const paso = pasoCantidad(it.unidad_medida);
        return recomputeLinea({ ...it, cantidad: clampCantidad(it.cantidad + delta * paso, it.unidad_medida) });
      })
    );
  }
  function changeTipoPrecioItem(idx: number, tipo: TipoPrecioVenta) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        // Elegir el tipo a mano fija el precio: no se auto-cambia por cantidad.
        const precio = precioDeTipoLinea(it, tipo);
        return recomputeLinea({ ...it, tipo_precio: tipo, precio_venta: precio, precio_venta_original: precio, precio_manual: true });
      })
    );
  }

  /** Teclado del autocomplete: ↑/↓ navega, Enter agrega el resaltado, Esc cierra. */
  function onComboKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setComboOpen(true);
      setComboHighlight((h) => Math.min(h + 1, comboResultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setComboHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = comboResultados[comboHighlight] ?? comboResultados[0];
      if (sel) agregarProductoRapido(sel);
    } else if (e.key === "Escape") {
      setComboOpen(false);
      setComboHighlight(-1);
    }
  }

  const cajaActivaFinal = cajaActivaId || (cajasAbiertas.length === 1 ? cajasAbiertas[0].id : "");

  /** Envía la venta. Con `permitirSinStock=true` autoriza vender aunque falte stock. */
  async function enviarVenta(permitirSinStock: boolean) {
    // Esta instancia no usa el módulo Caja: la venta no depende de una caja abierta.
    // Si hubiera varias cajas abiertas, se sigue exigiendo elegir cuál.
    if (cajasAbiertas.length > 1 && !cajaActivaFinal) {
      setErrorVenta("Hay varias cajas abiertas: seleccioná la caja activa antes de confirmar.");
      return;
    }
    // Efectivo: si el cajero cargó un monto recibido y NO alcanza el total a
    // cobrar, no dejar pasar la venta (debe coincidir o superar). Si deja el
    // campo vacío se asume pago exacto y no se bloquea.
    if (metodoPago === "efectivo" && montoRecibidoNum > 0 && montoRecibidoNum < restaCobrar - 0.5) {
      setErrorVenta(
        `El efectivo recibido (${formatGs(montoRecibidoNum)}) no cubre el total a cobrar (${formatGs(restaCobrar)}). Falta ${formatGs(restaCobrar - montoRecibidoNum)}.`
      );
      return;
    }
    // Transferencia / tarjeta: exigir una entidad REAL seleccionada de la lista
    // (no basta escribir texto/números en el buscador). Si falta, reabrir el
    // modal de cobro con el aviso en vez de registrar la venta.
    if (metodoPago === "transferencia" || metodoPago === "tarjeta") {
      if (!pagoEntidadId) {
        const msg = metodoPago === "tarjeta"
          ? "Seleccioná la entidad / banco / POS de la lista."
          : "Seleccioná la entidad / banco de la lista.";
        setCobroError(msg);
        setCobroModalOpen(true);
        return;
      }
    }
    // Transferencia: exigir titular + N° de comprobante para validar la
    // transacción antes de cerrar la venta (pedido explícito de QA — la venta
    // no se debe procesar sin la referencia del comprobante).
    if (metodoPago === "transferencia") {
      if (!pagoTitular.trim()) {
        setCobroError("Indicá el titular que hizo la transferencia.");
        setCobroModalOpen(true);
        return;
      }
      if (!pagoReferencia.trim()) {
        setCobroError("Cargá el N° de comprobante para validar la transferencia.");
        setCobroModalOpen(true);
        return;
      }
    }

    // Cobro mixto: la suma de las líneas debe cubrir el total a cobrar y cada
    // línea que no sea efectivo necesita su entidad/banco.
    if (metodoPago === "mixto") {
      if (pagosMixtos.length === 0) {
        setErrorVenta("Agregá al menos una línea de pago.");
        return;
      }
      if (mixtoEntidadFaltante) {
        setErrorVenta("En el cobro mixto, cada pago con transferencia o tarjeta debe tener su entidad / banco.");
        return;
      }
      if (pagadoMixto < restaCobrar - 0.5) {
        setErrorVenta(`El cobro mixto (${formatGs(pagadoMixto)}) no cubre el total a cobrar (${formatGs(restaCobrar)}). Falta ${formatGs(restaCobrar - pagadoMixto)}.`);
        return;
      }
    }
    // Guard duro contra doble submit: si ya hay una confirmación en vuelo, cortar
    // inmediatamente. El ref se evalúa de forma síncrona (no espera al re-render de React),
    // así que un segundo click/Enter casi simultáneo no puede disparar otra venta.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGuardando(true);

    // La ventana del documento se abre ACÁ, todavía dentro del clic del cajero.
    // Si se abriera después del `await` de guardar la venta, el navegador ya no
    // la considera abierta por el usuario y la bloquea: por eso la factura no
    // salía sola. Se abre en blanco y luego se la manda al documento.
    // Declarada fuera del try para poder cerrarla en el finally.
    let ventanaDoc: Window | null = null;
    try {
      // El cliente se elige (o se crea con el modal "Crear cliente") antes de
      // confirmar. Si no hay ninguno, la venta se registra sin cliente.
      const clienteIdFinal = clienteId;

      try {
        ventanaDoc = window.open("", "_blank");
        if (ventanaDoc) {
          ventanaDoc.document.write(
            `<!doctype html><meta charset="utf-8"><title>Preparando documento…</title>` +
            `<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#3F8E91">` +
            `<p>Registrando la venta…</p></body>`
          );
        }
      } catch { ventanaDoc = null; }

      const resultado = await saveVenta(
        {
          items,
          moneda,
          tipo_cambio:  tipoCambioNum,
          subtotal:     totalSubtotal,
          monto_iva:    totalIva,
          total:        totalGeneral,
          tipo_venta:   tipoVenta,
          plazo_dias:   tipoVenta === "CREDITO" ? plazoDiasNum : undefined,
          metodo_pago:  metodoPago,
          cliente_id:   clienteIdFinal || null,
          genera_nota_remision: !!clienteIdFinal && generaNotaRemision,
        },
        undefined,
        metodoPago === "mixto"
          ? null
          : {
              entidad_bancaria_id: pagoEntidadId || null,
              entidad_nombre_snapshot: entidades.find((e) => e.id === pagoEntidadId)?.nombre ?? null,
              monto: pagoMonto > 0 ? pagoMonto : null,
              referencia: pagoReferencia.trim() || null,
              titular: metodoPago === "transferencia" ? pagoTitular.trim() || null : null,
              observacion: pagoObservacion.trim() || null,
            },
        {
          permitirSinStock, pedidoId, pedidoCajaId, cajaId: cajaActivaFinal,
          usarSaldoFavor: saldoAplicado,
          retirarSaldoEfectivo: retirarExcedente ? saldoRestante : 0,
          emitirFactura,
          pagos: metodoPago === "mixto"
            ? pagosMixtos.map((p) => ({
                metodo_pago: p.metodo,
                monto: Math.round((Number(p.monto) || 0) * 100) / 100,
                entidad_bancaria_id: p.metodo === "efectivo" ? null : (p.entidadId || null),
                entidad_nombre_snapshot: p.metodo === "efectivo" ? null : (entidades.find((e) => e.id === p.entidadId)?.nombre ?? null),
                referencia: p.referencia.trim() || null,
                titular: p.metodo === "transferencia" ? (p.titular.trim() || null) : null,
              }))
            : null,
        }
      );

      if (!resultado.success) {
        // La venta no se registró: se cierra la ventana que se había abierto
        // para el documento, si no queda una pestaña vacía dando vueltas.
        try { ventanaDoc?.close(); } catch {}
        // Falta stock sin autorizar → abrir modal de confirmación con el detalle.
        // (El guard se libera en el finally para permitir confirmar sin stock.)
        if (resultado.faltantes && resultado.faltantes.length > 0) {
          setFaltantes(resultado.faltantes);
          setConfirmSinStockOpen(true);
          return;
        }
        setErrorVenta(resultado.error);
        return;
      }
      // Venta registrada: avisar a la pantalla de Caja (lista "Pedidos por
      // cobrar") para que refresque su cola automáticamente.
      try { const bc = new BroadcastChannel("pedidos-caja"); bc.postMessage("refresh"); bc.close(); } catch { /* navegador sin soporte */ }

      // Documentos de la venta. La nota de remisión se abre además del ticket
      // SOLO si la venta la genera (cliente con usa_nota_remision o toggle activo).
      const v = resultado.venta;
      const generaNota = v.genera_nota_remision === true || !!v.nota_remision_numero;
      const ticketUrl = `/api/ventas/${v.id}/ticket?auto=1`;
      const remisionUrl = `/api/ventas/${v.id}/ticket?tipo=remision&auto=1`;
      // Documento principal: la FACTURA electrónica (KuDE, PDF fiscal con QR) cuando
      // se emitió el DE y ya hay XML firmado. Si el DE no está listo (modo no-sifen,
      // o SET aún pendiente/rechazado), cae al ticket interno. Se abre en la ventana
      // pre-abierta durante el clic para que el navegador NO la bloquee.
      const fact = resultado.facturacion;
      const kudeUrl = fact?.kude_disponible && fact.kude_url ? fact.kude_url : null;
      const docUrl = kudeUrl ?? ticketUrl;
      if (ventanaDoc && !ventanaDoc.closed) {
        try { ventanaDoc.location.replace(docUrl); }
        catch { try { window.open(docUrl, "_blank", "noopener"); } catch {} }
      } else {
        try { window.open(docUrl, "_blank", "noopener"); } catch {}
      }
      if (generaNota) { try { window.open(remisionUrl, "_blank", "noopener"); } catch {} }

      // Si el cajero pidió Factura y el pipeline SIFEN no llegó a emitir el KUDE,
      // frenar acá y mostrar el motivo. Sin este aviso el sistema abre el ticket
      // interno en silencio y el cajero no se entera de que la factura NO se hizo.
      if (emitirFactura && !kudeUrl) {
        const motivo = fact?.error
          ? fact.error
          : fact?.estado_de
            ? `El DE quedó en estado "${fact.estado_de}" y no hay KUDE disponible todavía.`
            : "La empresa no está en modo SIFEN o falta configuración (certificado / timbrado / punto de expedición).";
        setErrorVenta(
          `La venta ${v.numero_control ?? ""} quedó registrada, pero NO se emitió la factura electrónica. ` +
          `Se abrió el ticket interno como comprobante. Motivo: ${motivo}`
        );
        ventanaDoc = null;
        return;
      }

      // Redirige directo al listado de ventas en lugar de mostrar el modal
      // post-venta. El cajero queda libre para registrar otra venta de
      // inmediato. El ticket sigue accesible desde el listado.
      router.push("/ventas");
      ventanaDoc = null; // ya navegó al documento: el finally no debe cerrarla
    } finally {
      // Si quedó abierta sin destino (excepción inesperada), se cierra.
      try { ventanaDoc?.close(); } catch {}
      // Liberar el guard SIEMPRE: éxito, error o flujo de "confirmar sin stock".
      isSubmittingRef.current = false;
      setGuardando(false);
    }
  }

  // Confirmar SOLO por click en el botón (no con Enter): el <form> ignora el
  // submit y el botón es type="button" que llama a esto directamente.
  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setErrorVenta(null);

    // Autocrear cliente desde la respuesta SET cuando no está en el catálogo.
    // Requisitos: hay una consulta SET exitosa stashed Y todavía no hay
    // clienteId seleccionado. Corre incluso si es "Solo ticket" — así al
    // vender el cliente queda en la lista para la próxima. Si algo falla,
    // muestra el error y no envía la venta.
    let clienteIdFinal = clienteId;
    if (!clienteIdFinal && datoClienteSet) {
      const nombre = (datoClienteSet.razon_social ?? "").trim();
      const rucFmt = (datoClienteSet.ruc ?? "").trim();
      if (nombre) {
        const res = await apiCreateCliente({
          tipo_cliente: "empresa",
          empresa: nombre,
          nombre_contacto: nombre,
          ruc: rucFmt || undefined,
          estado: "activo",
        });
        if (!res.ok) {
          setErrorVenta(`No se pudo crear el cliente desde SET: ${res.error}`);
          return;
        }
        const nuevo: ClienteCreado = {
          id: String(res.data.id),
          label: nombre,
          ruc: rucFmt || "",
          usa_nota_remision: false,
        };
        setClientes((prev) => [nuevo, ...prev.filter((c) => c.id !== nuevo.id)]);
        setClienteId(nuevo.id);
        setClienteQuery("");
        setDatoClienteSet(null);
        consultaSet.resetAviso();
        clienteIdFinal = nuevo.id;
      }
    }

    if (emitirFactura && !clienteIdFinal) {
      setErrorVenta(
        "Para facturar hace falta elegir el cliente: la factura electrónica necesita un receptor con RUC o cédula."
      );
      return;
    }
    if (!ventaValida) return;
    await enviarVenta(false);
  }

  async function confirmarVentaSinStock() {
    setConfirmSinStockOpen(false);
    setErrorVenta(null);
    await enviarVenta(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Nueva venta</h1>
          <p className="text-gray-600">
            Buscá un producto y se agrega al instante. Revisá cantidades y precios en la tabla.
          </p>
        </div>
        {/* Caja activa: solo si la instancia usa cajas (si no hay, no se muestra nada). */}
        {cajasAbiertas.length === 0 ? null : (
          <div className="flex items-center gap-2 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.06] px-3 py-2">
            <span className="text-xs font-semibold text-[#3F8E91]">Caja activa</span>
            {cajasAbiertas.length === 1 ? (
              <span className="text-sm font-bold text-slate-800">Caja {cajasAbiertas[0].numero_caja}</span>
            ) : (
              <select
                value={cajaActivaId}
                onChange={(e) => setCajaActivaId(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
              >
                <option value="">— Elegí caja —</option>
                {cajasAbiertas.map((c) => (
                  <option key={c.id} value={c.id}>Caja {c.numero_caja}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {pedidoId && (
        <div className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-[#3F8E91]">Estás facturando un pedido{pedidoNumero ? ` (${pedidoNumero})` : ""}.</span>{" "}
          La venta se generará al confirmar y el pedido quedará marcado como facturado. Podés ajustar items, precios y método de pago.
        </div>
      )}

      {pedidoCajaId && (
        <div className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-[#3F8E91]">
            Cobrando pedido de Consulta{pedidoCajaTitulo ? ` (${pedidoCajaTitulo})` : ""}.
          </span>{" "}
          Al confirmar, el pedido quedará marcado como facturado. Podés ajustar items, precios y método de pago.
        </div>
      )}

      <form onSubmit={(e) => e.preventDefault()} className="space-y-6 max-w-7xl">

        {/* ── SECCIÓN 0: Datos de la venta (cliente opcional + condición) ────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <SectionTitle>Datos de la venta</SectionTitle>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* Cliente — obligatorio si emite factura o si es crédito; opcional para "solo ticket" en efectivo */}
            <div ref={clienteContainerRef} className="relative">
              <label className={labelClass}>
                Cliente {clienteObligatorio ? (
                  <span className="text-rose-600">*</span>
                ) : (
                  <span className="text-xs font-normal text-gray-400">(opcional para ticket)</span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clienteSel ? clienteSel.label : clienteQuery}
                  onChange={(e) => {
                    setClienteId("");
                    setClienteQuery(e.target.value);
                    setClienteOpen(true);
                    // El usuario está editando el input → invalida el resultado SET
                    // previo para no crear un cliente stale al confirmar.
                    if (datoClienteSet) setDatoClienteSet(null);
                    if (consultaSet.aviso) consultaSet.resetAviso();
                  }}
                  onFocus={() => setClienteOpen(true)}
                  placeholder="Buscar por nombre o RUC…"
                  className={`${inputClass} ${clienteSel ? "font-medium" : ""}`}
                />
                {clienteSel && (
                  <button
                    type="button"
                    onClick={() => { setClienteId(""); setClienteQuery(""); setGeneraNotaRemision(false); setDatoClienteSet(null); consultaSet.resetAviso(); }}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    Quitar
                  </button>
                )}
                {!clienteSel && (
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await consultaSet.consultar(clienteQuery);
                      if (r && r.razon_social) {
                        // Reemplaza el RUC tipeado por 'NOMBRE (RUC)' así el cajero
                        // ve el receptor completo. El objeto queda stashed para
                        // crear el cliente al confirmar la venta.
                        setDatoClienteSet(r);
                        setClienteQuery(`${r.razon_social} (${r.ruc})`);
                      } else {
                        setDatoClienteSet(null);
                      }
                    }}
                    disabled={consultaSet.consultando}
                    title="Consulta el RUC tipeado contra el padrón de la SET (Marangatu)"
                    className="shrink-0 whitespace-nowrap rounded-lg border border-[#0EA5E9]/40 bg-[#0EA5E9]/5 px-3 text-xs font-medium text-[#0369A1] transition-colors hover:border-[#0EA5E9] hover:bg-[#0EA5E9]/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {consultaSet.consultando ? "Consultando…" : "SET"}
                  </button>
                )}
              </div>
              {consultaSet.aviso && !clienteSel && (
                <p
                  className={
                    consultaSet.aviso.tono === "ok"
                      ? "mt-1 text-xs font-medium text-emerald-600"
                      : consultaSet.aviso.tono === "error"
                        ? "mt-1 text-xs font-medium text-rose-600"
                        : "mt-1 text-xs font-medium text-slate-500"
                  }
                >
                  {consultaSet.aviso.texto}
                </p>
              )}
              {clienteOpen && !clienteSel && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {/* Acción al TOPE del dropdown: abre el modal de "nuevo cliente rápido". */}
                  <button
                    type="button"
                    onClick={() => { setClienteOpen(false); setShowCrearCliente(true); }}
                    className="flex w-full items-center gap-1.5 border-b border-slate-100 bg-[#0EA5E9]/[0.06] px-3 py-2 text-left text-xs font-semibold text-[#0369A1] hover:bg-[#0EA5E9]/[0.12]"
                    title="Se abre un mini formulario acá mismo, sin cambiar de página."
                  >
                    <span className="text-base leading-none">＋</span>
                    Cargar nuevo cliente
                    {clienteQuery.trim() && <span className="ml-1 truncate text-slate-500">«{clienteQuery.trim()}»</span>}
                  </button>
                  {clientesFiltrados.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">Sin clientes que coincidan.</p>
                  ) : (
                    clientesFiltrados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setClienteId(c.id); setClienteQuery(""); setClienteOpen(false); setGeneraNotaRemision(c.usa_nota_remision); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-gray-800">{c.label}</span>
                        {c.ruc && <span className="ml-2 text-xs text-gray-400">RUC {c.ruc}</span>}
                        {c.usa_nota_remision && <span className="ml-2 text-[10px] rounded-full bg-sky-100 text-sky-700 px-1.5 py-0.5 font-semibold">Nota remisión</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
              <p className="mt-1 text-[11px] text-gray-400">
                Toda venta emite factura ERP. Si el cliente no existe, cargalo con &ldquo;＋ Cargar nuevo cliente&rdquo;.
              </p>
              {!clienteId && clienteObligatorio && (
                <p className="mt-1 text-[11px] text-rose-600">
                  {emitirFactura
                    ? "Seleccioná un cliente para poder emitir la factura electrónica."
                    : "La venta a crédito requiere un cliente seleccionado."}
                </p>
              )}

              {/* Nota de remisión: solo con cliente. Si el cliente la usa, viene activada. */}
              {clienteSel && (
                <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2">
                  {clienteSel.usa_nota_remision && (
                    <p className="mb-1.5 text-[11px] text-sky-700">
                      Este cliente usa nota de remisión. Se generará junto al ticket.
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={generaNotaRemision}
                      onChange={(e) => setGeneraNotaRemision(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                    />
                    Generar nota de remisión
                  </label>
                </div>
              )}
            </div>

            {/* Condición: Contado / Crédito */}
            <div>
              <label className={labelClass}>Condición</label>
              <SegmentedControl<TipoVenta>
                value={tipoVenta}
                options={[
                  { value: "CONTADO", label: "Contado" },
                  { value: "CREDITO", label: "Crédito" },
                ]}
                onChange={(v) => { setTipoVenta(v); if (v === "CONTADO") setPlazoDias(""); }}
              />
              {tipoVenta === "CREDITO" && (
                <div className="mt-3">
                  <label className={labelClass}>Plazo de crédito (días)</label>
                  <input
                    type="number"
                    min={1}
                    value={plazoDias}
                    onChange={(e) => setPlazoDias(e.target.value)}
                    placeholder="Ej: 30"
                    className={`${inputClass} ${plazoDiasNum < 1 ? "border-red-300 bg-red-50" : ""}`}
                  />
                  {plazoDiasNum < 1 && (
                    <p className="mt-1 text-[11px] text-red-600">Ingresá un plazo de al menos 1 día.</p>
                  )}
                  {!clienteId && (
                    <p className="mt-1 text-[11px] text-red-600">La venta a crédito requiere un cliente: seleccioná uno o creá uno nuevo.</p>
                  )}
                  <p className="mt-1 text-[11px] text-slate-500">Al confirmar se genera una cuenta por cobrar por el total.</p>
                </div>
              )}
            </div>

            {/* Documento a emitir: Factura electrónica (dispara SIFEN) vs Solo ticket. */}
            <div className="lg:col-span-2">
              <label className={labelClass}>Documento</label>
              <SegmentedControl<"ticket" | "factura">
                value={emitirFactura ? "factura" : "ticket"}
                options={[
                  { value: "factura", label: "Factura electrónica" },
                  { value: "ticket", label: "Solo ticket" },
                ]}
                onChange={(v) => setEmitirFactura(v === "factura")}
              />
              {emitirFactura ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Al confirmar, se emite la factura FAC-XXXXXX y arranca el pipeline SIFEN (firma + envío + KUDE).
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">
                  Solo se registra la venta e imprime un ticket comanda. No genera factura ni toca SIFEN. Podés emitir la factura después desde la venta si el cliente la pide.
                </p>
              )}
            </div>

          </div>

        </div>

        {/* ── SECCIÓN 3: Carrito + totales + confirmar ─────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle>Productos en esta venta</SectionTitle>
            <div className="flex shrink-0 items-center gap-2">
              {/* Ítem sin catálogo: descripción / cantidad / precio a mano.
                  Usar para ventas ad-hoc (servicios que se cobran al momento,
                  conceptos ocasionales, etc.). No toca stock. */}
              <button
                type="button"
                onClick={agregarItemManual}
                className="rounded-lg border border-[#0EA5E9] bg-[#0EA5E9]/5 px-3 py-1.5 text-xs font-semibold text-[#0284C7] hover:bg-[#0EA5E9]/10"
                title="Cargar un ítem directo (descripción + cantidad + precio), sin pasar por el catálogo"
              >
                + Ítem manual
              </button>
            </div>
          </div>

          {/* Buscador de productos del catálogo: escribí 2+ letras, elegí de la
              lista (o navegá con ↑/↓/Enter) y la línea se agrega al carrito. */}
          <div className="relative mb-3" ref={comboContainerRef}>
            <input
              ref={comboInputRef}
              type="text"
              value={comboQuery}
              onChange={(e) => { setComboQuery(e.target.value); setComboOpen(true); setComboHighlight(-1); }}
              onFocus={() => setComboOpen(true)}
              onKeyDown={onComboKeyDown}
              placeholder="Buscar producto o servicio del catálogo (nombre o SKU)…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#0EA5E9]"
            />
            {comboOpen && comboQuery.trim().length >= 2 && (
              <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {comboBuscando && (
                  <div className="px-3 py-2 text-xs text-slate-400">Buscando…</div>
                )}
                {!comboBuscando && comboResultados.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-400">
                    Sin resultados. Podés cargar el concepto como <span className="font-semibold">Ítem manual</span>.
                  </div>
                )}
                {comboResultados.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseEnter={() => setComboHighlight(i)}
                    onClick={() => agregarProductoRapido(p)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                      i === comboHighlight ? "bg-[#0EA5E9]/10" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{p.nombre}</p>
                      <p className="font-mono text-[11px] text-slate-500">{p.sku}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">
                      Gs. {Math.round(p.precio_venta).toLocaleString("es-PY")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="mt-4 py-10 text-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
              Todavía no cargaste ningún ítem. Apretá
              <span className="mx-1 font-semibold text-[#0284C7]">+ Ítem manual</span>
              y escribí la descripción, cantidad y precio.
            </div>
          ) : (
            <>
              {/* min-w fuerza scroll horizontal en mobile (9 columnas).
                  Columnas secundarias (SKU, Subtotal, IVA Gs) se ocultan
                  progresivamente: en mobile solo Producto/Cant/Precio/Total/eliminar. */}
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[900px] text-sm text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-3">Producto</th>
                      <th className="hidden px-3 py-3 md:table-cell">Precio</th>
                      <th className="hidden px-3 py-3 text-center md:table-cell">IVA</th>
                      <th className="px-3 py-3 text-center">Cant.</th>
                      <th className="px-3 py-3 text-right">Precio unit.</th>
                      {isAdmin && <th className="px-3 py-3 text-right">Costo</th>}
                      <th className="px-3 py-3 text-right">Stock</th>
                      <th className="px-3 py-3 text-right">Subtotal</th>
                      <th className="w-10 px-2 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item, idx) => {
                      const prod = productos.find((p) => p.id === item.producto_id);
                      // Un trabajo a mano no sale del catálogo: nunca controla stock.
                      const controla = item.es_manual ? false : prod ? prod.controla_stock !== false : true;
                      const stock = prod?.stock_actual ?? 0;
                      const stockBajo = controla && item.cantidad > stock;
                      const costoLinea = (item.costo_unitario ?? 0) * item.cantidad;
                      const gananciaLinea = item.total_linea - costoLinea;
                      return (
                        <tr key={idx} className="align-middle transition-colors hover:bg-[#0EA5E9]/5">
                          {/* Producto + SKU (o descripción libre si es un trabajo a mano) */}
                          <td className="px-3 py-2.5">
                            {item.es_manual ? (
                              <div className="min-w-0">
                                <textarea
                                  value={item.producto_nombre}
                                  onChange={(e) => updateItemCampo(idx, { producto_nombre: e.target.value })}
                                  rows={2}
                                  placeholder="Ej: Novillo Brangus 420 kg — caravana N° 1234"
                                  className="w-full min-w-[18rem] resize-y rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-[#0EA5E9]"
                                />
                              </div>
                            ) : (
                            <div className="flex items-center gap-3">
                              <ProductoThumb url={prod?.imagen_url} alt={item.producto_nombre} />
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-900 leading-snug">{item.producto_nombre}</p>
                                <p className="font-mono text-[11px] text-slate-500">{item.sku}</p>
                                {item.presentacion_nombre && (
                                  <p className="text-[11px] text-slate-500">
                                    {item.presentacion_nombre}
                                    {item.presentacion_cantidad_base != null && item.presentacion_cantidad_base !== 1
                                      ? ` = ${item.cantidad * item.presentacion_cantidad_base}` : ""}
                                  </p>
                                )}
                              </div>
                            </div>
                            )}
                          </td>
                          {/* Tipo de precio — los canales no aplican a un trabajo a mano */}
                          <td className="hidden px-3 py-2.5 md:table-cell">
                            {item.es_manual ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : (
                            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                              {(["minorista", "mayorista", "distribuidor"] as const).map((tp) => {
                                const sel = (item.tipo_precio ?? "minorista") === tp;
                                return (
                                  <button key={tp} type="button" onClick={() => changeTipoPrecioItem(idx, tp)}
                                    className={`px-2 py-1.5 text-[11px] font-semibold transition-colors ${sel ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                                    {tp === "minorista" ? "Min" : tp === "mayorista" ? "May" : "Dist"}
                                  </button>
                                );
                              })}
                            </div>
                            )}
                          </td>
                          {/* IVA */}
                          <td className="hidden px-3 py-2.5 md:table-cell">
                            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                              {(["EXENTA", "5%", "10%"] as const).map((iva) => {
                                const sel = item.tipo_iva === iva;
                                return (
                                  <button key={iva} type="button" onClick={() => updateItemCampo(idx, { tipo_iva: iva })}
                                    className={`px-2 py-1.5 text-[11px] font-semibold transition-colors ${sel ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                                    {iva === "EXENTA" ? "Ex" : iva}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          {/* Cantidad */}
                          <td className="px-3 py-2.5">
                            <div className="mx-auto flex w-fit items-center rounded-md border border-slate-200 bg-white">
                              <button type="button" onClick={() => changeCantidadItem(idx, -1)} className="h-8 w-8 rounded-l-md text-slate-500 hover:bg-slate-100"><Minus className="mx-auto h-3.5 w-3.5" /></button>
                              <CantidadInput
                                value={item.cantidad}
                                unidad={item.unidad_medida}
                                onChange={(n) => updateItemCampo(idx, { cantidad: n })}
                                className={`h-8 text-center text-sm tabular-nums outline-none ${
                                  permiteDecimales(item.unidad_medida) ? "w-16" : "w-12"
                                }`}
                              />
                              <button type="button" onClick={() => changeCantidadItem(idx, 1)} className="h-8 w-8 rounded-r-md text-slate-500 hover:bg-slate-100"><Plus className="mx-auto h-3.5 w-3.5" /></button>
                            </div>
                            {permiteDecimales(item.unidad_medida) && (
                              <p className="mt-0.5 text-center text-[10px] font-semibold uppercase text-[#3F8E91]">
                                {item.unidad_medida}
                              </p>
                            )}
                          </td>
                          {/* Precio unitario editable */}
                          <td className="px-3 py-2.5 text-right">
                            <input
                              type="text" inputMode="numeric" value={numInput(item.precio_venta)} placeholder="0"
                              onChange={(e) => { const v = parseNumInput(e.target.value); updateItemCampo(idx, { precio_venta: v, precio_venta_original: v, precio_manual: true }); }}
                              className="h-8 w-28 rounded-md border border-slate-200 bg-white px-2 text-right text-sm tabular-nums"
                            />
                          </td>
                          {/* Costo — solo en trabajos a mano (repuestos + mano de obra). Oculto para perfiles sin costos. */}
                          {isAdmin && (
                            <td className="px-3 py-2.5 text-right">
                              {item.es_manual ? (
                                <input
                                  type="number" min={0} value={item.costo_unitario ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    updateItemCampo(idx, { costo_unitario: v === "" ? null : Math.max(0, Number(v) || 0) });
                                  }}
                                  placeholder="0"
                                  title="Cuánto costó el trabajo por unidad (repuestos + mano de obra)"
                                  className="h-8 w-28 rounded-md border border-slate-200 bg-white px-2 text-right text-sm tabular-nums"
                                />
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          )}
                          {/* Stock */}
                          <td className="px-3 py-2.5 text-right">
                            <span className={`text-xs font-semibold tabular-nums ${!controla ? "text-slate-400" : stockBajo ? "text-red-600" : "text-slate-600"}`}>
                              {!controla ? "—" : stock}
                            </span>
                          </td>
                          {/* Subtotal (total de línea) + ganancia si se cargó el costo */}
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-sm font-bold tabular-nums text-slate-900">{formatGs(item.total_linea)}</span>
                            {isAdmin && item.es_manual && costoLinea > 0 && (
                              <p className={`mt-0.5 text-[11px] font-semibold tabular-nums ${gananciaLinea >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                Ganancia {formatGs(gananciaLinea)}
                              </p>
                            )}
                          </td>
                          {/* Quitar */}
                          <td className="px-2 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleEliminarLinea(idx)}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Quitar producto"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totales + Cobro (vuelto) */}
              <div className="mt-5 flex justify-end">
                <div className="w-full space-y-3 lg:w-80">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span className="tabular-nums font-medium">{formatGs(totalSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>IVA</span>
                      <span className="tabular-nums font-medium">
                        {totalIva > 0 ? formatGs(totalIva) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                      <span>TOTAL</span>
                      <span className="tabular-nums">{formatGs(totalGeneral)}</span>
                    </div>
                    {/* Ganancia de los trabajos cargados a mano (interno, no sale en la factura). Oculto para perfiles sin costos. */}
                    {isAdmin && hayCostoManual && (
                      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>Costo de los trabajos</span>
                          <span className="tabular-nums">{formatGs(totalCostoManual)}</span>
                        </div>
                        <div className="mt-1 flex justify-between text-sm font-bold">
                          <span className="text-gray-700">Ganancia</span>
                          <span className={`tabular-nums ${totalVentaManual - totalCostoManual >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {formatGs(totalVentaManual - totalCostoManual)}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-gray-400">Solo uso interno: no aparece en la factura.</p>
                      </div>
                    )}
                  </div>

                  {/* Saldo a favor del cliente (crédito por devoluciones). */}
                  {saldoFavor > 0 && tipoVenta === "CONTADO" && (
                    <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3">
                      <div className="flex items-start gap-2">
                        <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-emerald-900">
                            Este cliente tiene saldo a favor: {formatGs(saldoFavor)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-emerald-700">
                            Se puede usar para pagar esta venta, total o en parte.
                          </p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-2">
                        <input
                          type="number" min={0} max={Math.min(saldoFavor, totalGeneral)} step="any"
                          value={usarSaldo || ""}
                          onChange={(e) => setUsarSaldo(Math.max(0, Math.min(Math.min(saldoFavor, totalGeneral), Number(e.target.value) || 0)))}
                          placeholder="0"
                          className="h-9 w-32 rounded-lg border border-emerald-300 bg-white px-2 text-center text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-300"
                        />
                        <button type="button"
                          onClick={() => setUsarSaldo(Math.min(saldoFavor, totalGeneral))}
                          className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                          Usar {formatGs(Math.min(saldoFavor, totalGeneral))}
                        </button>
                        {usarSaldo > 0 && (
                          <button type="button" onClick={() => setUsarSaldo(0)}
                            className="text-xs font-medium text-emerald-700 underline">Quitar</button>
                        )}
                      </div>
                      {usarSaldo > 0 && (
                        <div className="mt-2 space-y-0.5 border-t border-emerald-200 pt-2 text-xs">
                          <div className="flex justify-between text-emerald-800">
                            <span>Paga con saldo</span><span className="tabular-nums font-semibold">− {formatGs(usarSaldo)}</span>
                          </div>
                          <div className="flex justify-between font-bold text-emerald-900">
                            <span>Resta cobrar</span><span className="tabular-nums">{formatGs(restaCobrar)}</span>
                          </div>
                          {saldoRestante > 0 && (
                            <p className="pt-1 text-[11px] text-emerald-700">
                              Le quedan {formatGs(saldoRestante)} de saldo para próximas compras.
                            </p>
                          )}
                        </div>
                      )}
                      {/* Punto 6: el excedente se puede entregar en efectivo. */}
                      {saldoRestante > 0 && (
                        <label className="mt-2 flex items-start gap-2 border-t border-emerald-200 pt-2 text-xs text-emerald-800">
                          <input type="checkbox" checked={retirarExcedente} className="mt-0.5"
                            onChange={(e) => setRetirarExcedente(e.target.checked)} />
                          <span>
                            Entregar el excedente de <strong>{formatGs(saldoRestante)}</strong> en efectivo
                            <span className="block text-[10px] text-emerald-600">Sale de la caja como egreso. Solo si el cliente lo pide.</span>
                          </span>
                        </label>
                      )}
                    </div>
                  )}

                  {tipoVenta === "CONTADO" && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2.5">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Cobro{usarSaldo > 0 ? ` · resta ${formatGs(restaCobrar)}` : ""}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          { v: "efectivo", label: "Efectivo" },
                          { v: "transferencia", label: "Transferencia" },
                          { v: "tarjeta", label: "Tarjeta/Débito" },
                          { v: "mixto", label: "Mixto" },
                        ] as { v: MetodoPago; label: string }[]).map((m) => (
                          <button
                            key={m.v}
                            type="button"
                            onClick={() => handleSelectMetodo(m.v)}
                            className={`text-xs py-2 rounded-md border transition-colors ${
                              metodoPago === m.v
                                ? "border-[#0EA5E9] bg-[#0EA5E9]/10 text-[#0EA5E9] font-medium"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>

                      {/* Efectivo: monto recibido + vuelto, sin datos extra */}
                      {metodoPago === "efectivo" && (
                        <div className="space-y-1.5">
                          <MontoInput
                            value={montoRecibido}
                            onChange={(n) => setMontoRecibido(String(n))}
                            placeholder="Monto recibido (Gs.) — opcional"
                            className={inputClass}
                            decimals={false}
                          />
                          {montoRecibidoNum > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">{vuelto >= 0 ? "Vuelto" : "Falta"}</span>
                              <span className={`font-bold tabular-nums ${vuelto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {formatGs(Math.abs(vuelto))}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Transferencia / Tarjeta: resumen compacto + editar */}
                      {(metodoPago === "transferencia" || metodoPago === "tarjeta") && (
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-700">
                              {metodoPago === "transferencia" ? "Transferencia" : "Tarjeta / Débito"}
                            </span>
                            <button type="button" onClick={() => { setEntidadQuery(""); setCobroModalOpen(true); }} className="text-sky-600 font-medium hover:underline">
                              Editar
                            </button>
                          </div>
                          <p className="text-slate-500">
                            Entidad: <span className="text-slate-700">{entidadSel ? `${entidadSel.codigo ? entidadSel.codigo + " · " : ""}${entidadSel.nombre}` : "— sin especificar —"}</span>
                          </p>
                          {pagoReferencia.trim() && <p className="text-slate-500">Comprobante: <span className="text-slate-700">{pagoReferencia}</span></p>}
                          {metodoPago === "transferencia" && pagoTitular.trim() && (
                            <p className="text-slate-500">Titular: <span className="text-slate-700">{pagoTitular}</span></p>
                          )}
                        </div>
                      )}

                      {/* Mixto: varias líneas de pago que suman el total a cobrar */}
                      {metodoPago === "mixto" && (
                        <div className="space-y-2.5">
                          {pagosMixtos.map((p, i) => (
                            <div key={p.key} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
                              <div className="mb-1.5 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pago {i + 1}</span>
                                {pagosMixtos.length > 1 && (
                                  <button type="button" onClick={() => removePagoMixto(p.key)} className="rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-600" aria-label="Quitar pago">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Medio</label>
                                  <FancySelect
                                    ariaLabel="Medio de pago"
                                    size="sm"
                                    value={p.metodo}
                                    onChange={(v) =>
                                      updatePagoMixto(p.key, {
                                        metodo: v as PagoMixto["metodo"],
                                        entidadId: v === "efectivo" ? "" : p.entidadId,
                                      })
                                    }
                                    options={[
                                      { value: "efectivo", label: "Efectivo" },
                                      { value: "transferencia", label: "Transferencia" },
                                      { value: "tarjeta", label: "Tarjeta/Débito" },
                                    ]}
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Monto (Gs.)</label>
                                  <MontoInput
                                    value={p.monto}
                                    onChange={(n) => updatePagoMixto(p.key, { monto: n })}
                                    placeholder="0"
                                    decimals={false}
                                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm font-semibold tabular-nums outline-none focus:border-[#0EA5E9] focus:ring-2 focus:ring-[#0EA5E9]/15"
                                  />
                                </div>
                              </div>

                              {p.metodo !== "efectivo" && (
                                <div className="mt-2 space-y-2">
                                  <div>
                                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                      {p.metodo === "tarjeta" ? "Entidad / banco / POS" : "Entidad / banco"}
                                    </label>
                                    <select
                                      value={p.entidadId}
                                      onChange={(e) => updatePagoMixto(p.key, { entidadId: e.target.value })}
                                      className={`h-9 w-full rounded-md border bg-white px-2 text-xs outline-none focus:border-[#0EA5E9] focus:ring-2 focus:ring-[#0EA5E9]/15 ${p.entidadId ? "border-slate-200" : "border-amber-300 bg-amber-50"}`}
                                    >
                                      <option value="">— Elegí entidad / banco —</option>
                                      {entidades.map((en) => (
                                        <option key={en.id} value={en.id}>{en.codigo ? `${en.codigo} · ` : ""}{en.nombre}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className={p.metodo === "transferencia" ? "grid grid-cols-2 gap-2" : ""}>
                                    <div>
                                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">N° de comprobante</label>
                                      <input
                                        type="text"
                                        value={p.referencia}
                                        onChange={(e) => updatePagoMixto(p.key, { referencia: e.target.value })}
                                        placeholder="Comprobante / transacción"
                                        className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-[#0EA5E9] focus:ring-2 focus:ring-[#0EA5E9]/15"
                                      />
                                    </div>
                                    {p.metodo === "transferencia" && (
                                      <div>
                                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Titular</label>
                                        <input
                                          type="text"
                                          value={p.titular}
                                          onChange={(e) => updatePagoMixto(p.key, { titular: e.target.value })}
                                          placeholder="Nombre del titular"
                                          className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-[#0EA5E9] focus:ring-2 focus:ring-[#0EA5E9]/15"
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}

                          <button type="button" onClick={addPagoMixto} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#0EA5E9]/40 py-2 text-xs font-semibold text-[#0284C7] transition-colors hover:border-[#0EA5E9] hover:bg-[#0EA5E9]/5">
                            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Agregar otro medio de pago
                          </button>

                          <div className="space-y-1 rounded-lg bg-slate-100/70 p-2.5 text-xs">
                            <div className="flex justify-between text-slate-500">
                              <span>A cobrar</span><span className="tabular-nums">{formatGs(restaCobrar)}</span>
                            </div>
                            <div className="flex justify-between text-slate-500">
                              <span>Pagado</span><span className="tabular-nums font-semibold text-slate-700">{formatGs(pagadoMixto)}</span>
                            </div>
                            <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold">
                              <span className={faltaMixto > 0.5 ? "text-red-600" : "text-emerald-700"}>
                                {faltaMixto > 0.5 ? "Falta" : vueltoMixto > 0.5 ? "Vuelto" : "Cubierto ✓"}
                              </span>
                              <span className={`tabular-nums ${faltaMixto > 0.5 ? "text-red-600" : "text-emerald-700"}`}>
                                {formatGs(faltaMixto > 0.5 ? faltaMixto : Math.abs(vueltoMixto))}
                              </span>
                            </div>
                            {mixtoEntidadFaltante && (
                              <p className="pt-0.5 text-[11px] text-amber-600">Elegí la entidad / banco en los pagos con transferencia o tarjeta.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Error confirmar */}
          {errorVenta && (
            <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
              <span className="text-base leading-none mt-0.5">⚠</span>
              <span className="font-medium">{errorVenta}</span>
            </div>
          )}

          {/* Acciones — stack vertical full-width en mobile (mas facil de tappear),
              fila en sm+. Confirmar en orden visual primero (primary). */}
          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => router.push("/ventas")}
              className="border border-slate-200 px-6 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors min-h-[48px] w-full sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!ventaValida || guardando || efectivoInsuficiente || mixtoInvalido}
              aria-busy={guardando}
              title={efectivoInsuficiente ? "El efectivo recibido no cubre el total a cobrar." : mixtoInvalido ? "El cobro mixto no cubre el total o falta la entidad." : undefined}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 min-h-[48px] w-full sm:w-auto"
            >
              {guardando ? "Guardando…" : emitirFactura ? "Confirmar y facturar" : "Confirmar venta"}
            </button>
          </div>

        </div>

      </form>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAgregar={handleAgregarDesdePicker}
        excludeIds={items.map((i) => i.producto_id)}
        moneda={moneda}
        tipoCambio={tipoCambioNum}
        ivaDefault="10%"
      />

      {showCrearCliente && (
        <CrearClienteModal
          onClose={() => setShowCrearCliente(false)}
          onCreated={handleClienteCreado}
        />
      )}

      {/* Modal de cobro (transferencia / tarjeta-débito) */}
      {cobroModalOpen && (metodoPago === "transferencia" || metodoPago === "tarjeta") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCobroModalOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                {metodoPago === "transferencia" ? "Datos de transferencia" : "Datos de tarjeta / débito"}
              </h3>
              <button type="button" onClick={() => setCobroModalOpen(false)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Monto</label>
              <MontoInput
                value={pagoMonto}
                onChange={(n) => setPagoMonto(n)}
                className={inputClass}
              />
              {restaCobrar > 0 && Math.abs(pagoMonto - restaCobrar) > 0.5 && (
                <p className="mt-1 text-[11px] text-amber-600">A cobrar por esta venta: {formatGs(restaCobrar)}</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">
                {metodoPago === "tarjeta" ? "Entidad / banco / POS" : "Entidad / banco"}
              </label>
              <input
                type="text"
                value={entidadQuery}
                onChange={(e) => setEntidadQuery(e.target.value)}
                placeholder="Buscar por código o nombre…"
                className={inputClass}
                autoFocus
              />
              <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-100">
                {entidadesFiltradas.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">Sin entidades. Cargalas en Configuración → Entidades bancarias.</p>
                ) : (
                  entidadesFiltradas.map((en) => (
                    <button
                      key={en.id}
                      type="button"
                      onClick={() => { setPagoEntidadId(en.id); setEntidadQuery(""); setCobroError(null); }}
                      className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${pagoEntidadId === en.id ? "bg-sky-50" : ""}`}
                    >
                      {en.codigo && <span className="font-mono text-xs text-slate-400 mr-2">{en.codigo}</span>}
                      {en.nombre}
                    </button>
                  ))
                )}
              </div>
              {entidadSel && <p className="mt-1 text-[11px] text-emerald-600">Seleccionada: {entidadSel.nombre}</p>}
            </div>

            {metodoPago === "transferencia" && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Titular que transfirió <span className="text-rose-500">*</span>
                </label>
                <input type="text" value={pagoTitular} onChange={(e) => setPagoTitular(e.target.value)} placeholder="Nombre del titular" className={inputClass} />
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-600 mb-1">
                N° de comprobante / referencia
                {metodoPago === "transferencia" && <span className="text-rose-500"> *</span>}
              </label>
              <input type="text" value={pagoReferencia} onChange={(e) => setPagoReferencia(e.target.value)} placeholder="Comprobante / transacción" className={inputClass} />
              {metodoPago === "transferencia" && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Validá la transferencia antes de cerrar la venta. Ingresá el N° del comprobante que te muestra la app del banco.
                </p>
              )}
            </div>

            {cobroError && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{cobroError}</p>
            )}

            <button
              type="button"
              onClick={() => {
                // Exigir una entidad realmente seleccionada de la lista (no vale
                // escribir texto/números en el buscador de arriba).
                if (!pagoEntidadId) {
                  setCobroError(metodoPago === "tarjeta"
                    ? "Seleccioná la entidad / banco / POS de la lista."
                    : "Seleccioná la entidad / banco de la lista.");
                  return;
                }
                if (metodoPago === "transferencia") {
                  if (!pagoTitular.trim()) {
                    setCobroError("Indicá el titular que hizo la transferencia.");
                    return;
                  }
                  if (!pagoReferencia.trim()) {
                    setCobroError("Cargá el N° de comprobante para validar la transferencia.");
                    return;
                  }
                }
                setCobroError(null);
                setCobroModalOpen(false);
              }}
              className="w-full rounded-lg bg-[#0EA5E9] py-2 text-sm font-medium text-white hover:bg-[#0284C7]"
            >
              Listo
            </button>
          </div>
        </div>
      )}

      {/* Modal de confirmación: venta sin stock suficiente */}
      {confirmSinStockOpen && faltantes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmSinStockOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const hayBloqueante = faltantes.some((f) => f.bloqueante);
              return (
              <div className="flex items-start gap-2">
                <span className={`${hayBloqueante ? "text-red-500" : "text-amber-500"} text-xl leading-none`}>⚠</span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    {hayBloqueante ? "No se puede vender sin stock" : "Hay productos/insumos sin stock suficiente"}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {hayBloqueante
                      ? "Los productos marcados controlan stock: no se pueden facturar con stock 0. Quitalos, ajustá el stock o cargá una compra."
                      : "Revisá el detalle. Podés vender igual: el stock quedará negativo y se registrará el movimiento de salida."}
                  </p>
                </div>
              </div>
              );
            })()}

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs">
                    <th className="py-2 px-3 font-medium">Producto / Insumo</th>
                    <th className="py-2 px-3 font-medium text-right">Stock actual</th>
                    <th className="py-2 px-3 font-medium text-right">Solicitado</th>
                    <th className="py-2 px-3 font-medium text-right">Faltante</th>
                  </tr>
                </thead>
                <tbody>
                  {faltantes.map((f) => (
                    <tr key={f.producto_id} className="border-t border-slate-100">
                      <td className="py-2 px-3">
                        <span className="font-medium text-slate-800">{f.nombre}</span>
                        <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${f.tipo === "insumo" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                          {f.tipo === "insumo" ? "Insumo" : "Producto"}
                        </span>
                        {f.bloqueante && (
                          <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            Controla stock
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{f.stock_actual}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{f.solicitado}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold text-red-600">{f.faltante}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button type="button" onClick={() => setConfirmSinStockOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
                {faltantes.some((f) => f.bloqueante) ? "Entendido" : "Cancelar"}
              </button>
              {/* El "vender igual" solo aparece si NINGÚN faltante es bloqueante. */}
              {!faltantes.some((f) => f.bloqueante) && (
                <button type="button" disabled={guardando} aria-busy={guardando} onClick={() => void confirmarVentaSinStock()} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed">
                  {guardando ? "Guardando…" : "Confirmar venta de todos modos"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Panel post-venta: abrir ticket y (si aplica) nota de remisión */}
      {postVenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4 text-center">
            <div className="text-3xl">✅</div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">Venta {postVenta.numero} registrada</h3>
              {postVenta.credito && (
                <p className="mt-1 text-sm font-medium text-amber-700">Venta a crédito registrada. Cuenta por cobrar generada.</p>
              )}
              {postVenta.generaNota && (
                <p className="mt-1 text-sm text-sky-700">Esta venta genera nota de remisión.</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Si tu navegador bloqueó las pestañas, abrí los documentos con estos botones.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <a
                href={`/api/ventas/${postVenta.id}/ticket?auto=1`}
                target="_blank"
                rel="noopener"
                className="rounded-lg bg-[#0EA5E9] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0284C7]"
              >
                Abrir ticket
              </a>
              <button
                type="button"
                disabled={remitiendoPostVenta}
                onClick={generarRemisionDeVenta}
                className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {remitiendoPostVenta ? "Emitiendo..." : "Emitir nota de remision"}
              </button>
              {/* Recibo de dinero solo para venta contado (en crédito el recibo sale al cobrar). */}
              {!postVenta.credito && (
                <button
                  type="button"
                  onClick={async () => {
                    const r = await generarYAbrirRecibo({ origen: "venta_contado", venta_id: postVenta.id });
                    if (!r.ok) setErrorVenta(r.error ?? "No se pudo generar el recibo.");
                  }}
                  className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-2.5 text-sm font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/[0.16]"
                >
                  Generar recibo de dinero
                </button>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-center pt-1">
              <button
                type="button"
                onClick={() => { setPostVenta(null); router.push("/ventas"); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Ir a ventas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
