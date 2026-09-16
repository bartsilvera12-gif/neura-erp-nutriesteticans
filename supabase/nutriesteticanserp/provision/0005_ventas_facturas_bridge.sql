-- =============================================================================
-- Nutriestéticans — puente Venta → Factura ERP (necesario para el pipeline SIFEN
-- portado desde caacupe).
-- =============================================================================
-- Al crear una venta con "Factura" el server también crea la factura ERP
-- asociada (numero_factura FAC-XXXXXX) y la linkea vía ventas.factura_id.
-- El detalle /facturas/[id] tiene el panel para firmar / enviar / imprimir KUDE.
--
-- Aplica SOLO en `nutriesteticanserp`. Aditivo e idempotente. Requiere rol
-- supabase_admin (dueño de las tablas).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1) facturas: campos denormalizados y link a la venta origen
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'facturas'
      AND c.relkind = 'r'
      AND n.nspname = 'nutriesteticanserp'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.facturas
         ADD COLUMN IF NOT EXISTS cliente_razon_social text,
         ADD COLUMN IF NOT EXISTS cliente_ruc          text,
         ADD COLUMN IF NOT EXISTS origen_venta_id      uuid,
         ADD COLUMN IF NOT EXISTS observaciones        text',
      r.sch
    );
    -- cliente_id nullable: una venta sin cliente igual puede tener factura
    -- (razón social + RUC guardados en columnas denormalizadas).
    BEGIN
      EXECUTE format('ALTER TABLE %I.facturas ALTER COLUMN cliente_id DROP NOT NULL', r.sch);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_empresa_numero
         ON %I.facturas(empresa_id, numero_factura)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_facturas_origen_venta
         ON %I.facturas(origen_venta_id)',
      r.sch
    );
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2) ventas.factura_id (puente)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ventas'
      AND c.relkind = 'r'
      AND n.nspname = 'nutriesteticanserp'
  LOOP
    EXECUTE format('ALTER TABLE %I.ventas ADD COLUMN IF NOT EXISTS factura_id uuid', r.sch);
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.ventas DROP CONSTRAINT IF EXISTS ventas_factura_id_fkey',
        r.sch
      );
      EXECUTE format(
        'ALTER TABLE %I.ventas
           ADD CONSTRAINT ventas_factura_id_fkey
           FOREIGN KEY (factura_id) REFERENCES %I.facturas(id) ON DELETE SET NULL',
        r.sch, r.sch
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_ventas_factura ON %I.ventas(factura_id)',
      r.sch
    );
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 3) factura_items.tipo_iva (desglose SIFEN por línea)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'factura_items'
      AND c.relkind = 'r'
      AND n.nspname = 'nutriesteticanserp'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.factura_items ADD COLUMN IF NOT EXISTS tipo_iva text',
      r.sch
    );
    EXECUTE format(
      'UPDATE %I.factura_items SET tipo_iva = ''10%%'' WHERE tipo_iva IS NULL',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.factura_items ALTER COLUMN tipo_iva SET NOT NULL',
      r.sch
    );
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('%I.factura_items', r.sch)::regclass
        AND conname = 'factura_items_tipo_iva_check'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.factura_items
           ADD CONSTRAINT factura_items_tipo_iva_check
           CHECK (tipo_iva IN (''EXENTA'', ''5%%'', ''10%%''))',
        r.sch
      );
    END IF;
  END LOOP;
END $$;
