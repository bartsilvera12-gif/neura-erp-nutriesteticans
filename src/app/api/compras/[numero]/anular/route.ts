import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularCompraConMovimiento } from "@/lib/compras/server/compras-pg";

/**
 * POST /api/compras/[numero]/anular — marca estado='anulada' y revierte stock
 * con un movimiento 'anulacion_compra' por cada línea. Rechaza si la compra
 * viene de una OC, si hay pagos no anulados o si el stock actual quedaría negativo.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const { numero } = await params;
    const numeroControl = decodeURIComponent(numero);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo = String(body.motivo ?? "").trim();
    if (motivo.length < 3)
      return NextResponse.json(errorResponse("Indicá un motivo (mínimo 3 caracteres)."), { status: 400 });

    const out = await anularCompraConMovimiento(schema, empresaId, numeroControl, motivo, {
      id: ctx.auth.usuarioCatalogId ?? null,
      nombre: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse(out));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo anular la compra.";
    const known = /no encontrada|ya está anulada|orden de compra|stock actual|pagos registrados/i.test(msg);
    console.error("[/api/compras/[numero]/anular]", msg);
    return NextResponse.json(errorResponse(msg), { status: known ? 400 : 500 });
  }
}
