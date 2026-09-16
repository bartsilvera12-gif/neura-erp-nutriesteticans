/**
 * Bitácora de auditoría genérica (Fase 0).
 *
 * Registra usuario, fecha, empresa y origen de cada operación crítica en
 * `auditoria_eventos`. Complementa (no reemplaza) `cliente_historial` y el
 * event bus efímero `emitEvent`. Diseñado para participar en la misma
 * transacción que la operación auditada (variante ...Tx) o de forma autónoma
 * best-effort (nunca debe tumbar la operación de negocio si falla el log).
 */
import type { PoolClient } from "pg";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface AuditoriaEventoInput {
  empresaId: string;
  entidad: string;
  entidadId?: string | null;
  accion: string;
  origen?: string | null;
  usuarioId?: string | null;
  usuarioEmail?: string | null;
  usuarioNombre?: string | null;
  detalle?: Record<string, unknown>;
}

/** Inserta el evento dentro de la tx del caller (atómico con la operación). */
export async function registrarAuditoriaTx(
  client: PoolClient,
  schema: string,
  evento: AuditoriaEventoInput,
): Promise<void> {
  assertAllowedChatDataSchema(schema);
  const t = quoteSchemaTable(schema, "auditoria_eventos");
  await client.query(
    `INSERT INTO ${t} (
       empresa_id, entidad, entidad_id, accion, origen,
       usuario_id, usuario_email, usuario_nombre, detalle
     ) VALUES (
       $1::uuid, $2, $3::uuid, $4, $5,
       $6::uuid, $7, $8, $9::jsonb
     )`,
    [
      evento.empresaId,
      evento.entidad,
      evento.entidadId ?? null,
      evento.accion,
      evento.origen ?? null,
      evento.usuarioId ?? null,
      evento.usuarioEmail ?? null,
      evento.usuarioNombre ?? null,
      JSON.stringify({ ...(evento.detalle ?? {}), at_iso: new Date().toISOString() }),
    ],
  );
}

/**
 * Variante autónoma y best-effort: nunca lanza. Úsala fuera de una tx crítica
 * (p. ej. auditar una lectura/exportación). Para operaciones transaccionales,
 * preferí `registrarAuditoriaTx`.
 */
export async function registrarAuditoria(
  schema: string,
  evento: AuditoriaEventoInput,
): Promise<void> {
  try {
    const pool = getChatPostgresPool();
    if (!pool) return;
    const client = await pool.connect();
    try {
      await registrarAuditoriaTx(client, schema, evento);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[auditoria] no se pudo registrar evento:", e instanceof Error ? e.message : e);
  }
}
