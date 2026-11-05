-- =============================================================================
-- compra_pagos — pagos aplicados a compras (sobre todo a crédito).
-- Idempotente. Tabla aditiva: no modifica estructuras existentes.
-- RLS: coherente con otras tablas operativas del tenant.
-- =============================================================================

DO $$
DECLARE
  v_schema text := current_setting('neura.client_schema', true);
BEGIN
  IF v_schema IS NULL OR v_schema = '' THEN
    v_schema := 'nutriesteticanserp';
  END IF;

  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS %I.compra_pagos (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id            uuid NOT NULL,
      compra_numero_control text NOT NULL,
      fecha                 date NOT NULL DEFAULT CURRENT_DATE,
      monto                 numeric(14,2) NOT NULL CHECK (monto > 0),
      medio_pago            text NOT NULL DEFAULT 'efectivo',
      moneda                text NOT NULL DEFAULT 'GS',
      observacion           text,
      created_by            uuid,
      usuario_nombre        text,
      created_at            timestamptz NOT NULL DEFAULT now(),
      anulado_at            timestamptz,
      anulado_por           uuid,
      anulado_motivo        text
    )
  $f$, v_schema);

  EXECUTE format($f$
    CREATE INDEX IF NOT EXISTS compra_pagos_empresa_numero_idx
      ON %I.compra_pagos (empresa_id, compra_numero_control)
  $f$, v_schema);

  EXECUTE format($f$
    CREATE INDEX IF NOT EXISTS compra_pagos_empresa_fecha_idx
      ON %I.compra_pagos (empresa_id, fecha DESC)
  $f$, v_schema);

  EXECUTE format($f$
    ALTER TABLE %I.compra_pagos ENABLE ROW LEVEL SECURITY
  $f$, v_schema);

  EXECUTE format($f$
    DROP POLICY IF EXISTS compra_pagos_tenant ON %I.compra_pagos
  $f$, v_schema);

  EXECUTE format($f$
    CREATE POLICY compra_pagos_tenant ON %I.compra_pagos
      FOR ALL TO authenticated
      USING (true) WITH CHECK (true)
  $f$, v_schema);

  EXECUTE format($f$
    GRANT SELECT, INSERT, UPDATE, DELETE ON %I.compra_pagos TO authenticated, service_role
  $f$, v_schema);
END $$;
