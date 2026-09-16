-- ============================================================================
-- Nutriestéticans — Estructura base multi-sucursal (una sola: Casa Matriz)
-- ============================================================================
-- Adaptado desde caacupe (fase 1 sucursales). Diferencias:
--   * Nutriestéticans tiene UN SOLO local ("Casa Matriz"), no dos.
--   * Backfill de todo lo existente a Casa Matriz.
--   * Tolerante a tablas ausentes: si una tabla no existe en nutriesteticans (heredada
--     desde heraclioerp/ferrecolor) simplemente se salta.
--
-- Requerido por el pipeline SIFEN portado desde caacupe:
--   src/lib/sifen/load-factura-payload.ts lee `facturas.sucursal_id`.
--   src/lib/sifen/punto-expedicion-sucursal.ts consulta la tabla `sucursales`.
--
-- PURAMENTE ADITIVA: `sucursal_id` nace NULLABLE en cada tabla y se backfillea.
-- Ninguna API filtra todavía por sucursal.
-- ============================================================================

BEGIN;

-- Guarda: asume UNA sola empresa (Nutriestéticans).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM nutriesteticanserp.empresas;
  IF n <> 1 THEN
    RAISE EXCEPTION 'ABORT: se esperaba 1 empresa, hay %. Revisar antes de continuar.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Catálogo de sucursales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nutriesteticanserp.sucursales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES nutriesteticanserp.empresas(id) ON DELETE CASCADE,
  codigo        text NOT NULL,
  nombre        text NOT NULL,
  es_principal  boolean NOT NULL DEFAULT false,
  activa        boolean NOT NULL DEFAULT true,
  establecimiento    text,
  punto_expedicion   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sucursales_codigo_uq UNIQUE (empresa_id, codigo)
);

CREATE UNIQUE INDEX IF NOT EXISTS sucursales_una_principal_uq
  ON nutriesteticanserp.sucursales (empresa_id) WHERE es_principal;

COMMENT ON TABLE nutriesteticanserp.sucursales IS
  'Sucursales operativas. Punto de expedición informativo — la emisión SIFEN sigue leyendo empresa_sifen_config hasta que se active multi-sucursal SIFEN.';

-- Casa Matriz — única sucursal inicial para Nutriestéticans.
INSERT INTO nutriesteticanserp.sucursales
  (empresa_id, codigo, nombre, es_principal, activa, establecimiento, punto_expedicion)
SELECT e.id, 'CASA_MATRIZ', 'Casa Matriz', true, true, '001', '001'
  FROM nutriesteticanserp.empresas e
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Acceso de usuarios a sucursales (N:M) + sucursal por defecto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nutriesteticanserp.usuario_sucursales (
  usuario_id   uuid NOT NULL REFERENCES nutriesteticanserp.usuarios(id) ON DELETE CASCADE,
  sucursal_id  uuid NOT NULL REFERENCES nutriesteticanserp.sucursales(id) ON DELETE CASCADE,
  empresa_id   uuid NOT NULL REFERENCES nutriesteticanserp.empresas(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, sucursal_id)
);
CREATE INDEX IF NOT EXISTS idx_usuario_sucursales_sucursal
  ON nutriesteticanserp.usuario_sucursales (sucursal_id);

ALTER TABLE nutriesteticanserp.usuarios
  ADD COLUMN IF NOT EXISTS sucursal_predeterminada_id uuid
    REFERENCES nutriesteticanserp.sucursales(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3) sucursal_id NULLABLE en tablas operativas y de catálogo (si existen)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Transaccionales
    'ventas','facturas','factura_electronica','nota_credito','compras','gastos',
    'presupuestos','movimientos_inventario','producciones','proyectos',
    'cuentas_por_cobrar','sifen_jobs','pagos','cobros_clientes','recibos_dinero',
    -- Catálogo
    'productos','producto_categorias','categorias_productos','recetas'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = t AND c.relkind = 'r' AND n.nspname = 'nutriesteticanserp'
    ) THEN
      EXECUTE format(
        'ALTER TABLE nutriesteticanserp.%I ADD COLUMN IF NOT EXISTS sucursal_id uuid
           REFERENCES nutriesteticanserp.sucursales(id) ON DELETE RESTRICT', t);
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%s_sucursal ON nutriesteticanserp.%I (sucursal_id)', t, t);
    ELSE
      RAISE NOTICE 'Skip: nutriesteticanserp.% no existe en este schema', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4) BACKFILL — todo lo existente queda en Casa Matriz
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_emp uuid;
  v_cm  uuid;
  t     text;
  n     bigint;
BEGIN
  SELECT id INTO v_emp FROM nutriesteticanserp.empresas LIMIT 1;
  SELECT id INTO v_cm  FROM nutriesteticanserp.sucursales
   WHERE empresa_id = v_emp AND codigo = 'CASA_MATRIZ';
  IF v_cm IS NULL THEN
    RAISE EXCEPTION 'ABORT: no se encontró la sucursal CASA_MATRIZ';
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'ventas','facturas','factura_electronica','nota_credito','compras','gastos',
    'presupuestos','movimientos_inventario','producciones','proyectos',
    'cuentas_por_cobrar','sifen_jobs','pagos','cobros_clientes','recibos_dinero',
    'productos','producto_categorias','categorias_productos','recetas'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = t AND c.relkind = 'r' AND n.nspname = 'nutriesteticanserp'
    ) THEN
      EXECUTE format(
        'UPDATE nutriesteticanserp.%I SET sucursal_id = $1 WHERE sucursal_id IS NULL', t)
        USING v_cm;
      EXECUTE format(
        'SELECT count(*) FROM nutriesteticanserp.%I WHERE sucursal_id IS NULL', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'ABORT: % quedó con % filas sin sucursal_id', t, n;
      END IF;
    END IF;
  END LOOP;

  -- Todos los usuarios operan en Casa Matriz.
  INSERT INTO nutriesteticanserp.usuario_sucursales (usuario_id, sucursal_id, empresa_id)
  SELECT u.id, v_cm, v_emp FROM nutriesteticanserp.usuarios u
  ON CONFLICT (usuario_id, sucursal_id) DO NOTHING;

  UPDATE nutriesteticanserp.usuarios
     SET sucursal_predeterminada_id = v_cm
   WHERE sucursal_predeterminada_id IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Índices únicos por sucursal (solo se recrean si la tabla existe)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- productos: SKU único por sucursal
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'productos' AND relnamespace = 'nutriesteticanserp'::regnamespace) THEN
    DROP INDEX IF EXISTS nutriesteticanserp.idx_productos_empresa_sku;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_empresa_sucursal_sku
      ON nutriesteticanserp.productos (empresa_id, sucursal_id, sku);
    DROP INDEX IF EXISTS nutriesteticanserp.uq_productos_codigo_barras;
    -- guard: solo si la columna codigo_barras existe
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'nutriesteticanserp' AND table_name = 'productos' AND column_name = 'codigo_barras'
    ) THEN
      CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_codigo_barras
        ON nutriesteticanserp.productos (empresa_id, sucursal_id, codigo_barras)
        WHERE codigo_barras IS NOT NULL;
    END IF;
  END IF;

  -- facturas: numero_factura único por sucursal
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'facturas' AND relnamespace = 'nutriesteticanserp'::regnamespace) THEN
    DROP INDEX IF EXISTS nutriesteticanserp.uq_facturas_empresa_numero;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_empresa_sucursal_numero
      ON nutriesteticanserp.facturas (empresa_id, sucursal_id, numero_factura);
  END IF;

  -- nota_credito
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'nota_credito' AND relnamespace = 'nutriesteticanserp'::regnamespace) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'nutriesteticanserp' AND table_name = 'nota_credito' AND column_name = 'numero'
    ) THEN
      DROP INDEX IF EXISTS nutriesteticanserp.nota_credito_numero_empresa_uq;
      CREATE UNIQUE INDEX IF NOT EXISTS nota_credito_numero_empresa_sucursal_uq
        ON nutriesteticanserp.nota_credito (empresa_id, sucursal_id, numero)
        WHERE numero IS NOT NULL;
    END IF;
  END IF;

  -- categorias_productos
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'categorias_productos' AND relnamespace = 'nutriesteticanserp'::regnamespace) THEN
    DROP INDEX IF EXISTS nutriesteticanserp.uq_categorias_productos_empresa_nombre;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_productos_empresa_sucursal_nombre
      ON nutriesteticanserp.categorias_productos (empresa_id, sucursal_id, lower(btrim(nombre)));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Verificación
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_suc int; v_us int; v_sin_acceso int; v_sin_default int;
BEGIN
  SELECT count(*) INTO v_suc FROM nutriesteticanserp.sucursales;
  IF v_suc < 1 THEN RAISE EXCEPTION 'ABORT: no se creó Casa Matriz'; END IF;

  SELECT count(*) INTO v_us FROM nutriesteticanserp.usuarios;
  SELECT count(*) INTO v_sin_acceso FROM nutriesteticanserp.usuarios u
   WHERE NOT EXISTS (SELECT 1 FROM nutriesteticanserp.usuario_sucursales us WHERE us.usuario_id = u.id);
  IF v_sin_acceso > 0 THEN
    RAISE EXCEPTION 'ABORT: % de % usuarios sin acceso a ninguna sucursal', v_sin_acceso, v_us;
  END IF;

  SELECT count(*) INTO v_sin_default FROM nutriesteticanserp.usuarios
   WHERE sucursal_predeterminada_id IS NULL;
  IF v_sin_default > 0 THEN
    RAISE EXCEPTION 'ABORT: % usuarios sin sucursal predeterminada', v_sin_default;
  END IF;

  RAISE NOTICE 'Multi-sucursal OK: % sucursal(es), % usuario(s) con acceso y default asignado', v_suc, v_us;
END $$;

COMMIT;
