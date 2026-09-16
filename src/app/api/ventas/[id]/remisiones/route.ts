import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  crearRemisionVenta,
  getResumenVentaEntrega,
  listarRemisionesVenta,
  RemisionVentaExcedenteError,
  type RemisionVentaItemInput,
} from "@/lib/ventas/server/remisiones-venta-pg";

/** GET /api/ventas/[id]/remisiones — resumen vendido/entregado/pendiente + remisiones. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const [resumen, remisiones] = await Promise.all([
      getResumenVentaEntrega(schema, ctx.auth.empresa_id, id),
      listarRemisionesVenta(schema, ctx.auth.empresa_id, id),
    ]);
    if (!resumen) return NextResponse.json(errorResponse("Venta no encontrada."), { status: 404 });
    return NextResponse.json(successResponse({ resumen, remisiones }));
  } catch (err) {
    console.error("[/api/ventas/[id]/remisiones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las remisiones."), { status: 500 });
  }
}

/** POST /api/ventas/[id]/remisiones — registra una entrega (total o parcial). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      .filter((it) => it.venta_item_id && it.cantidad > 0);
    if (items.length === 0) {
      return NextResponse.json(errorResponse("Indicá al menos un producto con cantidad a entregar."), { status: 400 });
    }

    const out = await crearRemisionVenta(
      schema,
      ctx.auth.empresa_id,
      {
        venta_id: id,
        observacion: typeof body.observacion === "string" ? body.observacion.slice(0, 2000) : null,
        fecha: typeof body.fecha === "string" ? body.fecha : null,
        items,
      },
      { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? null, email: ctx.auth.user?.email ?? null },
    );
    return NextResponse.json(successResponse(out));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo crear la remisión.";
    const status = err instanceof RemisionVentaExcedenteError ? 409 : /no encontrad|no pertenece|al menos/i.test(msg) ? 400 : 500;
    console.error("[/api/ventas/[id]/remisiones POST]", msg);
    return NextResponse.json(errorResponse(msg), { status });
  }
}
