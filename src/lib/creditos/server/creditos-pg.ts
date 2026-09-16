/**
 * Saldo a favor (crédito) del cliente.
 *
 * Modelo de LIBRO MAYOR: cada movimiento es una fila con `monto` con signo y el
 * saldo es SUM(monto). Nunca se muta un campo "saldo", así que todo queda
 * auditado y no puede quedar inconsistente.
 *
 *   monto > 0 -> acredita (devolución con saldo a favor, ajuste)
 *   monto < 0 -> consume  (pago de una venta, retiro en efectivo)
 *
 * Las funciones que reciben `client` corren DENTRO de la transacción del
 * llamador (venta / devolución), para que el crédito se mueva de forma atómica
 * junto con el resto de la operación.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export type TipoMovimientoCredito =
  | "devolucion"
  | "consumo_venta"
  | "retiro_efectivo"
  | "ajuste"
  | "reverso";

export interface MovimientoCredito {
  id: string;
  cliente_id: string;
  tipo: TipoMovimientoCredito;
  monto: number;
  devolucion_id: string | null;
  venta_id: string | null;
  motivo: string | null;
  usuario_nombre: string | null;
  created_at: string;
}

export class CreditoInsuficienteError extends Error {
  disponible: number;
  solicitado: number;
  constructor(disponible: number, solicitado: number) {
    super(
      `El cliente no tiene saldo suficiente: disponible ${Math.round(disponible).toLocaleString("es-PY")}, solicitado ${Math.round(solicitado).toLocaleString("es-PY")}.`
    );
    this.name = "CreditoInsuficienteError";
    this.disponible = disponible;
    this.solicitado = solicitado;
  }
}

interface PgClientLike {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}
function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}
function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de base de datos no disponible.");
  return p;
}
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Saldo disponible del cliente (lectura suelta, sin lock). 0 si no tiene. */
export async function getSaldoCliente(
  schemaRaw: string,
  empresaId: string,
  clienteId: string
): Promise<number> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "creditos_cliente");
  const { rows } = await pool().query(
    `SELECT COALESCE(SUM(monto), 0) AS saldo FROM ${t} WHERE empresa_id = $1::uuid AND cliente_id = $2::uuid`,
    [empresaId, clienteId]
  );
  return round2(num(rows[0]?.saldo));
}

/**
 * Saldo del cliente BLOQUEANDO sus movimientos (FOR UPDATE), para usar dentro
 * de una transacción antes de consumir. Evita que dos cajas gasten el mismo
 * saldo a la vez.
 */
export async function getSaldoClienteForUpdate(
  client: PgClientLike,
  schemaRaw: string,
  empresaId: string,
  clienteId: string
): Promise<number> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "creditos_cliente");
  // Lock por cliente: serializa las operaciones de crédito de ESE cliente hasta
  // el fin de la transacción. Es el que garantiza que dos cajas no gasten el
  // mismo saldo. (No se usa FOR UPDATE: Postgres no lo permite junto a SUM().)
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`credito:${empresaId}:${clienteId}`]);
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(monto), 0) AS saldo FROM ${t} WHERE empresa_id = $1::uuid AND cliente_id = $2::uuid`,
    [empresaId, clienteId]
  );
  return round2(num(rows[0]?.saldo));
}

export interface MovimientoInput {
  clienteId: string;
  tipo: TipoMovimientoCredito;
  /** Con signo: positivo acredita, negativo consume. */
  monto: number;
  devolucionId?: string | null;
  ventaId?: string | null;
  cajaMovimientoId?: string | null;
  motivo?: string | null;
  usuario?: { id: string | null; nombre: string | null };
}

/** Registra un movimiento de crédito dentro de la transacción del llamador. */
export async function registrarMovimientoCredito(
  client: PgClientLike,
  schemaRaw: string,
  empresaId: string,
  input: MovimientoInput
): Promise<string> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "creditos_cliente");
  const monto = round2(input.monto);
  if (monto === 0) throw new Error("El movimiento de crédito no puede ser cero.");
  const { rows } = await client.query(
    `INSERT INTO ${t} (
       empresa_id, cliente_id, tipo, monto, devolucion_id, venta_id,
       caja_movimiento_id, motivo, created_by, usuario_nombre
     ) VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8,$9::uuid,$10)
     RETURNING id::text`,
    [
      empresaId, input.clienteId, input.tipo, monto,
      input.devolucionId ?? null, input.ventaId ?? null, input.cajaMovimientoId ?? null,
      input.motivo ?? null, input.usuario?.id ?? null, input.usuario?.nombre ?? null,
    ]
  );
  return String(rows[0].id);
}

/**
 * Consume saldo del cliente validando que alcance. Lanza CreditoInsuficienteError
 * si no hay saldo. `monto` se pasa POSITIVO (lo que se quiere consumir).
 */
export async function consumirCredito(
  client: PgClientLike,
  schemaRaw: string,
  empresaId: string,
  input: { clienteId: string; monto: number; ventaId?: string | null; cajaMovimientoId?: string | null; tipo?: TipoMovimientoCredito; motivo?: string | null; usuario?: { id: string | null; nombre: string | null } }
): Promise<{ movimientoId: string; saldoPrevio: number; saldoNuevo: number }> {
  const monto = round2(input.monto);
  if (monto <= 0) throw new Error("El monto a consumir debe ser mayor a cero.");
  const saldoPrevio = await getSaldoClienteForUpdate(client, schemaRaw, empresaId, input.clienteId);
  if (monto > saldoPrevio + 1e-9) throw new CreditoInsuficienteError(saldoPrevio, monto);
  const movimientoId = await registrarMovimientoCredito(client, schemaRaw, empresaId, {
    clienteId: input.clienteId,
    tipo: input.tipo ?? "consumo_venta",
    monto: -monto,
    ventaId: input.ventaId ?? null,
    cajaMovimientoId: input.cajaMovimientoId ?? null,
    motivo: input.motivo ?? null,
    usuario: input.usuario,
  });
  return { movimientoId, saldoPrevio, saldoNuevo: round2(saldoPrevio - monto) };
}

/** Historial de movimientos del cliente (más recientes primero). */
export async function listarMovimientosCliente(
  schemaRaw: string,
  empresaId: string,
  clienteId: string,
  limit = 100
): Promise<MovimientoCredito[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "creditos_cliente");
  const { rows } = await pool().query(
    `SELECT id::text, cliente_id::text AS cliente_id, tipo, monto,
            devolucion_id::text AS devolucion_id, venta_id::text AS venta_id,
            motivo, usuario_nombre, created_at
       FROM ${t}
      WHERE empresa_id = $1::uuid AND cliente_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}`,
    [empresaId, clienteId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    cliente_id: String(r.cliente_id),
    tipo: String(r.tipo) as TipoMovimientoCredito,
    monto: num(r.monto),
    devolucion_id: str(r.devolucion_id),
    venta_id: str(r.venta_id),
    motivo: str(r.motivo),
    usuario_nombre: str(r.usuario_nombre),
    created_at: iso(r.created_at),
  }));
}
