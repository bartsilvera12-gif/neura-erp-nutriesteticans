-- =============================================================================
-- Nutriestéticans — Notas de remisión SIMPLES (talonario)
-- =============================================================================
-- Habilita el flujo "talonario papel" para NR: sin depósitos, sin stock, sin
-- productos del catálogo. Solo descripciones libres, direcciones editables y
-- motivo del traslado como texto.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + ALTER COLUMN DROP NOT NULL (que no
-- falla si ya es nullable). Convive con las NR viejas ligadas a depósitos:
-- ninguna columna se elimina y `modo` viene NULL para las NR pre-existentes.
-- =============================================================================

-- Cabecera --------------------------------------------------------------------
ALTER TABLE nutriesteticanserp.notas_remision
  ADD COLUMN IF NOT EXISTS modo               text,
  ADD COLUMN IF NOT EXISTS motivo_traslado    text,
  ADD COLUMN IF NOT EXISTS direccion_origen   text,
  ADD COLUMN IF NOT EXISTS direccion_destino  text,
  ADD COLUMN IF NOT EXISTS fecha_inicio_traslado date,
  ADD COLUMN IF NOT EXISTS fecha_fin_traslado    date;

-- En modo talonario NO hay depósito origen ni emisor obligatorio.
ALTER TABLE nutriesteticanserp.notas_remision
  ALTER COLUMN ubicacion_origen_id DROP NOT NULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE nutriesteticanserp.notas_remision ALTER COLUMN emisor DROP NOT NULL';
  EXCEPTION WHEN others THEN
    -- Ya era nullable o no existe la constraint: nada que hacer.
    NULL;
  END;
END $$;

-- Ítems -----------------------------------------------------------------------
-- En talonario los ítems son texto libre (descripción + unidad). No hay
-- producto del catálogo.
ALTER TABLE nutriesteticanserp.notas_remision_items
  ADD COLUMN IF NOT EXISTS descripcion    text,
  ADD COLUMN IF NOT EXISTS unidad_medida  text;

ALTER TABLE nutriesteticanserp.notas_remision_items
  ALTER COLUMN producto_id DROP NOT NULL;

-- Índice para filtrar rápidamente NR "talonario" en el listado.
CREATE INDEX IF NOT EXISTS notas_remision_modo_idx
  ON nutriesteticanserp.notas_remision (empresa_id, modo);
