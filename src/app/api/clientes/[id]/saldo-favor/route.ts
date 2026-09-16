import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getSaldoCliente, listarMovimientosCliente } from "@/lib/creditos/server/creditos-pg";

/**
 * GET /api/clientes/[id]/saldo-favor
 * Saldo a favor del cliente + últimos movimientos. Lo usa Caja para avisarle al
 * cajero que el cliente tiene crédito disponible.
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const auth = await getUserAndEmpresa(request);
    if (!auth?.empresa_id) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const [saldo, movimientos] = await Promise.all([
      getSaldoCliente(schema, auth.empresa_id, id),
      listarMovimientosCliente(schema, auth.empresa_id, id, 20),
    ]);
    return NextResponse.json(successResponse({ saldo, movimientos }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar el saldo.";
    console.error("[/api/clientes/[id]/saldo-favor]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
