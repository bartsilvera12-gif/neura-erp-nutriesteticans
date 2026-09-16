import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { queryWithRetry } from "@/lib/supabase/pg-retry";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { resolverRangoCajas } from "@/lib/caja/reporte-rango";
import {
  resumirPorForma,
  resumirPorDia,
  type Forma,
  type VentaReporte,
} from "@/lib/ventas/reporte-formas-pago";

/**
 * GET /api/reportes/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Port desde manastia. Diferencia respecto al original:
 * heraclio NO tiene `ventas.cliente_nombre_libre`, `ventas.cobro_diferido`
 * ni `ventas.cobrado_at`, así que se seleccionan como NULL. El resto es
 * idéntico: usa `v.metodo_pago` de la cabecera y hace LATERAL join con
 * `ventas_pagos_detalle` para el desglose fino de pagos combinados.
 *
 * Fallback: si `ventas_pagos_detalle` no existe todavía en esta DB, la
 * query se reintenta sin el detalle y el reporte igual se arma con la
 * cabecera (pierde el split de pagos combinados, no el reporte).
 */

type FilaSql = {
  id: string;
  numero_control: string | null;
  fecha: string;
  dia: string;
  cliente_nombre: string | null;
  cliente_nombre_libre: string | null;
  total: number | string;
  estado: string | null;
  tipo_venta: string | null;
  metodo_pago: string | null;
  cobro_diferido: boolean | null;
  cobrado_at: string | null;
  det_efectivo?: number | string | null;
  det_transferencia?: number | string | null;
  det_tarjeta?: number | string | null;
  det_qr?: number | string | null;
  det_billetera?: number | string | null;
  det_saldo_favor?: number | string | null;
  det_otro?: number | string | null;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = request.nextUrl.searchParams;
    const rango = resolverRangoCajas(sp.get("desde"), sp.get("hasta"));

    const schema = assertAllowedChatDataSchema(
      await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id)
    );
    const pool = getChatPostgresPool();
    if (!pool) return NextResponse.json(errorResponse("Pool no disponible."), { status: 500 });

    const tV = quoteSchemaTable(schema, "ventas");
    const tC = quoteSchemaTable(schema, "clientes");
    const tPd = quoteSchemaTable(schema, "ventas_pagos_detalle");

    const COLUMNAS_DETALLE = `
              pd.efectivo      AS det_efectivo,
              pd.transferencia AS det_transferencia,
              pd.tarjeta       AS det_tarjeta,
              pd.qr            AS det_qr,
              pd.billetera     AS det_billetera,
              pd.saldo_favor   AS det_saldo_favor,
              pd.otro          AS det_otro,`;

    const JOIN_DETALLE = `
         LEFT JOIN LATERAL (
           SELECT SUM(monto) FILTER (WHERE metodo_pago = 'efectivo')      AS efectivo,
                  SUM(monto) FILTER (WHERE metodo_pago = 'transferencia') AS transferencia,
                  SUM(monto) FILTER (WHERE metodo_pago = 'tarjeta')       AS tarjeta,
                  SUM(monto) FILTER (WHERE metodo_pago = 'qr')            AS qr,
                  SUM(monto) FILTER (WHERE metodo_pago = 'billetera')     AS billetera,
                  SUM(monto) FILTER (WHERE metodo_pago = 'saldo_favor')   AS saldo_favor,
                  SUM(monto) FILTER (WHERE metodo_pago = 'otro')          AS otro
             FROM ${tPd} d
            WHERE d.venta_id = v.id AND d.empresa_id = v.empresa_id
         ) pd ON true`;

    /** Columnas que heraclio NO tiene todavía: se materializan como NULL para
     *  no romper el mapping. Si en el futuro se agregan por migración, cambiar
     *  a `v.cliente_nombre_libre`, `v.cobro_diferido`, `v.cobrado_at`. */
    const NULL_COLS = `
              NULL::text        AS cliente_nombre_libre,
              NULL::boolean     AS cobro_diferido,
              NULL::timestamptz AS cobrado_at`;

    const armar = (columnas: string, join: string) =>
      `SELECT v.id::text AS id, v.numero_control, v.fecha,
              to_char(v.fecha AT TIME ZONE 'America/Asuncion', 'YYYY-MM-DD') AS dia,
              COALESCE(c.empresa, c.nombre_contacto, c.nombre) AS cliente_nombre,
              ${NULL_COLS},${columnas}
              v.total, v.estado, v.tipo_venta, v.metodo_pago
         FROM ${tV} v
         LEFT JOIN ${tC} c ON c.id = v.cliente_id${join}
        WHERE v.empresa_id = $1::uuid
          AND v.fecha >= $2::timestamptz
          AND v.fecha <= $3::timestamptz
        ORDER BY v.fecha DESC`;

    const params = [ctx.auth.empresa_id, rango.start, rango.end];
    let q;
    try {
      q = await queryWithRetry<FilaSql>(pool, armar(COLUMNAS_DETALLE, JOIN_DETALLE), params);
    } catch (e) {
      /* Sin la tabla de pagos combinados el reporte igual sirve: se arma con
         la cabecera. Pierde el detalle de los pagos partidos, no el reporte. */
      const msg = e instanceof Error ? e.message : "";
      if (!/ventas_pagos_detalle/i.test(msg)) throw e;
      q = await queryWithRetry<FilaSql>(pool, armar("", ""), params);
    }

    const ventas: VentaReporte[] = q.rows.map((r) => {
      const detalle: Partial<Record<Forma, number>> = {};
      const pares: Array<[Forma, unknown]> = [
        ["efectivo", r.det_efectivo],
        ["transferencia", r.det_transferencia],
        ["tarjeta", r.det_tarjeta],
        ["qr", r.det_qr],
        ["billetera", r.det_billetera],
        ["saldo_favor", r.det_saldo_favor],
        ["otro", r.det_otro],
      ];
      for (const [forma, v] of pares) {
        const m = num(v);
        if (m !== 0) detalle[forma] = m;
      }
      return {
        id: r.id,
        numero_control: r.numero_control,
        fecha: r.fecha,
        dia: r.dia,
        cliente: r.cliente_nombre ?? r.cliente_nombre_libre ?? null,
        total: num(r.total),
        estado: r.estado,
        tipo_venta: r.tipo_venta,
        metodo_pago: r.metodo_pago,
        cobro_diferido: r.cobro_diferido ?? false,
        cobrado_at: r.cobrado_at ?? null,
        detalle,
      };
    });

    return NextResponse.json(
      successResponse({
        rango: { desde: rango.desde, hasta: rango.hasta },
        resumen: resumirPorForma(ventas),
        por_dia: resumirPorDia(ventas),
        ventas,
      })
    );
  } catch (err) {
    console.error("[/api/reportes/ventas]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de ventas."), { status: 500 });
  }
}
