/**
 * Factura una venta: crea la factura ERP (multi-línea) y emite el DE SIFEN sincrónicamente.
 *
 * No bloqueante: si algo falla (crear factura, SET caído, rechazo), NO lanza — devuelve
 * un resumen con `ok:false` y el estado alcanzado. La venta y el stock ya están confirmados
 * antes de invocar esto; nunca se revierte la venta por un fallo fiscal.
 */
import type { UsuarioConEmpresa } from "@/lib/middleware/auth";
import { getFacturasServiceClientForEmpresa } from "@/lib/facturacion/facturas-service-client";
import { crearFacturaDesdeVenta } from "@/lib/facturacion/server/crear-factura-desde-venta";
import { emitirDeFacturaServerSide } from "@/lib/sifen/server/emitir-de-factura-server-side";
import type { EstadoSifen } from "@/lib/sifen/types";

export interface FacturacionVentaResumen {
  ok: boolean;
  factura_id: string | null;
  numero_factura: string | null;
  estado_de: EstadoSifen | string | null;
  aprobado: boolean;
  reintentable: boolean;
  cdc: string | null;
  kude_disponible: boolean;
  /** Ruta del KuDE (PDF) si hay XML firmado. */
  kude_url: string | null;
  error: string | null;
}

export async function facturarVenta(
  auth: UsuarioConEmpresa,
  ventaId: string
): Promise<FacturacionVentaResumen> {
  const base: FacturacionVentaResumen = {
    ok: false,
    factura_id: null,
    numero_factura: null,
    estado_de: null,
    aprobado: false,
    reintentable: false,
    cdc: null,
    kude_disponible: false,
    kude_url: null,
    error: null,
  };

  try {
    const supabase = await getFacturasServiceClientForEmpresa(auth.empresa_id);

    const { facturaId, numeroFactura } = await crearFacturaDesdeVenta({
      supabase,
      empresaId: auth.empresa_id,
      ventaId,
    });
    base.factura_id = facturaId;
    base.numero_factura = numeroFactura;

    const emit = await emitirDeFacturaServerSide({ auth, supabase, facturaId, sync: true });
    base.estado_de = emit.estadoFinal;
    base.aprobado = emit.aprobado;
    base.reintentable = emit.reintentable;
    base.cdc = emit.cdc;
    base.kude_disponible = emit.kudeDisponible;
    base.kude_url = emit.kudeDisponible ? `/api/facturas/${facturaId}/sifen/kude` : null;
    base.error = emit.error;
    // ok = la factura se creó; el DE puede quedar pendiente/reintentable sin ser un fallo duro.
    base.ok = true;
    return base;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo facturar la venta.";
    console.error("[facturarVenta]", msg);
    base.error = msg;
    base.reintentable = Boolean(base.factura_id); // si hay factura, el DE se reintenta desde el panel
    return base;
  }
}
