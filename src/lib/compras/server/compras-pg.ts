/**
 * PG directo para Compras. Mismo patron que productos-pg / proveedores-pg:
 * pool singleton + queries parametrizadas + identifier escape.
 *
 * insertCompra realiza la operacion en transaccion:
 *   1) inserta compra con numero_control generado por secuencia local
 *   2) inserta movimiento ENTRADA (origen=compra) con audit
 *   3) actualiza producto.precio_venta + costo_promedio + stock_actual
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

/**
 * Upsert best-effort de la relación producto↔proveedor en `proveedor_productos`.
 * - Actualiza `costo_habitual` con el último costo_unitario de la compra.
 * - Marca `es_principal=true` SOLO si el producto aún no tiene un proveedor
 *   principal (respeta el índice parcial único un_principal).
 * - NUNCA toca `marca` (se preserva el valor existente; null si es nueva fila).
 * Se ejecuta dentro de un SAVEPOINT: si falla, no aborta la compra.
 */
async function upsertProveedorProducto(
  client: import("pg").PoolClient,
  tPP: string,
  empresaId: string,
  productoId: string,
  proveedorId: string,
  costoHabitual: number
): Promise<void> {
  if (!proveedorId) return; // sin proveedor no hay relación que mantener
  try {
    await client.query("SAVEPOINT sp_pp");
    await client.query(
      `INSERT INTO ${tPP} (empresa_id, producto_id, proveedor_id, costo_habitual, es_principal, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric,
               NOT EXISTS (SELECT 1 FROM ${tPP} pp
                            WHERE pp.empresa_id = $1::uuid AND pp.producto_id = $2::uuid AND pp.es_principal),
               now())
       ON CONFLICT (empresa_id, producto_id, proveedor_id)
       DO UPDATE SET costo_habitual = EXCLUDED.costo_habitual, updated_at = now()`,
      [empresaId, productoId, proveedorId, costoHabitual]
    );
    await client.query("RELEASE SAVEPOINT sp_pp");
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT sp_pp").catch(() => null);
    console.error("[compras-pg] upsert proveedor_productos fallo (best-effort)", {
      empresaId, productoId, proveedorId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export interface CompraRow {
  id: string;
  empresa_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  /** Solo lo devuelve listCompras (via JOIN); en insert es undefined. */
  unidad_medida?: string | null;
  cantidad: string | number;
  moneda: string;
  tipo_cambio: string | number;
  costo_unitario_original: string | number;
  costo_unitario: string | number;
  iva_tipo: string;
  subtotal: string | number;
  monto_iva: string | number;
  total: string | number;
  precio_venta: string | number;
  margen_venta: string | number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  numero_factura: string | null;
  fecha_factura: string | null;
  observacion: string | null;
  orden_compra_numero: string | null;
  orden_compra_item_id: string | null;
  numero_control: string;
  estado: string;
  fecha: string;
  comprobante_url: string | null;
  comprobante_storage_path: string | null;
  comprobante_nombre: string | null;
  comprobante_mime_type: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

const COLS = `
  id, empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
  cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
  iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
  tipo_pago, plazo_dias, nro_timbrado, numero_factura, fecha_factura, observacion,
  orden_compra_numero, orden_compra_item_id,
  numero_control, estado, fecha,
  comprobante_url, comprobante_storage_path, comprobante_nombre, comprobante_mime_type,
  created_at, updated_at, created_by, usuario_nombre
`;

export interface InsertCompraInput {
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  moneda: string;
  tipo_cambio: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

export async function listCompras(
  schemaRaw: string,
  empresaId: string
): Promise<CompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "compras");
  const tProd = quoteSchemaTable(schema, "productos");
  // JOIN a productos para traer la unidad de medida: la usa la edición de
  // compra para saber si la cantidad admite decimales. La compra no la guarda.
  const { rows } = await pool().query<CompraRow>(
    `SELECT ${COLS.split(",").map((c) => `c.${c.trim()}`).join(", ")}, p.unidad_medida AS unidad_medida
       FROM ${t} c
       LEFT JOIN ${tProd} p ON p.id = c.producto_id
      WHERE c.empresa_id = $1::uuid ORDER BY c.fecha DESC LIMIT 500`,
    [empresaId]
  );
  return rows;
}

/** Genera proximo COMP-XXXXXX leyendo el maximo existente. */
async function nextNumeroControl(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string
): Promise<string> {
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await client.query<{ maxn: number | null }>(
    `SELECT COALESCE(MAX(
       CASE WHEN numero_control ~ '^COMP-[0-9]+$'
            THEN (substring(numero_control from 6))::int
            ELSE 0 END
     ), 0) AS maxn
     FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const next = Number(rows[0]?.maxn ?? 0) + 1;
  return `COMP-${String(next).padStart(6, "0")}`;
}

export interface CompraResult {
  compra: CompraRow;
  movimiento_id: string | null;
  movimiento_warning: string | null;
}

/** Cabecera compartida por todas las líneas de una compra multiproducto. */
export interface CompraHeaderInput {
  proveedor_id: string;
  proveedor_nombre: string;
  moneda: string;
  tipo_cambio: number;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  numero_factura: string | null;
  /** Fecha de la factura del proveedor (YYYY-MM-DD). Distinta de `fecha` (registro). */
  fecha_factura?: string | null;
  observacion?: string | null;
  orden_compra_numero: string | null;
  comprobante_url: string | null;
  comprobante_storage_path: string | null;
  comprobante_nombre: string | null;
  comprobante_mime_type: string | null;
  created_by: string | null;
  usuario_nombre: string | null;
}

/** Una línea (producto) de la compra. */
export interface CompraItemInput {
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
  /** Línea exacta de ordenes_compra que esta fila recibe (recepción de OC). */
  orden_compra_item_id?: string | null;
}

export interface ComprasMultiResult {
  numero_control: string;
  compras: CompraRow[];
  movimiento_warning: string | null;
}

/**
 * Núcleo de "insertar compra multiproducto" reutilizable DENTRO de una
 * transacción ya abierta por el caller (ej. confirmarRecepcionOrdenCompra, que
 * necesita lockear filas de ordenes_compra + insertar la compra + actualizar
 * la OC como una sola operación atómica). NO abre ni cierra transacción.
 */
export async function insertComprasConImpactoTx(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string,
  header: CompraHeaderInput,
  items: CompraItemInput[]
): Promise<ComprasMultiResult> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La compra no tiene productos.");
  }
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tPP = quoteSchemaTable(schema, "proveedor_productos");

  const insertedRows: CompraRow[] = [];
  const warnings: string[] = [];
  const numero = await nextNumeroControl(client, schema, empresaId);

  for (const it of items) {
    const { rows: compraRows } = await client.query<CompraRow>(
      `INSERT INTO ${tC} (
         empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
         cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
         iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
         tipo_pago, plazo_dias, nro_timbrado, numero_factura, fecha_factura, observacion,
         orden_compra_numero, orden_compra_item_id,
         numero_control, estado, fecha,
         comprobante_url, comprobante_storage_path, comprobante_nombre, comprobante_mime_type,
         created_by, usuario_nombre
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, $5,
         $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
         $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
         $17, $18::integer, $19, $20, $21::date, $22,
         $23, $24::uuid,
         $25, 'registrada', now(),
         $26, $27, $28, $29,
         $30::uuid, $31
       )
       RETURNING ${COLS}`,
      [
        empresaId, header.proveedor_id, header.proveedor_nombre,
        it.producto_id, it.producto_nombre,
        it.cantidad, header.moneda, header.tipo_cambio,
        it.costo_unitario_original, it.costo_unitario,
        it.iva_tipo, it.subtotal, it.monto_iva, it.total, it.precio_venta, it.margen_venta,
        header.tipo_pago, header.plazo_dias, header.nro_timbrado,
        header.numero_factura, header.fecha_factura ?? null, header.observacion ?? null,
        header.orden_compra_numero, it.orden_compra_item_id ?? null,
        numero,
        header.comprobante_url, header.comprobante_storage_path,
        header.comprobante_nombre, header.comprobante_mime_type,
        header.created_by, header.usuario_nombre,
      ]
    );
    insertedRows.push(compraRows[0]);

    // Movimiento ENTRADA por línea (best-effort).
    try {
      await client.query(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         )
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                'ENTRADA', $4::numeric, $5::numeric, 'compra', $6, now(),
                $7::uuid, $8
         FROM ${tP} p WHERE p.id = $2::uuid`,
        [empresaId, it.producto_id, it.producto_nombre, it.cantidad,
         it.costo_unitario, numero, header.created_by, header.usuario_nombre]
      );
    } catch (movErr) {
      const msg = movErr instanceof Error ? movErr.message : String(movErr);
      console.error("[compras-pg] movimiento ENTRADA fallo (multi)", {
        schema, empresaId, numero, producto: it.producto_id, message: msg,
      });
      warnings.push(it.producto_nombre);
    }

    // Actualizar producto: stock + costo_promedio siempre.
    // precio_venta SOLO se actualiza si la compra trae un precio > 0 (productos
    // vendibles). Para materia prima / insumos sin precio (0 o vacío) mantenemos
    // el precio actual: nunca lo pisamos con 0 ni con un valor inventado.
    await client.query(
      `UPDATE ${tP}
          SET stock_actual = stock_actual + $1::numeric,
              costo_promedio = $2::numeric,
              precio_venta = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE precio_venta END,
              updated_at = now()
        WHERE id = $4::uuid AND empresa_id = $5::uuid`,
      [it.cantidad, it.costo_unitario, it.precio_venta, it.producto_id, empresaId]
    );

    // Mantener relación producto↔proveedor (costo_habitual). No pisa marca.
    await upsertProveedorProducto(
      client, tPP, empresaId, it.producto_id, header.proveedor_id, it.costo_unitario
    );
  }

  return {
    numero_control: numero,
    compras: insertedRows,
    movimiento_warning: warnings.length
      ? `La compra se guardó pero no se registró el movimiento de entrada para: ${warnings.join(", ")}.`
      : null,
  };
}

/**
 * Compra MULTIPRODUCTO (modelo plano): N filas en `compras` que comparten un
 * único `numero_control`. Una sola transacción; por cada ítem inserta la fila,
 * el movimiento ENTRADA y actualiza stock + costo_promedio + precio_venta del
 * producto. Requiere que `numero_control` NO sea único (índice no-único).
 *
 * La compra simple es el caso N=1; el endpoint envuelve el body viejo en items=[…].
 */
export async function insertComprasConImpacto(
  schemaRaw: string,
  empresaId: string,
  header: CompraHeaderInput,
  items: CompraItemInput[]
): Promise<ComprasMultiResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await insertComprasConImpactoTx(client, schema, empresaId, header, items);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

export async function insertCompraConImpacto(
  schemaRaw: string,
  empresaId: string,
  d: InsertCompraInput
): Promise<CompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tPP = quoteSchemaTable(schema, "proveedor_productos");

  const client = await pool().connect();
  let movimientoId: string | null = null;
  let movimientoWarning: string | null = null;
  try {
    await client.query("BEGIN");

    const numero = await nextNumeroControl(client, schema, empresaId);

    const { rows: compraRows } = await client.query<CompraRow>(
      `INSERT INTO ${tC} (
         empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
         cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
         iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
         tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
         created_by, usuario_nombre
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, $5,
         $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
         $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
         $17, $18::integer, $19, $20, 'registrada', now(),
         $21::uuid, $22
       )
       RETURNING ${COLS}`,
      [
        empresaId,
        d.proveedor_id,
        d.proveedor_nombre,
        d.producto_id,
        d.producto_nombre,
        d.cantidad,
        d.moneda,
        d.tipo_cambio,
        d.costo_unitario_original,
        d.costo_unitario,
        d.iva_tipo,
        d.subtotal,
        d.monto_iva,
        d.total,
        d.precio_venta,
        d.margen_venta,
        d.tipo_pago,
        d.plazo_dias,
        d.nro_timbrado,
        numero,
        d.created_by,
        d.usuario_nombre,
      ]
    );
    const compra = compraRows[0];

    // Movimiento ENTRADA (origen=compra). Best-effort: si falla, la compra
    // queda registrada pero anunciamos warning.
    try {
      const { rows: movRows } = await client.query<{ id: string }>(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         )
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                'ENTRADA', $4::numeric, $5::numeric, 'compra', $6, now(),
                $7::uuid, $8
         FROM ${tP} p WHERE p.id = $2::uuid
         RETURNING id`,
        [
          empresaId,
          d.producto_id,
          d.producto_nombre,
          d.cantidad,
          d.costo_unitario,
          numero,
          d.created_by,
          d.usuario_nombre,
        ]
      );
      movimientoId = movRows[0]?.id ?? null;
    } catch (movErr) {
      const msg = movErr instanceof Error ? movErr.message : String(movErr);
      console.error("[compras-pg] movimiento ENTRADA fallo", {
        schema, empresaId, numero, message: msg,
        code: (movErr as { code?: string })?.code,
        detail: (movErr as { detail?: string })?.detail,
      });
      movimientoWarning =
        "La compra se guardó pero no se pudo registrar el movimiento de entrada en inventario.";
    }

    // Actualizar producto: stock + costo_promedio siempre; precio_venta solo si > 0
    // (no pisamos el precio de insumos / materia prima con 0).
    await client.query(
      `UPDATE ${tP}
          SET stock_actual = stock_actual + $1::numeric,
              costo_promedio = $2::numeric,
              precio_venta = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE precio_venta END,
              updated_at = now()
        WHERE id = $4::uuid AND empresa_id = $5::uuid`,
      [d.cantidad, d.costo_unitario, d.precio_venta, d.producto_id, empresaId]
    );

    // Mantener relación producto↔proveedor (costo_habitual). No pisa marca.
    await upsertProveedorProducto(
      client, tPP, empresaId, d.producto_id, d.proveedor_id, d.costo_unitario
    );

    await client.query("COMMIT");
    return { compra, movimiento_id: movimientoId, movimiento_warning: movimientoWarning };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

// ── Edición de compra ────────────────────────────────────────────────────────

export interface EditarCompraLinea {
  /** Presente = línea existente a modificar. Ausente/null = línea nueva. */
  id?: string | null;
  /** Requeridos si la línea es nueva. */
  producto_id?: string;
  producto_nombre?: string;
  cantidad: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
}

export interface EditarCompraHeader {
  numero_factura: string | null;
  nro_timbrado: string | null;
  fecha_factura: string | null;
  observacion: string | null;
  /** Si viene, se reemplaza el comprobante (imagen/PDF) de toda la compra. */
  comprobante_storage_path?: string | null;
  comprobante_nombre?: string | null;
  comprobante_mime_type?: string | null;
}

export interface EditarCompraResult {
  numero_control: string;
  lineas_actualizadas: number;
  lineas_agregadas: number;
  lineas_eliminadas: number;
  movimientos_generados: number;
  unidades_ajustadas: number;
}

/**
 * Corrige una compra ya registrada SIN reescribir la historia: por cada línea
 * cuya cantidad cambia, aplica la diferencia al stock y deja un movimiento
 * NUEVO con origen 'edicion_compra' (el movimiento de la compra original queda
 * intacto). Los datos de la factura (número, timbrado, fecha, observación) se
 * actualizan en todas las filas del `numero_control`.
 *
 * Bloquea compras derivadas de una orden de compra: editar esas descuadraría
 * la cantidad recibida de la OC.
 */
export async function editarCompraConMovimiento(
  schemaRaw: string,
  empresaId: string,
  numeroControl: string,
  header: EditarCompraHeader,
  lineas: EditarCompraLinea[],
  eliminar: string[],
  usuario: { id: string | null; nombre: string | null }
): Promise<EditarCompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const ref = `Edición de compra ${numeroControl}`;

  const client = await pool().connect();

  /** Ajuste de stock + movimiento 'edicion_compra' por un delta (±). */
  async function ajustar(productoId: string, productoNombre: string, delta: number, costo: number) {
    if (delta === 0) return;
    await client.query(
      `UPDATE ${tP} SET stock_actual = stock_actual + $1::numeric, updated_at = now()
        WHERE id = $2::uuid AND empresa_id = $3::uuid`,
      [delta, productoId, empresaId]
    );
    await client.query(
      `INSERT INTO ${tM} (
         empresa_id, producto_id, producto_nombre, producto_sku,
         tipo, cantidad, costo_unitario, origen, referencia, fecha, created_by, usuario_nombre
       )
       SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
              $4, $5::numeric, $6::numeric, 'edicion_compra', $7, now(), $8::uuid, $9
       FROM ${tP} p WHERE p.id = $2::uuid`,
      [empresaId, productoId, productoNombre, delta > 0 ? "ENTRADA" : "SALIDA",
       Math.abs(delta), costo, ref, usuario.id, usuario.nombre]
    );
  }

  try {
    await client.query("BEGIN");

    const { rows: actuales } = await client.query<CompraRow>(
      `SELECT ${COLS} FROM ${tC}
        WHERE empresa_id = $1::uuid AND numero_control = $2 FOR UPDATE`,
      [empresaId, numeroControl]
    );
    if (actuales.length === 0) throw new Error("Compra no encontrada.");
    if (actuales.some((r) => r.orden_compra_numero)) {
      throw new Error("Esta compra proviene de una orden de compra y no se puede editar acá. Ajustá la orden de compra.");
    }

    const cab = actuales[0]; // cabecera compartida (proveedor, moneda, etc.)
    const porId = new Map(actuales.map((r) => [r.id, r]));
    let movimientos = 0, unidades = 0, modificadas = 0, agregadas = 0, eliminadas = 0;

    // No permitir vaciar la compra por completo.
    const quedan = actuales.length - eliminar.length + lineas.filter((l) => !l.id).length;
    if (quedan <= 0) throw new Error("La compra debe tener al menos un producto.");

    // ── 1) Eliminar líneas: revierte su stock y borra la fila ──
    for (const id of eliminar) {
      const actual = porId.get(id);
      if (!actual) continue;
      const cant = Number(actual.cantidad) || 0;
      await ajustar(actual.producto_id, actual.producto_nombre, -cant, Number(actual.costo_unitario) || 0);
      if (cant !== 0) { movimientos++; unidades += cant; }
      await client.query(`DELETE FROM ${tC} WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
      eliminadas++;
    }

    // ── 2) Líneas existentes (modificar) y nuevas (agregar) ──
    for (const l of lineas) {
      if (l.id && porId.has(l.id)) {
        // Modificar
        const actual = porId.get(l.id)!;
        const delta = Math.round(((Number(l.cantidad) || 0) - (Number(actual.cantidad) || 0)) * 1e6) / 1e6;
        await client.query(
          `UPDATE ${tC} SET
             cantidad = $1::numeric, costo_unitario_original = $2::numeric,
             costo_unitario = $3::numeric, iva_tipo = $4,
             subtotal = $5::numeric, monto_iva = $6::numeric, total = $7::numeric,
             precio_venta = $8::numeric, margen_venta = $9::numeric, updated_at = now()
           WHERE id = $10::uuid AND empresa_id = $11::uuid`,
          [l.cantidad, l.costo_unitario_original, l.costo_unitario, l.iva_tipo,
           l.subtotal, l.monto_iva, l.total, l.precio_venta, l.margen_venta, l.id, empresaId]
        );
        if (delta !== 0) { await ajustar(actual.producto_id, actual.producto_nombre, delta, l.costo_unitario); movimientos++; unidades += Math.abs(delta); }
        await client.query(
          `UPDATE ${tP} SET costo_promedio = $1::numeric,
             precio_venta = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE precio_venta END,
             updated_at = now() WHERE id = $3::uuid AND empresa_id = $4::uuid`,
          [l.costo_unitario, l.precio_venta, actual.producto_id, empresaId]
        );
        modificadas++;
      } else if (!l.id && l.producto_id) {
        // Agregar: nueva fila con la cabecera compartida de la compra.
        await client.query(
          `INSERT INTO ${tC} (
             empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
             cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
             iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
             tipo_pago, plazo_dias, nro_timbrado, numero_factura, fecha_factura, observacion,
             numero_control, estado, fecha, created_by, usuario_nombre
           ) VALUES (
             $1::uuid,$2::uuid,$3,$4::uuid,$5,
             $6::numeric,$7,$8::numeric,$9::numeric,$10::numeric,
             $11,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::numeric,
             $17,$18::integer,$19,$20,$21::date,$22,
             $23,'registrada',now(),$24::uuid,$25
           )`,
          [empresaId, cab.proveedor_id, cab.proveedor_nombre, l.producto_id, l.producto_nombre ?? "",
           l.cantidad, cab.moneda, cab.tipo_cambio, l.costo_unitario_original, l.costo_unitario,
           l.iva_tipo, l.subtotal, l.monto_iva, l.total, l.precio_venta, l.margen_venta,
           cab.tipo_pago, cab.plazo_dias, header.nro_timbrado, header.numero_factura, header.fecha_factura, header.observacion,
           numeroControl, usuario.id, usuario.nombre]
        );
        await ajustar(l.producto_id, l.producto_nombre ?? "", Number(l.cantidad) || 0, l.costo_unitario);
        if ((Number(l.cantidad) || 0) !== 0) { movimientos++; unidades += Number(l.cantidad) || 0; }
        await client.query(
          `UPDATE ${tP} SET costo_promedio = $1::numeric,
             precio_venta = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE precio_venta END,
             updated_at = now() WHERE id = $3::uuid AND empresa_id = $4::uuid`,
          [l.costo_unitario, l.precio_venta, l.producto_id, empresaId]
        );
        agregadas++;
      }
    }

    // ── 3) Datos de factura en todas las filas que quedaron ──
    await client.query(
      `UPDATE ${tC} SET numero_factura = $1, nro_timbrado = $2, fecha_factura = $3::date,
         observacion = $4, updated_at = now()
       WHERE empresa_id = $5::uuid AND numero_control = $6`,
      [header.numero_factura, header.nro_timbrado, header.fecha_factura, header.observacion, empresaId, numeroControl]
    );

    // Comprobante nuevo (imagen/PDF): reemplaza el de toda la compra.
    if (header.comprobante_storage_path) {
      await client.query(
        `UPDATE ${tC} SET comprobante_storage_path = $1, comprobante_nombre = $2,
           comprobante_mime_type = $3, updated_at = now()
         WHERE empresa_id = $4::uuid AND numero_control = $5`,
        [header.comprobante_storage_path, header.comprobante_nombre ?? null,
         header.comprobante_mime_type ?? null, empresaId, numeroControl]
      );
    }

    await client.query("COMMIT");
    return {
      numero_control: numeroControl,
      lineas_actualizadas: modificadas,
      lineas_agregadas: agregadas,
      lineas_eliminadas: eliminadas,
      movimientos_generados: movimientos,
      unidades_ajustadas: unidades,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
