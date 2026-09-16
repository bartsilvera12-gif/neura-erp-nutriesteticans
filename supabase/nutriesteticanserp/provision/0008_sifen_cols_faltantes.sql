-- =============================================================================
-- Nutriestéticans — columnas de `empresa_sifen_config` y `facturas` que el pipeline
-- SIFEN portado desde caacupe usa y que nutriesteticans no tiene todavía.
-- =============================================================================
-- Consolida en un solo script las migraciones que caacupe fue aplicando
-- gradualmente (contacto emisor, KUDE branding, cancelación, timbrado extendido,
-- password encriptada, actividad económica, dirección fiscal).
--
-- Aditivo e idempotente. Aplicar como supabase_admin.
-- =============================================================================

DO $$
DECLARE r RECORD;
BEGIN
  -- ---------------------------------------------------------------------------
  -- empresa_sifen_config
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'empresa_sifen_config'
      AND c.relkind = 'r'
      AND n.nspname = 'nutriesteticanserp'
  LOOP
    EXECUTE format($fmt$
      ALTER TABLE %I.empresa_sifen_config
        ADD COLUMN IF NOT EXISTS certificado_password_encrypted text,
        ADD COLUMN IF NOT EXISTS direccion_fiscal                text,
        ADD COLUMN IF NOT EXISTS timbrado_fecha_inicio_vigencia  date,
        ADD COLUMN IF NOT EXISTS actividad_economica_codigo      text,
        ADD COLUMN IF NOT EXISTS actividad_economica_descripcion text,
        ADD COLUMN IF NOT EXISTS sifen_plazo_cancelacion_horas   integer NOT NULL DEFAULT 48,
        ADD COLUMN IF NOT EXISTS kude_logo_path                  text,
        ADD COLUMN IF NOT EXISTS kude_color_primario             text,
        ADD COLUMN IF NOT EXISTS kude_color_primario_fill        text,
        ADD COLUMN IF NOT EXISTS emisor_telefono                 text,
        ADD COLUMN IF NOT EXISTS emisor_email                    text
    $fmt$, r.sch);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- facturas
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'facturas'
      AND c.relkind = 'r'
      AND n.nspname = 'nutriesteticanserp'
  LOOP
    EXECUTE format($fmt$
      ALTER TABLE %I.facturas
        ADD COLUMN IF NOT EXISTS sifen_aprobado_at       timestamptz,
        ADD COLUMN IF NOT EXISTS sifen_cancelado_at      timestamptz,
        ADD COLUMN IF NOT EXISTS sifen_cancelacion_motivo text
    $fmt$, r.sch);
  END LOOP;
END $$;
