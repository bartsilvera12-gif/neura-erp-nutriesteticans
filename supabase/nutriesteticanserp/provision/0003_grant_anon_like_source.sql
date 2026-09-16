-- =============================================================================
-- Nutriestéticans — igualar permisos del rol `anon` al schema fuente
-- =============================================================================
-- El clonador otorga privilegios a `authenticated` y `service_role` pero NO a
-- `anon`. La app usa `anon` en rutas públicas (browser sin sesión); sin estos
-- grants PostgREST responde 401/42501.
--
-- Seguridad: NO afecta el aislamiento — las políticas RLS filtran fila por
-- fila; nutriesteticanserp no contiene datos operativos.
-- Idempotente.
--
-- IMPORTANTE: aplicar con conexión `supabase_admin`/superusuario (las tablas
-- son propiedad de ese rol). Con `postgres` los GRANT corren sin error pero
-- sin efecto.
-- =============================================================================

GRANT USAGE ON SCHEMA nutriesteticanserp TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA nutriesteticanserp TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA nutriesteticanserp TO anon;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA nutriesteticanserp TO anon;
