import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Proveedor } from "@/lib/proveedores/types";
import {
  listProveedores,
  insertProveedor,
  findProveedorByRuc,
  type ProveedorRow,
} from "@/lib/proveedores/server/proveedores-pg";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

function mapProveedorRow(r: ProveedorRow): Proveedor {
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    nombre: r.nombre ?? "",
    nombre_comercial: r.nombre_comercial ?? null,
    razon_social: r.razon_social ?? null,
    ruc: r.ruc ?? null,
    telefono: r.telefono ?? null,
    email: r.email ?? null,
    direccion: r.direccion ?? null,
    contacto: r.contacto ?? null,
    estado: r.estado === "inactivo" ? "inactivo" : "activo",
    condicion_pago:
      r.condicion_pago === "contado" || r.condicion_pago === "credito" || r.condicion_pago === "mixto"
        ? r.condicion_pago
        : null,
    plazo_pago_dias: r.plazo_pago_dias != null ? Number(r.plazo_pago_dias) : null,
    moneda_preferida: r.moneda_preferida === "USD" ? "USD" : r.moneda_preferida === "GS" ? "GS" : null,
    observaciones: r.observaciones ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * GET /api/proveedores — lista con categorías resueltas (PG directo).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;

    // Serializado para no agotar pool (session mode max 15 conexiones).
    const provs = await listProveedores(schema, empresaId);
    const proveedores: Proveedor[] = provs.map(mapProveedorRow);

    return NextResponse.json(successResponse({ proveedores }));
  } catch (err) {
    console.error("[/api/proveedores GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudieron cargar los proveedores."),
      { status: 500 }
    );
  }
}

/**
 * POST /api/proveedores — alta con categorías opcionales (PG directo).
 *
 * Normalizacion: nombre/razon_social/RUC/direccion/contacto/observaciones se
 * guardan en mayusculas. Email queda tal cual (lowercased).
 *
 * El campo principal del proveedor en el modelo es `nombre`. Si el usuario
 * solo envia `razon_social` y no `nombre`, copiamos razon_social → nombre
 * para mantener compatibilidad con listados / selectors.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Campo principal: aceptar nombre o razon_social, lo que haya.
    const nombreInput = normalizeUpperText(body.nombre);
    const razonSocialInput = normalizeUpperNullable(body.razon_social);
    const nombre = nombreInput || razonSocialInput || "";
    if (!nombre) {
      return NextResponse.json(
        errorResponse("La razón social / nombre del proveedor es obligatoria."),
        { status: 400 }
      );
    }
    // Si el usuario no cargo razon_social y solo cargo nombre, copiar para que
    // facturacion/SIFEN tenga ese campo poblado.
    const razonSocial = razonSocialInput ?? nombre;
    const nombreComercial = normalizeUpperNullable(body.nombre_comercial);

    const ruc = normalizeUpperNullable(body.ruc);
    const telefono = body.telefono == null ? null : String(body.telefono).trim() || null;
    const email = body.email == null ? null : String(body.email).trim().toLowerCase() || null;
    const direccion = normalizeUpperNullable(body.direccion);
    const contacto = normalizeUpperNullable(body.contacto);
    const observaciones = normalizeUpperNullable(body.observaciones);
    const estado = body.estado === "inactivo" ? "inactivo" : "activo";
    const condicion_pago =
      body.condicion_pago === "contado" ||
      body.condicion_pago === "credito" ||
      body.condicion_pago === "mixto"
        ? (body.condicion_pago as "contado" | "credito" | "mixto")
        : null;
    const plazo_pago_dias =
      body.plazo_pago_dias != null && String(body.plazo_pago_dias).trim() !== ""
        ? parseInt(String(body.plazo_pago_dias), 10) || null
        : null;
    const moneda_preferida = body.moneda_preferida === "USD" || body.moneda_preferida === "GS"
      ? (body.moneda_preferida as "USD" | "GS")
      : null;

    // Duplicado por RUC
    if (ruc) {
      try {
        const dup = await findProveedorByRuc(schema, empresaId, ruc);
        if (dup) {
          return NextResponse.json(
            errorResponse(`Ya existe un proveedor con el mismo RUC ("${dup.nombre}").`),
            { status: 409 }
          );
        }
      } catch (e) {
        console.error("[/api/proveedores POST] findProveedorByRuc", { schema, empresaId, msg: e instanceof Error ? e.message : e });
      }
    }

    try {
      const row = await insertProveedor(schema, empresaId, {
        nombre,
        nombre_comercial: nombreComercial,
        razon_social: razonSocial,
        ruc,
        telefono,
        email,
        direccion,
        contacto,
        estado,
        condicion_pago,
        plazo_pago_dias,
        moneda_preferida,
        observaciones,
      });

      const prov = mapProveedorRow(row);
      return NextResponse.json(successResponse({ proveedor: prov }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = (e as { code?: string })?.code;
      if (code === "23505" || /unique|duplicate/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Ya existe un proveedor con datos únicos en conflicto (RUC/nombre)."),
          { status: 409 }
        );
      }
      console.error("[/api/proveedores POST]", { schema, empresaId, msg, code });
      return NextResponse.json(
        errorResponse("No se pudo guardar el proveedor. Revisá los datos e intentá nuevamente."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/proveedores POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo guardar el proveedor."),
      { status: 500 }
    );
  }
}
