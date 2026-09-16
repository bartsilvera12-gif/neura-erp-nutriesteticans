import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { crearOReusarRecibo, listarRecibos, ReciboError, type OrigenRecibo } from "@/lib/recibos/server/recibos-pg";

/**
 * GET /api/recibos-dinero — listado con filtros.
 * Query: ?desde &hasta &origen &buscar &incluir_anulados=1
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { searchParams } = new URL(request.url);
    const origenParam = searchParams.get("origen");
    const origen =
      origenParam === "venta_contado" || origenParam === "cobro_cxc" || origenParam === "manual"
        ? (origenParam as OrigenRecibo)
        : null;

    const recibos = await listarRecibos(ctx.supabase, ctx.auth.empresa_id, {
      desde: searchParams.get("desde"),
      hasta: searchParams.get("hasta"),
      origen,
      buscar: searchParams.get("buscar"),
      incluirAnulados: searchParams.get("incluir_anulados") === "1",
    });
    return NextResponse.json(successResponse({ recibos }));
  } catch (err) {
    if (err instanceof ReciboError) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    console.error("[/api/recibos-dinero GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron listar los recibos."), { status: 500 });
  }
}

/**
 * POST /api/recibos-dinero — crea (o reutiliza si ya existe) un recibo de dinero.
 * Body: { origen: 'venta_contado'|'cobro_cxc', venta_id?, cobro_cliente_id?, observaciones? }
 * NO toca stock, ventas, cobros ni deuda. Documento interno NO fiscal.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const origen = body.origen as OrigenRecibo;
    if (origen !== "venta_contado" && origen !== "cobro_cxc" && origen !== "manual") {
      return NextResponse.json(
        errorResponse("Origen inválido (venta_contado | cobro_cxc | manual)."),
        { status: 400 }
      );
    }

    const manualIn = (body.manual ?? {}) as Record<string, unknown>;
    const { recibo, existed } = await crearOReusarRecibo(
      ctx.supabase,
      ctx.auth.empresa_id,
      {
        origen,
        venta_id: body.venta_id ? String(body.venta_id) : null,
        cobro_cliente_id: body.cobro_cliente_id ? String(body.cobro_cliente_id) : null,
        observaciones: body.observaciones ? String(body.observaciones).slice(0, 2000) : null,
        manual:
          origen === "manual"
            ? {
                cliente_id: manualIn.cliente_id ? String(manualIn.cliente_id) : null,
                cliente_nombre: manualIn.cliente_nombre ? String(manualIn.cliente_nombre) : null,
                monto: Number(manualIn.monto),
                moneda: manualIn.moneda ? String(manualIn.moneda) : null,
                metodo_pago: manualIn.metodo_pago ? String(manualIn.metodo_pago) : null,
                referencia: manualIn.referencia ? String(manualIn.referencia) : null,
                concepto: manualIn.concepto ? String(manualIn.concepto) : null,
              }
            : undefined,
      },
      { id: ctx.auth.user?.id ?? null, nombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null }
    );

    return NextResponse.json(successResponse({ recibo, existed }));
  } catch (err) {
    if (err instanceof ReciboError) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    console.error("[/api/recibos-dinero POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el recibo."), { status: 500 });
  }
}
