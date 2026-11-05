-- =============================================================================
-- Amplía el CHECK de movimientos_inventario.origen con los dos valores que
-- genera el módulo Compras: 'edicion_compra' (al editar cantidad de una
-- compra existente) y 'anulacion_compra' (al anular una compra ya registrada).
-- Idempotente.
-- =============================================================================

DO $$
DECLARE
  v_schema text := current_setting('neura.client_schema', true);
BEGIN
  IF v_schema IS NULL OR v_schema = '' THEN
    v_schema := 'nutriesteticanserp';
  END IF;

  EXECUTE format($f$
    ALTER TABLE %I.movimientos_inventario
      DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check
  $f$, v_schema);

  EXECUTE format($f$
    ALTER TABLE %I.movimientos_inventario
      ADD CONSTRAINT movimientos_inventario_origen_check
      CHECK (origen = ANY (ARRAY[
        'compra'::text,
        'venta'::text,
        'ajuste_manual'::text,
        'inventario_inicial'::text,
        'produccion'::text,
        'devolucion_venta'::text,
        'nota_remision'::text,
        'edicion_compra'::text,
        'anulacion_compra'::text
      ]))
  $f$, v_schema);
END $$;
