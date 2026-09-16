/**
 * Resultado de un "core" SIFEN server-side (sin dependencia de NextRequest/NextResponse).
 * Los route handlers lo adaptan a `NextResponse` (successResponse / errorResponse + status).
 * El orquestador (`emitirDeFacturaServerSide`) lo consume directamente.
 */
export type SifenCoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };
