import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getRemisionVentaParaEdicion } from "@/lib/ventas/server/remisiones-venta-pg";
import { renderRemisionVentaHTML } from "@/lib/ventas/remision-venta-html";
import { logoClienteSrc } from "@/lib/documentos/logo-embed";

/**
 * GET /api/ventas/remisiones/[id]/pdf?auto=1
 * Nota de remisión de una VENTA. Imprime SOLO lo entregado en esta remisión y
 * deja constancia de lo pendiente.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getRemisionVentaParaEdicion(schema, ctx.auth.empresa_id, id);
    if (!data) return new NextResponse("Remisión no encontrada", { status: 404 });

    const html = renderRemisionVentaHTML(data, logoClienteSrc());
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (err) {
    console.error("[/api/ventas/remisiones/[id]/pdf]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el documento."), { status: 500 });
  }
}
