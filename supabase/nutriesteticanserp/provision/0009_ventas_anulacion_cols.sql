-- =============================================================================
-- Nutriestéticans — columnas de auditoría de anulación en `ventas`.
-- =============================================================================
-- Requeridas por src/lib/ventas/server/anular-venta-core.ts (portado desde
-- caacupe). El estado 'anulada' ya está permitido por el CHECK original
-- (20250312000003_erp_schema.sql:85) → solo falta persistir CUÁNDO, QUIÉN y
-- POR QUÉ se anuló, para trazabilidad y para mostrar el motivo en la lista.
--
-- Aditivo e idempotente. Aplicar como supabase_admin.
-- =============================================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ventas'
      AND c.relkind = 'r'
      AND n.nspname = 'nutriesteticanserp'
  LOOP
    EXECUTE format($fmt$
      ALTER TABLE %I.ventas
        ADD COLUMN IF NOT EXISTS anulada_at       timestamptz,
        ADD COLUMN IF NOT EXISTS anulada_por      uuid,
        ADD COLUMN IF NOT EXISTS anulacion_motivo text
    $fmt$, r.sch);
  END LOOP;
END $$;
