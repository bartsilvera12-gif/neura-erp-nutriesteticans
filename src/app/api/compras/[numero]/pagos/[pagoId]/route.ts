import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularCompraPago } from "@/lib/compras/server/compras-pg";

/** POST (verbo-acción) /anular — marca el pago como anulado sin borrarlo. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string; pagoId: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const { pagoId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo = String(body.motivo ?? "").trim() || "Anulado por el usuario";
    const out = await anularCompraPago(schema, empresaId, pagoId, motivo, {
      id: ctx.auth.usuarioCatalogId ?? null,
      nombre: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse(out));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo anular el pago.";
    const known = /no encontrado|ya anulado/i.test(msg);
    console.error("[/api/compras/[numero]/pagos/[pagoId]]", msg);
    return NextResponse.json(errorResponse(msg), { status: known ? 400 : 500 });
  }
}
