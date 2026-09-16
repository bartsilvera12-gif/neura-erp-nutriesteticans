import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { consultarRuc } from "@/lib/set/consulta-ruc";

/**
 * POST /api/set/consulta-ruc   body: { ruc: string }
 *
 * Consulta al servicio "Consulta Publica" del Sistema Marangatu (SET/DNIT)
 * y devuelve razon social, estado, categoria, mes de cierre, tipo de persona,
 * RUC anterior, tipo de sociedad y nombre comercial.
 *
 * Requiere:
 *   - Usuario autenticado (evitar exponer el APIKEY publicamente).
 *   - SET_CONSULTA_PUBLICA_APIKEY definida en el servidor.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: { ruc?: unknown };
    try {
      body = (await request.json()) as { ruc?: unknown };
    } catch {
      return NextResponse.json(errorResponse("Cuerpo invalido: se esperaba { ruc }."), { status: 400 });
    }

    const rucEntrada = String(body.ruc ?? "").trim();
    if (!rucEntrada) {
      return NextResponse.json(errorResponse("Falta el RUC."), { status: 400 });
    }

    const r = await consultarRuc(rucEntrada);
    if (!r.ok) {
      const status = r.httpStatus === 0 ? 500 : 502;
      return NextResponse.json(errorResponse(r.mensaje), { status });
    }

    if (r.resultado.encontrado) {
      const c = r.resultado.contribuyente;
      return NextResponse.json(
        successResponse({
          encontrado: true,
          ruc: `${r.consultado.ruc}-${r.consultado.dv}`,
          razon_social: c.razonSocial,
          estado: c.estado,
          categoria: c.categoria,
          mes_cierre: c.mesCierre,
          tipo_persona: c.tipoPersona,
          ruc_anterior: c.rucAnterior,
          tipo_sociedad: c.tipoSociedad,
          nombre_comercial: c.nombreComercial,
          codigo: r.resultado.codigo,
        })
      );
    }

    // Cuota agotada / apikey invalida: mismo endpoint pero al operador le sirve
    // que la UI le muestre un mensaje claro, no un "no encontrado" enganoso.
    if (r.resultado.esErrorDeCuotaOApikey) {
      return NextResponse.json(
        errorResponse(`SET rechazó la consulta (${r.resultado.codigo}): ${r.resultado.mensaje}`),
        { status: 429 }
      );
    }

    return NextResponse.json(
      successResponse({
        encontrado: false,
        ruc: `${r.consultado.ruc}-${r.consultado.dv}`,
        codigo: r.resultado.codigo,
        mensaje: r.resultado.mensaje,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/set/consulta-ruc]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
