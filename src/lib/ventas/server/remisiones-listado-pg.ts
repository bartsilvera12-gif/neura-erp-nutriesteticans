/**
 * Listado global de notas de remision (auditoria) — variante Heraclio.
 *
 * Toda NR aca cuelga de una VENTA (no existe el flujo NR-desde-factura). Se
 * mantiene el shape de columnas que consume `NotasRemisionListClient.tsx`
 * (`factura_id`, `factura_numero`, `factura_autoimpresor`), poblado con NULL
 * o con `venta.factura_id` cuando esta.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface FiltrosRemisiones {
  desde?: string | null;
  hasta?: string | null;
  clienteId?: string | null;
  estado?: string | null;
  /** Busca en numero de remision, observacion y numero de venta/factura. */
  texto?: string | null;
  limit?: number;
  offset?: number;
}

export interface RemisionListadoRow {
  id: string;
  numero: string;
  estado: string;
  fecha: string;
  observacion: string | null;
  anulada_motivo: string | null;
  usuario_creador_nombre: string | null;
  venta_id: string | null;
  factura_id: string | null;
  venta_numero: string | null;
  factura_numero: string | null;
  factura_autoimpresor: string | null;
  numero_orden_compra: string | null;
  cliente_nombre: string | null;
  total_items: number;
  total_cantidad: number;
  /** Cantidad del documento de origen (venta) que todavia no se remitio. */
  pendiente_entrega: number;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export async function listarRemisionesGlobal(
  schema: string,
  empresaId: string,
  f: FiltrosRemisiones = {},
): Promise<{ rows: RemisionListadoRow[]; total: number }> {
  assertAllowedChatDataSchema(schema);
  const tR = quoteSchemaTable(schema, "notas_remision");
  const tRI = quoteSchemaTable(schema, "notas_remision_items");
  const tV = quoteSchemaTable(schema, "ventas");
  const tF = quoteSchemaTable(schema, "facturas");
  const tC = quoteSchemaTable(schema, "clientes");
  const tVI = quoteSchemaTable(schema, "ventas_items");

  const cond: string[] = ["r.empresa_id = $1::uuid"];
  const vals: unknown[] = [empresaId];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    cond.push(sql.replace("$$", "$" + vals.length));
  };

  if (f.desde) add("r.fecha >= $$::timestamptz", f.desde);
  if (f.hasta) add("r.fecha < ($$::date + interval '1 day')", f.hasta);
  if (f.clienteId) add("r.cliente_id = $$::uuid", f.clienteId);
  if (f.estado) add("r.estado = $$", f.estado);
  if (f.texto) {
    vals.push("%" + f.texto.trim() + "%");
    const i = "$" + vals.length;
    cond.push(
      `(r.numero ILIKE ${i} OR COALESCE(r.observacion,'') ILIKE ${i}
        OR COALESCE(v.numero_control,'') ILIKE ${i} OR COALESCE(f.numero_factura,'') ILIKE ${i})`,
    );
  }

  // Solo listamos NR ligadas a una venta (el flujo talonario viejo queda
  // fuera de este listado: sus filas no tienen venta_id y ya no se crean).
  cond.push("r.venta_id IS NOT NULL");

  const from = `
    FROM ${tR} r
    LEFT JOIN ${tV} v  ON v.id = r.venta_id
    LEFT JOIN ${tF} f  ON f.id = v.factura_id
    LEFT JOIN ${tC} cl ON cl.id = r.cliente_id
   WHERE ${cond.join(" AND ")}`;

  const limit = Math.min(Math.max(Number(f.limit) || 200, 1), 500);
  const offset = Math.max(Number(f.offset) || 0, 0);

  const client = await pool().connect();
  try {
    const totalQ = await client.query(`SELECT count(*)::int AS n ${from}`, vals);

    const rowsQ = await client.query(
      `SELECT r.id, r.numero, r.estado, r.fecha, r.observacion, r.anulada_motivo,
              r.usuario_creador_nombre, r.venta_id, v.factura_id AS factura_id,
              v.numero_control            AS venta_numero,
              f.numero_factura            AS factura_numero,
              NULL::text                  AS factura_autoimpresor,
              v.numero_orden_compra       AS numero_orden_compra,
              COALESCE(r.cliente_nombre, cl.empresa, cl.nombre_contacto, cl.nombre) AS cliente_nombre,
              (SELECT count(*)::int FROM ${tRI} i WHERE i.nota_remision_id = r.id) AS total_items,
              (SELECT COALESCE(SUM(i.cantidad),0)::numeric FROM ${tRI} i WHERE i.nota_remision_id = r.id) AS total_cantidad,
              -- Pendiente = lo que le falta entregar al cliente de la venta.
              (SELECT COALESCE(SUM(vi.cantidad - vi.cantidad_entregada), 0)::numeric
                 FROM ${tVI} vi WHERE vi.venta_id = r.venta_id) AS pendiente_entrega
         ${from}
        ORDER BY r.fecha DESC, r.numero DESC
        LIMIT ${limit} OFFSET ${offset}`,
      vals,
    );

    const rows: RemisionListadoRow[] = rowsQ.rows.map((r) => ({
      id: String(r.id),
      numero: String(r.numero),
      estado: String(r.estado),
      fecha: String(r.fecha),
      observacion: (r.observacion as string) ?? null,
      anulada_motivo: (r.anulada_motivo as string) ?? null,
      usuario_creador_nombre: (r.usuario_creador_nombre as string) ?? null,
      venta_id: (r.venta_id as string) ?? null,
      factura_id: (r.factura_id as string) ?? null,
      venta_numero: (r.venta_numero as string) ?? null,
      factura_numero: (r.factura_numero as string) ?? null,
      factura_autoimpresor: (r.factura_autoimpresor as string) ?? null,
      numero_orden_compra: (r.numero_orden_compra as string) ?? null,
      cliente_nombre: (r.cliente_nombre as string) ?? null,
      total_items: Number(r.total_items) || 0,
      total_cantidad: Number(r.total_cantidad) || 0,
      pendiente_entrega: Math.max(0, Number(r.pendiente_entrega) || 0),
    }));

    return { rows, total: Number(totalQ.rows[0].n) || 0 };
  } finally {
    client.release();
  }
}
