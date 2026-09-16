-- =============================================================================
-- Nutriestéticans — Infra que faltaba para NR-por-venta
-- =============================================================================
-- 0011 agrego las columnas de negocio; este migra la infra generica que usa el
-- flujo `remisiones-venta-pg.ts` (correlativo atomico + auditoria) y termina de
-- redondear cabecera de `notas_remision`.
--
-- Todo idempotente: reejecutable sin dañar datos.
-- =============================================================================

-- Correlativos generico por (empresa, tipo) -----------------------------------
CREATE TABLE IF NOT EXISTS nutriesteticanserp.documento_correlativos (
  id             uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  tipo           text NOT NULL,
  prefijo        text NOT NULL DEFAULT '',
  ultimo_numero  bigint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_documento_correlativos_empresa_tipo UNIQUE (empresa_id, tipo)
);

-- Bitacora de auditoria -------------------------------------------------------
CREATE TABLE IF NOT EXISTS nutriesteticanserp.auditoria_eventos (
  id             uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  entidad        text NOT NULL,
  entidad_id     uuid,
  accion         text NOT NULL,
  origen         text,
  usuario_id     uuid,
  usuario_email  text,
  usuario_nombre text,
  detalle        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_entidad
  ON nutriesteticanserp.auditoria_eventos (empresa_id, entidad, entidad_id, created_at DESC);

-- notas_remision: campos operativos que asume el flujo -----------------------
-- `fecha` puede venir vacio en NR viejas (talonario). Con default now() la NR
-- nueva por venta queda estampada aun sin fecha explicita del cliente.
ALTER TABLE nutriesteticanserp.notas_remision
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  BEGIN
    ALTER TABLE nutriesteticanserp.notas_remision
      ALTER COLUMN fecha SET DEFAULT now();
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;
