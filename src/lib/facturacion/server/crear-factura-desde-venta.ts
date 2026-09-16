/**
 * Crea una factura ERP (facturas + N factura_items) espejando las líneas de una venta.
 *
 * A diferencia de POST /api/facturas (una sola línea, un solo IVA), esta ruta soporta
 * múltiples líneas con IVA por línea (exenta/5%/10%), que es lo que el builder SIFEN
 * necesita para emitir un DE fiel a la venta.
 *
 * Idempotente: si la venta ya tiene `factura_id`, devuelve esa factura sin recrear.
 * Consumidor Final: si la venta no tiene cliente, factura contra el cliente marcado
 * `sifen_receptor_innominado = true` (receptor innominado del DE).
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  montosFacturaItemParaInsert,
  tasaIvaDesdeTipoIvaVenta,
} from "@/lib/facturacion/factura-item-montos";
import { obtenerSiguienteNumeroFacturaEmpresa } from "@/lib/facturacion/factura-suscripcion-servidor";
import { fechaMasDiasCalendario, toCalendarDateStr } from "@/lib/fechas/calendario";
import { emitEvent, EVENT_TYPES } from "@/lib/integrations/events";

export interface CrearFacturaDesdeVentaParams {
  supabase: AppSupabaseClient;
  empresaId: string;
  ventaId: string;
}

export interface CrearFacturaDesdeVentaResult {
  facturaId: string;
  numeroFactura: string;
  /** true si la factura ya existía (venta.factura_id seteado) y no se recreó. */
  reutilizada: boolean;
}

interface VentaRow {
  id: string;
  cliente_id: string | null;
  moneda: string | null;
  fecha: string | null;
  tipo_venta: string | null;
  plazo_dias: number | null;
  total: number | string | null;
  factura_id: string | null;
}

interface VentaItemRow {
  producto_nombre: string | null;
  cantidad: number | string | null;
  precio_venta: number | string | null;
  tipo_iva: string | null;
  total_linea: number | string | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resuelve el cliente_id para la factura. Si la venta no trae cliente, usa el
 * cliente "Consumidor Final" (sifen_receptor_innominado = true) de la empresa.
 */
async function resolverClienteId(
  supabase: AppSupabaseClient,
  empresaId: string,
  ventaClienteId: string | null
): Promise<string> {
  const directo = (ventaClienteId ?? "").trim();
  if (directo) return directo;

  const { data, error } = await supabase
    .from("clientes")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("sifen_receptor_innominado", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo resolver el cliente Consumidor Final: ${error.message}`);
  const id = (data as { id?: string } | null)?.id?.trim();
  if (!id) {
    throw new Error(
      "La venta no tiene cliente y no existe un cliente 'Consumidor Final' (sifen_receptor_innominado) en la empresa."
    );
  }
  return id;
}

export async function crearFacturaDesdeVenta(
  p: CrearFacturaDesdeVentaParams
): Promise<CrearFacturaDesdeVentaResult> {
  const { supabase, empresaId, ventaId } = p;

  // 1) Cargar venta
  const { data: ventaRaw, error: errVenta } = await supabase
    .from("ventas")
    .select("id, cliente_id, moneda, fecha, tipo_venta, plazo_dias, total, factura_id")
    .eq("id", ventaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (errVenta) throw new Error(errVenta.message);
  if (!ventaRaw) throw new Error("Venta no encontrada.");
  const venta = ventaRaw as VentaRow;

  // 2) Idempotencia: la venta ya fue facturada
  if (venta.factura_id) {
    const { data: facExist } = await supabase
      .from("facturas")
      .select("id, numero_factura")
      .eq("id", venta.factura_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (facExist) {
      const f = facExist as { id: string; numero_factura: string };
      return { facturaId: f.id, numeroFactura: f.numero_factura, reutilizada: true };
    }
    // factura_id apuntaba a algo inexistente: seguimos y creamos una nueva.
  }

  // 3) Cargar líneas
  const { data: itemsRaw, error: errItems } = await supabase
    .from("ventas_items")
    .select("producto_nombre, cantidad, precio_venta, tipo_iva, total_linea")
    .eq("venta_id", ventaId)
    .eq("empresa_id", empresaId);
  if (errItems) throw new Error(errItems.message);
  const lineas = (itemsRaw ?? []) as VentaItemRow[];
  if (lineas.length === 0) throw new Error("La venta no tiene líneas para facturar.");

  // 4) Cliente (Consumidor Final si no hay)
  const clienteId = await resolverClienteId(supabase, empresaId, venta.cliente_id);

  // 5) Datos de cabecera
  const moneda = (venta.moneda ?? "GS").toUpperCase() === "USD" ? "USD" : "GS";
  const tipo = (venta.tipo_venta ?? "").toUpperCase() === "CREDITO" ? "credito" : "contado";
  const fechaNorm =
    toCalendarDateStr(String(venta.fecha ?? "")) || String(venta.fecha ?? "").slice(0, 10);
  const fechaVenc =
    tipo === "credito"
      ? fechaMasDiasCalendario(fechaNorm, Number(venta.plazo_dias) > 0 ? Number(venta.plazo_dias) : 30)
      : fechaNorm;
  const totalVenta = num(venta.total);

  const numeroFactura = await obtenerSiguienteNumeroFacturaEmpresa(supabase, empresaId);

  // 6) Insertar factura
  const { data: facCreada, error: errFac } = await supabase
    .from("facturas")
    .insert([
      {
        empresa_id: empresaId,
        cliente_id: clienteId,
        numero_factura: numeroFactura,
        fecha: fechaNorm,
        fecha_vencimiento: fechaVenc,
        monto: totalVenta,
        saldo: totalVenta,
        estado: "Pendiente",
        tipo,
        moneda,
      },
    ])
    .select()
    .single();
  if (errFac || !(facCreada as { id?: string })?.id) {
    throw new Error(errFac?.message ?? "No se pudo crear la factura desde la venta.");
  }
  const facturaId = String((facCreada as { id: string }).id);

  // 7) Insertar N factura_items (una por línea de venta), con IVA por línea
  const itemsRows = lineas.map((l) => {
    const cantidad = num(l.cantidad) > 0 ? num(l.cantidad) : 1;
    const tasa = tasaIvaDesdeTipoIvaVenta(l.tipo_iva);
    const m = montosFacturaItemParaInsert({
      totalLinea: num(l.total_linea),
      moneda,
      cantidad,
      precioUnitario: num(l.precio_venta),
      tasaIva: tasa,
    });
    // La migración 0005 hizo NOT NULL a factura_items.tipo_iva con check
    // ('EXENTA' | '5%' | '10%'). Normalizamos desde la línea de venta.
    const tipoIvaNorm = tasa === 0 ? "EXENTA" : tasa === 5 ? "5%" : "10%";
    return {
      factura_id: facturaId,
      empresa_id: empresaId,
      descripcion: (l.producto_nombre ?? "").trim() || "Ítem de venta",
      cantidad,
      precio_unitario: m.precio_unitario,
      subtotal: m.subtotal,
      iva: m.iva,
      total: m.total,
      tipo_iva: tipoIvaNorm,
    };
  });

  const { error: errInsItems } = await supabase.from("factura_items").insert(itemsRows);
  if (errInsItems) {
    // Rollback best-effort de la factura para no dejar cabecera sin líneas.
    await supabase.from("facturas").delete().eq("id", facturaId).eq("empresa_id", empresaId);
    throw new Error(`No se pudo registrar el detalle de la factura: ${errInsItems.message}`);
  }

  // 8) Enlazar venta → factura
  const { error: errLink } = await supabase
    .from("ventas")
    .update({ factura_id: facturaId })
    .eq("id", ventaId)
    .eq("empresa_id", empresaId);
  if (errLink) {
    // No revertimos: la factura es válida; el enlace se puede reintentar. Log arriba.
    console.error("[crearFacturaDesdeVenta] no se pudo enlazar venta→factura:", errLink.message);
  }

  try {
    await emitEvent(EVENT_TYPES.factura_creada, {
      factura_id: facturaId,
      cliente_id: clienteId,
      monto: totalVenta,
    });
  } catch {
    /* el evento es best-effort */
  }

  return { facturaId, numeroFactura, reutilizada: false };
}
