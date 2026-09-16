-- =============================================================================
-- Nutriestéticans — Notas de remisión POR VENTA (reemplazo del talonario)
-- =============================================================================
-- Habilita el modelo "NR emitida desde la venta" con listado global de lectura:
--
--   * `notas_remision` gana `venta_id` y campos de trazabilidad (creador /
--     confirmador / anulación) + cliente_nombre snapshot y observacion.
--   * `notas_remision_items` gana `venta_item_id`, `producto_nombre`, `sku`,
--     `costo_unitario`, `observacion` y `empresa_id` (poblado por el flujo).
--   * `ventas` gana `estado_entrega` (pendiente|entregada|parcialmente_entregada)
--     y `numero_orden_compra`.
--   * `ventas_items` gana `cantidad_entregada`, que se ajusta por cada NR.
--
-- Convive con NR viejas (talonario y talonario-depósito): ninguna columna se
-- elimina, `venta_id` queda NULL para NR pre-existentes. El CHECK de `estado` se
-- relaja para aceptar los nuevos estados `confirmada`/`anulada` además de los
-- previos (`pendiente`/`aprobada`/`rechazada`/`borrador`).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + DROP
-- CONSTRAINT ... IF EXISTS. Reejecutar es seguro.
-- =============================================================================

-- notas_remision ---------------------------------------------------------------
ALTER TABLE nutriesteticanserp.notas_remision
  ADD COLUMN IF NOT EXISTS venta_id                    uuid,
  ADD COLUMN IF NOT EXISTS factura_id                  uuid,
  ADD COLUMN IF NOT EXISTS cliente_nombre              text,
  ADD COLUMN IF NOT EXISTS observacion                 text,
  ADD COLUMN IF NOT EXISTS usuario_creador_id          uuid,
  ADD COLUMN IF NOT EXISTS usuario_creador_nombre      text,
  ADD COLUMN IF NOT EXISTS confirmada_at               timestamptz,
  ADD COLUMN IF NOT EXISTS usuario_confirmador_id      uuid,
  ADD COLUMN IF NOT EXISTS usuario_confirmador_nombre  text,
  ADD COLUMN IF NOT EXISTS anulada_at                  timestamptz,
  ADD COLUMN IF NOT EXISTS anulada_por                 uuid,
  ADD COLUMN IF NOT EXISTS anulada_motivo              text;

-- FK a ventas para venta_id (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notas_remision_venta_id_fkey'
       AND conrelid = 'nutriesteticanserp.notas_remision'::regclass
  ) THEN
    ALTER TABLE nutriesteticanserp.notas_remision
      ADD CONSTRAINT notas_remision_venta_id_fkey
      FOREIGN KEY (venta_id) REFERENCES nutriesteticanserp.ventas(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  NULL; -- si venta_id ya tiene FK equivalente, no romper.
END $$;

-- Relajar CHECK de estado para aceptar 'confirmada' y 'anulada'.
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'nutriesteticanserp.notas_remision'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE nutriesteticanserp.notas_remision DROP CONSTRAINT %I', cname);
  END LOOP;
EXCEPTION WHEN others THEN
  NULL;
END $$;

ALTER TABLE nutriesteticanserp.notas_remision
  ADD CONSTRAINT notas_remision_estado_check
  CHECK (estado IN ('pendiente','aprobada','rechazada','borrador','confirmada','anulada'));

CREATE INDEX IF NOT EXISTS idx_nr_venta
  ON nutriesteticanserp.notas_remision (venta_id);

-- notas_remision_items ---------------------------------------------------------
ALTER TABLE nutriesteticanserp.notas_remision_items
  ADD COLUMN IF NOT EXISTS empresa_id       uuid,
  ADD COLUMN IF NOT EXISTS venta_item_id    uuid,
  ADD COLUMN IF NOT EXISTS producto_nombre  text,
  ADD COLUMN IF NOT EXISTS sku              text,
  ADD COLUMN IF NOT EXISTS costo_unitario   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observacion      text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notas_remision_items_venta_item_id_fkey'
       AND conrelid = 'nutriesteticanserp.notas_remision_items'::regclass
  ) THEN
    ALTER TABLE nutriesteticanserp.notas_remision_items
      ADD CONSTRAINT notas_remision_items_venta_item_id_fkey
      FOREIGN KEY (venta_item_id) REFERENCES nutriesteticanserp.ventas_items(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_nri_venta_item
  ON nutriesteticanserp.notas_remision_items (venta_item_id);

-- ventas -----------------------------------------------------------------------
ALTER TABLE nutriesteticanserp.ventas
  ADD COLUMN IF NOT EXISTS estado_entrega       text DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS numero_orden_compra  text;

UPDATE nutriesteticanserp.ventas SET estado_entrega = 'pendiente' WHERE estado_entrega IS NULL;

ALTER TABLE nutriesteticanserp.ventas
  ALTER COLUMN estado_entrega SET NOT NULL;

-- ventas_items -----------------------------------------------------------------
ALTER TABLE nutriesteticanserp.ventas_items
  ADD COLUMN IF NOT EXISTS cantidad_entregada numeric DEFAULT 0;

UPDATE nutriesteticanserp.ventas_items
   SET cantidad_entregada = 0
 WHERE cantidad_entregada IS NULL;

ALTER TABLE nutriesteticanserp.ventas_items
  ALTER COLUMN cantidad_entregada SET NOT NULL;
