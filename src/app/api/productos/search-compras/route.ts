import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { searchProductosPg } from "@/lib/inventario/server/productos-pg";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * GET /api/productos/search-compras?q=...&limit=30
 *
 * Buscador de productos para COMPRAS. A diferencia de /api/productos/search
 * (ventas), este:
 *  - NO filtra por es_vendible: en compras hay que poder cargar insumos y
 *    materia prima que no se venden.
 *  - Busca por tokens también en categoría, proveedor y ubicación (además de
 *    nombre, sku y código de barras), reutilizando `searchProductosPg`.
 *  - Incluye productos sin stock: una compra es justamente la entrada que les
 *    va a dar stock.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT));

    const rows = await searchProductosPg(schema, empresaId, q, limit);

    const items = rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      sku: r.sku,
      codigo_barras: r.codigo_barras,
      unidad_medida: String(r.unidad_medida ?? "UNIDAD"),
      stock_actual: Number(r.stock_actual ?? 0),
      costo_promedio: Number(r.costo_promedio ?? 0),
      precio_venta: Number(r.precio_venta ?? 0),
      categoria_nombre: r.categoria_nombre,
      proveedor_nombre: r.proveedor_nombre,
      ubicacion_nombre: r.ubicacion_nombre,
      es_vendible: r.es_vendible !== false,
      es_insumo: r.es_insumo === true,
      controla_stock: r.controla_stock !== false,
    }));

    return NextResponse.json(successResponse({ items, count: items.length, q }));
  } catch (e) {
    console.error("[productos/search-compras]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo buscar productos."), { status: 500 });
  }
}
