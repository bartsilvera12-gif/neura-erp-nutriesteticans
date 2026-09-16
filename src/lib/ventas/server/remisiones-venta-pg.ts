/**
 * Notas de remisión sobre VENTAS — entregas parciales del flujo POS (heraclio).
 *
 * En heraclio el stock ya salió al registrar la venta; la NR es un registro de
 * ENTREGA (qué se dio, qué queda pendiente). Varias NR por venta. Nunca se
 * puede entregar más de lo vendido. Editar ajusta `ventas_items.cantidad_entregada`
 * por la DIFERENCIA. Anular devuelve lo entregado al pendiente.
 *
 * Numeración: `NR-XXXXXX` (padding 6), calculada inline por empresa. Heraclio
 * NO tiene `siguienteCorrelativoTx` ni `registrarAuditoriaTx` como tec.
 */
import type { PoolClient } from "pg";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/** Se intenta entregar más de lo que queda pendiente de un ítem. */
export class RemisionVentaExcedenteError extends Error {
  producto: string;
  disponible: number;
  intentado: number;
  constructor(producto: string, disponible: number, intentado: number) {
    super(`No se puede remitir ${intentado} de "${producto}": quedan ${disponible} por entregar.`);
    this.name = "RemisionVentaExcedenteError";
    this.producto = producto;
    this.disponible = disponible;
    this.intentado = intentado;
  }
}

export interface LineaEntregaVenta {
  venta_item_id: string;
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad_vendida: number;
  cantidad_entregada: number;
  pendiente: number;
}

export interface ResumenVentaEntrega {
  venta_id: string;
  numero_control: string;
  estado_entrega: string;
  cliente_nombre: string | null;
  numero_orden_compra: string | null;
  factura_numero: string | null;
  factura_cdc: string | null;
  factura_estado_sifen: string | null;
  lineas: LineaEntregaVenta[];
}

export interface Usuario {
  id?: string | null;
  nombre?: string | null;
  email?: string | null;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function proximoNumeroNR(client: PoolClient, schema: string, empresaId: string): Promise<string> {
  const tR = quoteSchemaTable(schema, "notas_remision");
  const q = await client.query(
    `SELECT numero FROM ${tR} WHERE empresa_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
    [empresaId],
  );
  let next = 1;
  const last = q.rows[0]?.numero as string | undefined;
  if (last) {
    const m = String(last).match(/(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `NR-${String(next).padStart(6, "0")}`;
}

async function recomputarEstadoEntregaVenta(
  client: PoolClient,
  schema: string,
  empresaId: string,
  ventaId: string,
) {
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const agg = await client.query(
    `SELECT COALESCE(SUM(cantidad),0)::numeric AS vend, COALESCE(SUM(cantidad_entregada),0)::numeric AS entr
       FROM ${tVI} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid`,
    [ventaId, empresaId],
  );
  const vend = num(agg.rows[0].vend);
  const entr = num(agg.rows[0].entr);
  const estado = entr <= 0 ? "pendiente" : entr >= vend ? "entregada" : "parcialmente_entregada";
  await client.query(
    `UPDATE ${tV} SET estado_entrega = $1, updated_at = now() WHERE id = $2::uuid AND empresa_id = $3::uuid`,
    [estado, ventaId, empresaId],
  );
}

export async function getResumenVentaEntrega(
  schema: string,
  empresaId: string,
  ventaId: string,
): Promise<ResumenVentaEntrega | null> {
  assertAllowedChatDataSchema(schema);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tC = quoteSchemaTable(schema, "clientes");
  const tF = quoteSchemaTable(schema, "facturas");
  const tFE = quoteSchemaTable(schema, "factura_electronica");
  const client = await pool().connect();
  try {
    const v = await client.query(
      `SELECT v.id, v.numero_control, v.estado_entrega, v.numero_orden_compra,
              COALESCE(c.empresa, c.nombre_contacto, c.nombre) AS cliente_nombre,
              f.numero_factura AS factura_numero,
              fe.cdc          AS factura_cdc,
              fe.estado_sifen AS factura_estado_sifen
         FROM ${tV} v
         LEFT JOIN ${tC} c  ON c.id = v.cliente_id
         LEFT JOIN ${tF} f  ON f.origen_venta_id = v.id
         LEFT JOIN ${tFE} fe ON fe.factura_id = f.id
        WHERE v.id = $1::uuid AND v.empresa_id = $2::uuid`,
      [ventaId, empresaId],
    );
    if (v.rowCount === 0) return null;

    const items = await client.query(
      `SELECT id, producto_id, producto_nombre, sku,
              COALESCE(cantidad,0)::numeric AS cantidad,
              COALESCE(cantidad_entregada,0)::numeric AS cantidad_entregada
         FROM ${tVI}
        WHERE venta_id = $1::uuid AND empresa_id = $2::uuid
        ORDER BY created_at`,
      [ventaId, empresaId],
    );

    const lineas: LineaEntregaVenta[] = items.rows.map((r) => {
      const vendida = num(r.cantidad);
      const entregada = num(r.cantidad_entregada);
      return {
        venta_item_id: r.id as string,
        producto_id: (r.producto_id as string) ?? null,
        producto_nombre: (r.producto_nombre as string) ?? "",
        sku: (r.sku as string) ?? null,
        cantidad_vendida: vendida,
        cantidad_entregada: entregada,
        pendiente: Math.max(0, vendida - entregada),
      };
    });

    return {
      venta_id: ventaId,
      numero_control: v.rows[0].numero_control as string,
      estado_entrega: v.rows[0].estado_entrega as string,
      cliente_nombre: (v.rows[0].cliente_nombre as string) ?? null,
      numero_orden_compra: (v.rows[0].numero_orden_compra as string) ?? null,
      factura_numero: (v.rows[0].factura_numero as string) ?? null,
      factura_cdc: (v.rows[0].factura_cdc as string) ?? null,
      factura_estado_sifen: (v.rows[0].factura_estado_sifen as string) ?? null,
      lineas,
    };
  } finally {
    client.release();
  }
}

export interface RemisionVentaItemInput {
  venta_item_id: string;
  cantidad: number;
  observacion?: string | null;
}

export interface CrearRemisionVentaInput {
  venta_id: string;
  observacion?: string | null;
  fecha?: string | null;
  items: RemisionVentaItemInput[];
}

function fechaValida(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const soloFecha = s.length === 10 && s[4] === "-" && s[7] === "-";
  const d = new Date(soloFecha ? s + "T12:00:00" : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function aplicarEntregaTx(
  client: PoolClient,
  schema: string,
  empresaId: string,
  items: Array<{ venta_item_id: string | null; cantidad: number; producto_nombre: string }>,
  signo: 1 | -1,
) {
  const tVI = quoteSchemaTable(schema, "ventas_items");
  for (const it of items) {
    if (!it.venta_item_id) continue;
    const delta = num(it.cantidad) * signo;
    if (delta === 0) continue;

    const fi = await client.query(
      `SELECT COALESCE(cantidad,0)::numeric AS cant, COALESCE(cantidad_entregada,0)::numeric AS entr
         FROM ${tVI} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [it.venta_item_id, empresaId],
    );
    if ((fi.rowCount ?? 0) === 0) continue;

    const vendida = num(fi.rows[0].cant);
    const entregada = num(fi.rows[0].entr);
    const nueva = entregada + delta;
    if (nueva > vendida) {
      throw new RemisionVentaExcedenteError(it.producto_nombre, Math.max(0, vendida - entregada), num(it.cantidad));
    }
    await client.query(
      `UPDATE ${tVI} SET cantidad_entregada = $1::numeric WHERE id = $2::uuid`,
      [Math.max(0, nueva), it.venta_item_id],
    );
  }
}

export async function crearRemisionVenta(
  schema: string,
  empresaId: string,
  input: CrearRemisionVentaInput,
  usuario: Usuario,
): Promise<{ remision_id: string; numero: string }> {
  assertAllowedChatDataSchema(schema);
  const tR = quoteSchemaTable(schema, "notas_remision");
  const tRI = quoteSchemaTable(schema, "notas_remision_items");
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");

  const conCantidad = (input.items ?? []).filter((i) => num(i.cantidad) > 0);
  if (conCantidad.length === 0) throw new Error("Indicá al menos una cantidad a entregar.");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    const tCli = quoteSchemaTable(schema, "clientes");
    const v = await client.query(
      `SELECT v.cliente_id, COALESCE(c.empresa, c.nombre_contacto, c.nombre) AS cliente_nombre
         FROM ${tV} v LEFT JOIN ${tCli} c ON c.id = v.cliente_id
        WHERE v.id = $1::uuid AND v.empresa_id = $2::uuid FOR UPDATE OF v`,
      [input.venta_id, empresaId],
    );
    if (v.rowCount === 0) throw new Error("Venta no encontrada.");

    const ids = conCantidad.map((i) => i.venta_item_id);
    const vi = await client.query(
      `SELECT id, producto_id, producto_nombre, sku FROM ${tVI}
        WHERE venta_id = $1::uuid AND empresa_id = $2::uuid AND id = ANY($3::uuid[])`,
      [input.venta_id, empresaId, ids],
    );
    const porId = new Map<string, Record<string, unknown>>();
    for (const r of vi.rows) porId.set(String(r.id), r);

    const numero = await proximoNumeroNR(client, schema, empresaId);

    const rem = await client.query(
      `INSERT INTO ${tR} (
         empresa_id, numero, venta_id, cliente_id, cliente_nombre, observacion, estado, fecha,
         usuario_creador_id, usuario_creador_nombre, confirmada_at,
         usuario_confirmador_id, usuario_confirmador_nombre
       ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $9, $5, 'confirmada', COALESCE($8::timestamptz, now()),
                 $6::uuid, $7, now(), $6::uuid, $7)
       RETURNING id`,
      [
        empresaId,
        numero,
        input.venta_id,
        v.rows[0].cliente_id ?? null,
        input.observacion ?? null,
        usuario.id ?? null,
        usuario.nombre ?? null,
        fechaValida(input.fecha),
        v.rows[0].cliente_nombre ?? null,
      ],
    );
    const remisionId = rem.rows[0].id as string;

    const paraAplicar: Array<{ venta_item_id: string | null; cantidad: number; producto_nombre: string }> = [];
    for (const it of conCantidad) {
      const base = porId.get(it.venta_item_id);
      if (!base) throw new Error("Un ítem indicado no pertenece a esta venta.");
      await client.query(
        `INSERT INTO ${tRI} (empresa_id, nota_remision_id, venta_item_id, producto_id, producto_nombre, sku, cantidad, costo_unitario, observacion)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::numeric, 0, $8)`,
        [
          empresaId,
          remisionId,
          it.venta_item_id,
          base.producto_id ?? null,
          base.producto_nombre ?? null,
          base.sku ?? null,
          num(it.cantidad),
          it.observacion ?? null,
        ],
      );
      paraAplicar.push({
        venta_item_id: it.venta_item_id,
        cantidad: num(it.cantidad),
        producto_nombre: String(base.producto_nombre ?? ""),
      });
    }

    await aplicarEntregaTx(client, schema, empresaId, paraAplicar, 1);
    await recomputarEstadoEntregaVenta(client, schema, empresaId, input.venta_id);

    await client.query("COMMIT");
    return { remision_id: remisionId, numero };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function editarRemisionVenta(
  schema: string,
  empresaId: string,
  remisionId: string,
  items: RemisionVentaItemInput[],
  observacion: string | null | undefined,
  usuario: Usuario,
  fecha?: string | null,
  destinatario?: string | null,
): Promise<void> {
  assertAllowedChatDataSchema(schema);
  void usuario;
  const tR = quoteSchemaTable(schema, "notas_remision");
  const tRI = quoteSchemaTable(schema, "notas_remision_items");
  const tVI = quoteSchemaTable(schema, "ventas_items");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    const rem = await client.query(
      `SELECT id, venta_id, estado FROM ${tR} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [remisionId, empresaId],
    );
    if (rem.rowCount === 0) throw new Error("Remisión no encontrada.");
    const ventaId = rem.rows[0].venta_id as string | null;
    if (!ventaId) throw new Error("Esta remisión no pertenece a una venta.");
    if (rem.rows[0].estado === "anulada") throw new Error("La remisión está anulada; no se puede editar.");

    const previos = await client.query(
      `SELECT venta_item_id, cantidad, producto_nombre FROM ${tRI} WHERE nota_remision_id = $1::uuid`,
      [remisionId],
    );
    await aplicarEntregaTx(
      client,
      schema,
      empresaId,
      previos.rows.map((r) => ({
        venta_item_id: (r.venta_item_id as string) ?? null,
        cantidad: num(r.cantidad),
        producto_nombre: String(r.producto_nombre ?? ""),
      })),
      -1,
    );
    await client.query(`DELETE FROM ${tRI} WHERE nota_remision_id = $1::uuid`, [remisionId]);

    const conCantidad = (items ?? []).filter((i) => num(i.cantidad) > 0);
    const ids = conCantidad.map((i) => i.venta_item_id);
    const vi = ids.length
      ? await client.query(
          `SELECT id, producto_id, producto_nombre, sku FROM ${tVI}
            WHERE venta_id = $1::uuid AND empresa_id = $2::uuid AND id = ANY($3::uuid[])`,
          [ventaId, empresaId, ids],
        )
      : { rows: [] as Record<string, unknown>[] };
    const porId = new Map<string, Record<string, unknown>>();
    for (const r of vi.rows) porId.set(String(r.id), r);

    const paraAplicar: Array<{ venta_item_id: string | null; cantidad: number; producto_nombre: string }> = [];
    for (const it of conCantidad) {
      const base = porId.get(it.venta_item_id);
      if (!base) throw new Error("Un ítem indicado no pertenece a esta venta.");
      await client.query(
        `INSERT INTO ${tRI} (empresa_id, nota_remision_id, venta_item_id, producto_id, producto_nombre, sku, cantidad, costo_unitario, observacion)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::numeric, 0, $8)`,
        [
          empresaId,
          remisionId,
          it.venta_item_id,
          base.producto_id ?? null,
          base.producto_nombre ?? null,
          base.sku ?? null,
          num(it.cantidad),
          it.observacion ?? null,
        ],
      );
      paraAplicar.push({
        venta_item_id: it.venta_item_id,
        cantidad: num(it.cantidad),
        producto_nombre: String(base.producto_nombre ?? ""),
      });
    }
    await aplicarEntregaTx(client, schema, empresaId, paraAplicar, 1);

    if (observacion !== undefined) {
      await client.query(`UPDATE ${tR} SET observacion = $1, updated_at = now() WHERE id = $2::uuid`, [
        observacion ?? null,
        remisionId,
      ]);
    }
    if (destinatario !== undefined) {
      const d = String(destinatario ?? "").trim();
      await client.query(`UPDATE ${tR} SET cliente_nombre = $1, updated_at = now() WHERE id = $2::uuid`, [
        d || null,
        remisionId,
      ]);
    }
    const fechaIso = fechaValida(fecha);
    if (fechaIso) {
      await client.query(`UPDATE ${tR} SET fecha = $1::timestamptz, updated_at = now() WHERE id = $2::uuid`, [
        fechaIso,
        remisionId,
      ]);
    }

    await recomputarEstadoEntregaVenta(client, schema, empresaId, ventaId);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function anularRemisionVenta(
  schema: string,
  empresaId: string,
  remisionId: string,
  motivo: string | null,
  usuario: Usuario,
): Promise<void> {
  assertAllowedChatDataSchema(schema);
  const tR = quoteSchemaTable(schema, "notas_remision");
  const tRI = quoteSchemaTable(schema, "notas_remision_items");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const rem = await client.query(
      `SELECT id, venta_id, estado FROM ${tR} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [remisionId, empresaId],
    );
    if (rem.rowCount === 0) throw new Error("Remisión no encontrada.");
    if (rem.rows[0].estado === "anulada") {
      await client.query("COMMIT");
      return;
    }
    const ventaId = rem.rows[0].venta_id as string | null;
    if (!ventaId) throw new Error("Esta remisión no pertenece a una venta.");

    const previos = await client.query(
      `SELECT venta_item_id, cantidad, producto_nombre FROM ${tRI} WHERE nota_remision_id = $1::uuid`,
      [remisionId],
    );
    await aplicarEntregaTx(
      client,
      schema,
      empresaId,
      previos.rows.map((r) => ({
        venta_item_id: (r.venta_item_id as string) ?? null,
        cantidad: num(r.cantidad),
        producto_nombre: String(r.producto_nombre ?? ""),
      })),
      -1,
    );

    await client.query(
      `UPDATE ${tR} SET estado = 'anulada', anulada_at = now(), anulada_por = $2::uuid, anulada_motivo = $3, updated_at = now()
        WHERE id = $1::uuid`,
      [remisionId, usuario.id ?? null, motivo ?? null],
    );

    await recomputarEstadoEntregaVenta(client, schema, empresaId, ventaId);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function listarRemisionesVenta(schema: string, empresaId: string, ventaId: string) {
  assertAllowedChatDataSchema(schema);
  const tR = quoteSchemaTable(schema, "notas_remision");
  const tRI = quoteSchemaTable(schema, "notas_remision_items");
  const client = await pool().connect();
  try {
    const r = await client.query(
      `SELECT r.id, r.numero, r.estado, r.fecha, r.observacion,
              COALESCE((SELECT count(*) FROM ${tRI} i WHERE i.nota_remision_id = r.id), 0)::int AS total_items
         FROM ${tR} r
        WHERE r.venta_id = $1::uuid AND r.empresa_id = $2::uuid
        ORDER BY r.fecha DESC`,
      [ventaId, empresaId],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

export async function getRemisionVentaParaEdicion(schema: string, empresaId: string, remisionId: string) {
  assertAllowedChatDataSchema(schema);
  const tR = quoteSchemaTable(schema, "notas_remision");
  const tRI = quoteSchemaTable(schema, "notas_remision_items");
  const client = await pool().connect();
  try {
    const remQ = await client.query(
      `SELECT * FROM ${tR} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [remisionId, empresaId],
    );
    if (remQ.rowCount === 0) return null;
    const rem = remQ.rows[0];
    if (!rem.venta_id) return null;

    const itemsQ = await client.query(
      `SELECT venta_item_id, cantidad, observacion FROM ${tRI} WHERE nota_remision_id = $1::uuid`,
      [remisionId],
    );
    const enEsta = new Map<string, { cantidad: number; observacion: string | null }>();
    for (const it of itemsQ.rows) {
      if (it.venta_item_id) {
        enEsta.set(String(it.venta_item_id), {
          cantidad: num(it.cantidad),
          observacion: (it.observacion as string) ?? null,
        });
      }
    }

    const resumen = await getResumenVentaEntrega(schema, empresaId, String(rem.venta_id));
    if (!resumen) return null;

    const anulada = rem.estado === "anulada";
    const lineas = resumen.lineas.map((l) => {
      const e = enEsta.get(l.venta_item_id);
      const enEstaCant = e?.cantidad ?? 0;
      const entregadoOtras = anulada ? l.cantidad_entregada : Math.max(0, l.cantidad_entregada - enEstaCant);
      return {
        ...l,
        en_esta_remision: enEstaCant,
        entregado_otras: entregadoOtras,
        max_a_entregar: Math.max(0, l.cantidad_vendida - entregadoOtras),
        observacion: e?.observacion ?? null,
      };
    });

    return {
      remision: {
        id: rem.id as string,
        numero: rem.numero as string,
        estado: rem.estado as string,
        fecha: rem.fecha,
        venta_id: String(rem.venta_id),
        numero_control: resumen.numero_control,
        numero_orden_compra: resumen.numero_orden_compra,
        factura_numero: resumen.factura_numero,
        factura_cdc: resumen.factura_cdc,
        factura_estado_sifen: resumen.factura_estado_sifen,
        cliente_nombre: rem.cliente_nombre ?? resumen.cliente_nombre ?? null,
        observacion: (rem.observacion as string) ?? null,
        usuario_creador_nombre: (rem.usuario_creador_nombre as string) ?? null,
        anulada_motivo: (rem.anulada_motivo as string) ?? null,
      },
      lineas,
    };
  } finally {
    client.release();
  }
}
