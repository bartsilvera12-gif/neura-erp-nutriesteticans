import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listarRemisionesGlobal } from "@/lib/ventas/server/remisiones-listado-pg";

/** GET /api/notas-remision — listado global de NR por venta (auditoria). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = new URL(request.url).searchParams;
    const str = (k: string) => {
      const v = sp.get(k);
      return v && v.trim() ? v.trim() : null;
    };

    const out = await listarRemisionesGlobal(schema, ctx.auth.empresa_id, {
      desde: str("desde"),
      hasta: str("hasta"),
      clienteId: str("cliente_id"),
      estado: str("estado"),
      texto: str("q"),
      limit: Number(sp.get("limit")) || 200,
      offset: Number(sp.get("offset")) || 0,
    });

    return NextResponse.json(successResponse(out));
  } catch (err) {
    console.error("[/api/notas-remision GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las notas de remision."), { status: 500 });
  }
}
