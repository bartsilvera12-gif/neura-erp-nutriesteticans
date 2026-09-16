/**
 * Numeración correlativa server-side genérica (Fase 0).
 *
 * Generaliza el patrón robusto de `factura_correlativos` / `next_numero_factura_empresa`
 * a cualquier tipo de documento (presupuesto, recepcion, nota_salida, remision, ...).
 * Atómico: usa INSERT ... ON CONFLICT DO UPDATE ... RETURNING dentro de la tx del
 * caller, evitando la carrera del `max(numero)+1` usado hoy en presupuestos/ventas.
 *
 * NO reemplaza la numeración fiscal (autoimpresor/SIFEN), que tiene su propia lógica.
 */
import type { PoolClient } from "pg";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface SiguienteCorrelativoOpts {
  /** Relleno con ceros a la izquierda. Default 6 → PRE-000001. */
  padding?: number;
  /** Prefijo textual; se persiste para trazabilidad. Default = tipo en mayúsculas. */
  prefijo?: string;
}

function formatNumero(prefijo: string, n: number, padding: number): string {
  const num = String(n).padStart(padding, "0");
  return prefijo ? `${prefijo}-${num}` : num;
}

/**
 * Reserva y devuelve el siguiente correlativo para (empresa, tipo) dentro de la
 * transacción del caller. El número queda consumido aunque la tx global falle en
 * un paso posterior sólo si el caller hace COMMIT; si hace ROLLBACK, se revierte
 * junto con el resto (comportamiento correcto: no se "quema" numeración si la
 * operación completa se aborta).
 */
export async function siguienteCorrelativoTx(
  client: PoolClient,
  schema: string,
  empresaId: string,
  tipo: string,
  opts: SiguienteCorrelativoOpts = {},
): Promise<{ numero: string; secuencia: number }> {
  assertAllowedChatDataSchema(schema);
  const t = quoteSchemaTable(schema, "documento_correlativos");
  const prefijo = opts.prefijo ?? tipo.toUpperCase();
  const padding = opts.padding ?? 6;

  const res = await client.query(
    `INSERT INTO ${t} (empresa_id, tipo, prefijo, ultimo_numero)
       VALUES ($1::uuid, $2, $3, 1)
     ON CONFLICT (empresa_id, tipo)
       DO UPDATE SET ultimo_numero = documento_correlativos.ultimo_numero + 1, updated_at = now()
     RETURNING ultimo_numero`,
    [empresaId, tipo, prefijo],
  );
  const secuencia = Number(res.rows[0].ultimo_numero);
  return { numero: formatNumero(prefijo, secuencia, padding), secuencia };
}

/**
 * Variante autónoma (abre su propia tx corta). Útil cuando no hay una transacción
 * mayor en curso. Para operaciones críticas, preferí `siguienteCorrelativoTx`
 * dentro de la misma tx que el documento.
 */
export async function siguienteCorrelativo(
  schema: string,
  empresaId: string,
  tipo: string,
  opts: SiguienteCorrelativoOpts = {},
): Promise<{ numero: string; secuencia: number }> {
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await siguienteCorrelativoTx(client, schema, empresaId, tipo, opts);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}
