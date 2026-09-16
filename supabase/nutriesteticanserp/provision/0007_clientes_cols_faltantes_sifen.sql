-- =============================================================================
-- Nutriestéticans — columnas de `clientes` que el pipeline SIFEN portado desde caacupe
-- espera y que nutriesteticans no tiene todavía.
-- =============================================================================
-- Errores que resuelve (aparecen al confirmar 'Factura electrónica' en la caja):
--   * "column clientes.nombre_facturacion does not exist"
--   * potencial: "column clientes.es_contribuyente does not exist"
--   * potencial: "column clientes.nombre does not exist"
--
-- src/lib/sifen/load-factura-payload.ts pide (columnas a la vez):
--   id, empresa, nombre_contacto, nombre, nombre_facturacion, ruc, documento,
--   tipo_cliente, es_contribuyente, direccion, telefono, email, pais,
--   sifen_*  (todas ya existen en el schema clonado desde ferrecolor)
--
-- Aditivo e idempotente. NO toca datos. Aplicar como supabase_admin.
-- =============================================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'clientes'
      AND c.relkind = 'r'
      AND n.nspname = 'nutriesteticanserp'
  LOOP
    -- 1) nombre_facturacion (text, nullable): sobrescribe dNomRec cuando el
    --    cliente pide facturar a nombre de otra persona (pareja, hijo/a).
    EXECUTE format(
      'ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS nombre_facturacion text',
      r.sch
    );

    -- 2) es_contribuyente (boolean, default false): persona física inscripta
    --    en SET. Habilita B2B (iTiOpe=1) cuando tipo_cliente='persona' y RUC
    --    cargado.
    EXECUTE format(
      'ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS es_contribuyente boolean NOT NULL DEFAULT false',
      r.sch
    );

    -- 3) nombre (text, nullable): alias legacy. En caacupe algunos flows leen
    --    `nombre` en vez de `nombre_contacto`. Nutriestéticans históricamente solo tiene
    --    `empresa` y `nombre_contacto`; agregar `nombre` como alias vacío evita
    --    que el SELECT del payload SIFEN rompa.
    EXECUTE format(
      'ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS nombre text',
      r.sch
    );
  END LOOP;
END $$;
