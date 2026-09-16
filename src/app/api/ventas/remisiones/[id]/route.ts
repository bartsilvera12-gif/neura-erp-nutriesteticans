import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getRemisionVentaParaEdicion,
  editarRemisionVenta,
  RemisionVentaExcedenteError,
  type RemisionVentaItemInput,
} from "@/lib/ventas/server/remisiones-venta-pg";

/** GET /api/ventas/remisiones/[id] — detalle con el tope editable por ítem. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getRemisionVentaParaEdicion(schema, ctx.auth.empresa_id, id);
    if (!data) return NextResponse.json(errorResponse("Remisión no encontrada."), { status: 404 });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/ventas/remisiones/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la remisión."), { status: 500 });
  }
}

/** PATCH /api/ventas/remisiones/[id] — edita cantidades entregadas y observación. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    const items: RemisionVentaItemInput[] = rawItems
      .map((it) => ({
        venta_item_id: String(it.venta_item_id ?? ""),
        cantidad: Number(it.cantidad) || 0,
        observacion: typeof it.observacion === "string" ? it.observacion.slice(0, 500) : null,
      }))
      .filter((it) => it.venta_item_id);

    await editarRemisionVenta(
      schema,
      ctx.auth.empresa_id,
      id,
      items,
      typeof body.observacion === "string" ? body.observacion.slice(0, 2000) : undefined,
      { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? null, email: ctx.auth.user?.email ?? null },
      typeof body.fecha === "string" ? body.fecha : null,
      typeof body.cliente_nombre === "string" ? body.cliente_nombre.slice(0, 200) : undefined,
    );
    const data = await getRemisionVentaParaEdicion(schema, ctx.auth.empresa_id, id);
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo editar la remisión.";
    const status = err instanceof RemisionVentaExcedenteError ? 409 : /no encontrad|no pertenece|anulada/i.test(msg) ? 400 : 500;
    console.error("[/api/ventas/remisiones/[id] PATCH]", msg);
    return NextResponse.json(errorResponse(msg), { status });
  }
}
