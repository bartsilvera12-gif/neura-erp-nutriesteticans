import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { generarXmlDeCore } from "@/lib/sifen/server/generar-xml-de-core";

/**
 * POST /api/facturas/[id]/sifen/xml
 * Genera XML rDE oficial (SIFEN v150), lo sube a Storage y actualiza factura_electronica (sin firma ni SET).
 * La lógica vive en `generarXmlDeCore` (reutilizable server-side); este handler la adapta a HTTP.
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
    const debug = request.nextUrl.searchParams.get("debug") === "1";
    const r = await generarXmlDeCore(supabase, auth.empresa_id, facturaId ?? "", { debug });
    if (!r.ok) {
      return NextResponse.json(errorResponse(r.message), { status: r.status });
    }
    return NextResponse.json(successResponse(r.data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
