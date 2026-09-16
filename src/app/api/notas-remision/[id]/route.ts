import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const COLS =
  "id, empresa_id, numero, fecha, emisor, ubicacion_origen_id, ubicacion_destino_id, motivo, estado, motivo_rechazo, aprobada_at, aprobada_por, transportista, ruc_transportista, conductor, ci_conductor, chapa, fecha_inicio_traslado, fecha_fin_traslado, observaciones, created_at, updated_at, destino_tipo, cliente_id, destino_nombre, destino_direccion, destino_ciudad, modo, motivo_traslado, direccion_origen, direccion_destino";

/** GET /api/notas-remision/[id] — detalle con items + nombres de ubicación (si hay). */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    const nrQ = await supabase
      .from("notas_remision")
      .select(COLS)
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (nrQ.error) throw new Error(nrQ.error.message);
    if (!nrQ.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const nr = nrQ.data as Record<string, unknown>;

    const ubIds = [nr.ubicacion_origen_id, nr.ubicacion_destino_id].filter(
      (x): x is string => typeof x === "string" && !!x
    );

    const itemsQ = await supabase
      .from("notas_remision_items")
      .select("producto_id, cantidad, descripcion, unidad_medida")
      .eq("nota_remision_id", id);
    if (itemsQ.error) throw new Error(itemsQ.error.message);

    let ubMap = new Map<string, { nombre: string; codigo: string }>();
    if (ubIds.length > 0) {
      const ubQ = await supabase
        .from("inventario_ubicaciones")
        .select("id, nombre, codigo")
        .eq("empresa_id", auth.empresa_id)
        .in("id", ubIds);
      if (ubQ.error) throw new Error(ubQ.error.message);
      ubMap = new Map(
        ((ubQ.data ?? []) as Array<{ id: string; nombre: string; codigo: string }>).map((u) => [
          u.id,
          { nombre: u.nombre, codigo: u.codigo },
        ])
      );
    }

    const items = (itemsQ.data ?? []) as Array<{
      producto_id: string | null;
      cantidad: number;
      descripcion: string | null;
      unidad_medida: string | null;
    }>;

    // Nombres de productos SOLO para ítems ligados al catálogo (flujo viejo).
    // Los ítems talonario ya tienen `descripcion`/`unidad_medida` propias.
    const prodIds = Array.from(new Set(items.map((i) => i.producto_id).filter((x): x is string => !!x)));
    const prodMap = new Map<string, { nombre: string; sku: string }>();
    if (prodIds.length > 0) {
      const pQ = await supabase
        .from("productos")
        .select("id, nombre, sku")
        .eq("empresa_id", auth.empresa_id)
        .in("id", prodIds);
      if (pQ.error) throw new Error(pQ.error.message);
      for (const p of (pQ.data ?? []) as Array<{ id: string; nombre: string; sku: string | null }>) {
        prodMap.set(p.id, { nombre: p.nombre, sku: p.sku ?? "" });
      }
    }

    const detalleItems = items.map((i) => {
      if (i.producto_id) {
        const p = prodMap.get(i.producto_id);
        return {
          producto_id: i.producto_id,
          producto_nombre: p?.nombre ?? "?",
          producto_sku: p?.sku ?? "",
          descripcion: i.descripcion,
          unidad_medida: i.unidad_medida,
          cantidad: Number(i.cantidad),
        };
      }
      return {
        producto_id: null,
        producto_nombre: i.descripcion ?? "",
        producto_sku: "",
        descripcion: i.descripcion,
        unidad_medida: i.unidad_medida,
        cantidad: Number(i.cantidad),
      };
    });

    return NextResponse.json(successResponse({
      nota_remision: {
        ...nr,
        origen: nr.ubicacion_origen_id ? ubMap.get(nr.ubicacion_origen_id as string) ?? null : null,
        destino: nr.ubicacion_destino_id ? ubMap.get(nr.ubicacion_destino_id as string) ?? null : null,
        items: detalleItems,
      },
    }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
