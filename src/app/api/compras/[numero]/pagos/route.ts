import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getCompraResumen,
  insertCompraPago,
  listCompraPagos,
} from "@/lib/compras/server/compras-pg";

/** GET — lista de pagos + resumen (total, pagado, saldo). */
export async function GET(
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

    const [resumen, pagos] = await Promise.all([
      getCompraResumen(schema, empresaId, numeroControl),
      listCompraPagos(schema, empresaId, numeroControl),
    ]);
    if (!resumen) return NextResponse.json(errorResponse("Compra no encontrada."), { status: 404 });
    return NextResponse.json(successResponse({ resumen, pagos }));
  } catch (err) {
    console.error("[/api/compras/[numero]/pagos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron obtener los pagos."), { status: 500 });
  }
}

/** POST — registra un pago. */
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
    const monto = Number(body.monto);
    if (!(monto > 0))
      return NextResponse.json(errorResponse("El monto debe ser mayor a 0."), { status: 400 });

    const fechaRaw = String(body.fecha ?? "").trim();
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)
      ? fechaRaw
      : new Date().toISOString().slice(0, 10);

    const medio = String(body.medio_pago ?? "efectivo").trim().toLowerCase().slice(0, 32);
    const obs = body.observacion != null ? String(body.observacion).trim().slice(0, 500) : null;

    const out = await insertCompraPago(schema, empresaId, numeroControl,
      { fecha, monto, medio_pago: medio, observacion: obs },
      { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.user?.email ?? null }
    );
    return NextResponse.json(successResponse(out));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo registrar el pago.";
    const known = /no encontrada|anulada|monto|saldo/i.test(msg);
    console.error("[/api/compras/[numero]/pagos POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: known ? 400 : 500 });
  }
}
