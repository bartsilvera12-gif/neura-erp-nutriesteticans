-- =============================================================================
-- Provisión de datos maestros — instancia dedicada monocliente: Nutriestéticans
-- =============================================================================
-- Idempotente. Requiere que el schema `nutriesteticanserp` YA exista con la estructura
-- clonada desde `heraclioerp` (script 0000_clone_schema_from_heraclioerp.sql).
--
-- Este script SOLO inserta catálogos estructurales mínimos y la empresa propia.
-- NO copia datos operativos (clientes, productos, stock, compras, ventas,
-- facturas, pagos, proveedores, conversaciones, campañas, usuarios, tokens,
-- certificados, etc.).
--
-- Empresa Nutriestéticans (UUID fijo, generado con crypto.randomUUID):
--     33308550-2d5b-4137-b2bd-d2b331ae555d
-- =============================================================================

DO $$
DECLARE
  v_empresa_id uuid := '33308550-2d5b-4137-b2bd-d2b331ae555d';
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1) Empresa propia (única empresa operativa del schema nutriesteticanserp).
  -- ---------------------------------------------------------------------------
  INSERT INTO nutriesteticanserp.empresas (id, nombre_empresa, pais, estado, data_schema, gestion_tributaria_clientes)
  VALUES (v_empresa_id, 'Nutriestéticans', 'PARAGUAY', 'activo', 'nutriesteticanserp', false)
  ON CONFLICT (id) DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 2) Catálogo global de módulos. IDs idénticos al catálogo fuente para
  --    que empresa_modulos / usuario_modulos resuelvan por FK.
  -- ---------------------------------------------------------------------------
  INSERT INTO nutriesteticanserp.modulos (id, nombre, slug, descripcion) VALUES
    ('f497bf2a-d650-460a-b5ab-f72018fed47b','Gastos','gastos',NULL),
    ('de613097-35c8-4b05-be53-bc6bde5d5f0b','Pagos','pagos',NULL),
    ('98d53199-0259-4ade-9dbc-e8f67918305c','Marketing Ops','marketing',NULL),
    ('c0f676ac-d879-48b2-a78a-6db59fabb100','Sorteos','sorteos',NULL),
    ('3cb40f93-1aed-4bcc-a800-a1b4ecabc0fe','Conversaciones','conversaciones',NULL),
    ('7cb297a1-b49b-4ef5-9777-09f4518402a1','Dashboard','dashboard',NULL),
    ('3a1a6701-f6c5-48fd-b599-c6f88bc48374','Ventas','ventas',NULL),
    ('569781c8-7e1d-4ac9-b240-e7bb82a0b83b','Inventario','inventario',NULL),
    ('3b6391bb-e77a-464b-84ea-1f95884cffc3','Clientes','clientes',NULL),
    ('aea02686-46a2-4448-a9b3-fe83b4a03491','Compras','compras',NULL),
    ('1a9717b9-8a8e-42f3-b46b-a9e559543d8b','Usuarios','usuarios',NULL),
    ('96f10ea8-a801-41a6-951f-83b7fcf5a0ab','Configuración','configuracion',NULL),
    ('2f0b9c7b-965b-4c70-8480-53442cdd41fc','Planes','planes',NULL),
    ('63025c6b-8417-4b9a-8f1c-034002279778','Gestión Clientes','gestion-clientes',NULL),
    ('e59cc5a3-5f7c-4a6c-afe2-d7f1a67fe602','CRM Funnel','crm',NULL),
    ('1d917292-2e2e-4c9f-9615-4565b3b51dd9','Notas de crédito','notas_credito',NULL),
    ('4b6bdaf2-1790-424d-bb80-b404235ddd49','Historial omnicanal','historial-omnicanal',NULL),
    ('914f9f31-b968-4de6-907f-2a1281a8d5fc','Conversaciones finalizadas','conversaciones-finalizadas',NULL),
    ('ea66f279-2861-4835-8cec-1228e12f64ff','Monitoreo','monitoreo',NULL),
    ('80b7c821-5b12-4802-a7ed-2dd2c3d972d3','Omnicanal (paquete)','omnicanal',NULL),
    ('d6e12622-7178-4d19-8277-bb974e238faf','Campañas WhatsApp','campanas',NULL),
    ('dc402405-7428-4770-9573-2a45321aaaba','Proyectos','proyectos',NULL),
    ('49abab54-4d2b-40a3-8feb-131e2430e764','Marketing Ops','marketing_ops',NULL),
    ('e09e242b-2975-47d5-a4d5-42398e013641','Comisiones','comisiones',NULL),
    ('19f4f4cd-ee2a-41cf-a8a9-5930e8703fd2','Recetas','recetas','Recetas y costeo de productos'),
    ('e22671a3-2a8d-4478-9916-3b037f87c592','Reportes','reportes','Reportería operativa (estado de cuenta, proveedores)'),
    ('3f4b07ed-668d-4f86-917f-d354329b5fc3','Presupuestos','presupuestos','Presupuestos / cotizaciones comerciales'),
    ('3bcaff06-0785-47fd-bf7a-a3721d421b10','Cobros','cobros','Cuentas por cobrar y cobros de clientes')
  ON CONFLICT (id) DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 3) Catálogo global de vistas de dashboard.
  -- ---------------------------------------------------------------------------
  INSERT INTO nutriesteticanserp.dashboard_views (id, slug, nombre, orden, activo) VALUES
    ('2c64c937-5537-4550-b846-94345fbc8583','comercial','Comercial',10,true),
    ('c53eec08-84a9-4e5e-a656-74b8a2fc8e44','financiero','Financiero',20,true),
    ('87f0e8f7-7bda-4d72-9c51-8e45363fa5ba','inventario','Inventario',30,true),
    ('76e2b19c-2f47-4306-a8ce-da9162910f1f','ventas','Ventas',40,true)
  ON CONFLICT (id) DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 4) empresa_modulos — SOLO los módulos pedidos para Nutriestéticans:
  --    Dashboard, Clientes, Inventario (incluye subvistas Categorías y
  --    Movimientos como children del sidebar), Ventas.
  -- ---------------------------------------------------------------------------
  DELETE FROM nutriesteticanserp.empresa_modulos WHERE empresa_id = v_empresa_id;

  INSERT INTO nutriesteticanserp.empresa_modulos (empresa_id, modulo_id, activo)
  SELECT v_empresa_id, m.id, true
  FROM nutriesteticanserp.modulos m
  WHERE m.slug IN ('dashboard','clientes','inventario','ventas');

  -- ---------------------------------------------------------------------------
  -- 5) empresa_dashboard_views — SOLO Ventas e Inventario (pedido explícito).
  --    Reset completo del set para dejarlo exactamente en esas dos vistas.
  -- ---------------------------------------------------------------------------
  DELETE FROM nutriesteticanserp.empresa_dashboard_views WHERE empresa_id = v_empresa_id;

  INSERT INTO nutriesteticanserp.empresa_dashboard_views (empresa_id, dashboard_view_id, activo)
  SELECT v_empresa_id, dv.id, true
  FROM nutriesteticanserp.dashboard_views dv
  WHERE dv.slug IN ('ventas','inventario');

  RAISE NOTICE 'Provisión Nutriestéticans completada para empresa_id=%', v_empresa_id;
END $$;
