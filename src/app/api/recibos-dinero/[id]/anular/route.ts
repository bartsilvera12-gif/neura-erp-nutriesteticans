import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularRecibo, ReciboError } from "@/lib/recibos/server/recibos-pg";

/**
 * POST /api/recibos-dinero/[id]/anular — marca el recibo como anulado.
 * Body: { motivo?: string }
 * No revierte la venta ni el cobro: el recibo es un comprobante interno NO fiscal.
 */
export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { motivo?: unknown };
    const motivo = typeof body.motivo === "string" ? body.motivo.slice(0, 500) : null;

    const recibo = await anularRecibo(ctx.supabase, ctx.auth.empresa_id, id, motivo);
    return NextResponse.json(successResponse({ recibo }));
  } catch (err) {
    if (err instanceof ReciboError) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    console.error("[/api/recibos-dinero/[id]/anular]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo anular el recibo."), { status: 500 });
  }
}
