import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { crearBorradorDeCore } from "@/lib/sifen/server/crear-borrador-de-core";

/**
 * POST /api/facturas/[id]/sifen/borrador
 * Crea (o devuelve) el registro factura_electronica en estado borrador, sin XML ni SET.
 * La lógica vive en `crearBorradorDeCore` (reutilizable server-side); este handler la adapta a HTTP.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: facturaId } = await params;
    const r = await crearBorradorDeCore(supabase, auth.empresa_id, facturaId ?? "");
    if (!r.ok) {
      return NextResponse.json(errorResponse(r.message), { status: r.status });
    }
    return NextResponse.json(successResponse(r.data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
