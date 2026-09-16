import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getAutoimpresor } from "@/lib/facturacion/server/facturacion-modo-pg";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";
import { buildPresupuestoPdf, type PresupuestoPdfData, type PresupuestoEmisor } from "@/lib/presupuestos/server/presupuesto-pdf";

/**
 * GET /api/presupuestos/[id]/pdf
 *
 * Devuelve el presupuesto como PDF real descargable (pdf-lib, A4, diseño formal).
 * NO fiscal, NO toca SIFEN, NO descuenta stock.
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const empresaId = ctx.auth.empresa_id;

  const pq = await ctx.supabase
    .from("presupuestos")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  if (pq.error || !pq.data) return new NextResponse("Presupuesto no encontrado", { status: 404 });
  const p = pq.data as Record<string, unknown>;

  const itq = await ctx.supabase
    .from("presupuesto_items")
    .select("producto_nombre, sku, cantidad, unidad_medida, precio_unitario, iva_tipo, descuento, total")
    .eq("empresa_id", empresaId)
    .eq("presupuesto_id", id)
    .order("created_at", { ascending: true });
  const itemsRaw = (itq.data ?? []) as Record<string, unknown>[];

  // Emisor: datos reales del autoimpresor (razón social, RUC, dirección, teléfono).
  let emisor: PresupuestoEmisor = {
    nombre: EMPRESA_DOC.nombre,
    ruc: null,
    direccion: null,
    telefono: EMPRESA_DOC.telefono || null,
    actividad: EMPRESA_DOC.actividad[0] ?? null,
  };
  try {
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const cfg = await getAutoimpresor(schema, empresaId);
    emisor = {
      nombre: cfg.razon_social_emisor?.trim() || EMPRESA_DOC.nombre,
      ruc: cfg.ruc_emisor?.trim() || null,
      direccion: cfg.direccion_matriz?.trim() || null,
      telefono: cfg.telefono?.trim() || EMPRESA_DOC.telefono || null,
      actividad: EMPRESA_DOC.actividad[0] ?? null,
    };
  } catch {
    /* fallback a EMPRESA_DOC */
  }

  const data: PresupuestoPdfData = {
    numero_control: String(p.numero_control ?? ""),
    fecha: String(p.fecha ?? ""),
    fecha_vencimiento: p.fecha_vencimiento ? String(p.fecha_vencimiento) : null,
    validez_dias: p.validez_dias == null ? null : Number(p.validez_dias),
    condicion: p.condicion === "credito" ? "credito" : "contado",
    moneda: String(p.moneda ?? "PYG"),
    forma_pago: p.forma_pago ? String(p.forma_pago) : null,
    plazo_entrega: p.plazo_entrega ? String(p.plazo_entrega) : null,
    observaciones: p.observaciones ? String(p.observaciones) : null,
    cliente: {
      nombre: String(p.cliente_nombre ?? "—"),
      ruc: p.cliente_ruc ? String(p.cliente_ruc) : null,
      telefono: p.cliente_telefono ? String(p.cliente_telefono) : null,
      direccion: p.cliente_direccion ? String(p.cliente_direccion) : null,
    },
    items: itemsRaw.map((it) => ({
      producto_nombre: String(it.producto_nombre ?? ""),
      sku: it.sku ? String(it.sku) : null,
      cantidad: Number(it.cantidad) || 0,
      unidad_medida: it.unidad_medida ? String(it.unidad_medida) : null,
      precio_unitario: Number(it.precio_unitario) || 0,
      iva_tipo: String(it.iva_tipo ?? ""),
      descuento: Number(it.descuento) || 0,
      total: Number(it.total) || 0,
    })),
    subtotal: Number(p.subtotal) || 0,
    monto_iva: Number(p.monto_iva) || 0,
    descuento_total: Number(p.descuento_total) || 0,
    total: Number(p.total) || 0,
  };

  const pdf = await buildPresupuestoPdf(data, emisor);
  const slug = String(p.numero_control ?? "presupuesto").replace(/[^a-zA-Z0-9-]+/g, "-");

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
