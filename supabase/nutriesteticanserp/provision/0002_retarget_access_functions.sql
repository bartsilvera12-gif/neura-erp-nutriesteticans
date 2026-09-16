-- =============================================================================
-- Nutriestéticans — corrección de referencias heredadas en funciones de acceso
-- =============================================================================
-- El schema `nutriesteticanserp` se clonó desde `heraclioerp` (que a su vez viene de
-- `ferrecolor`) y arrastra `search_path` heredado. Los cuerpos de las funciones
-- de RLS YA referencian `nutriesteticanserp.*` de forma calificada (el clonador
-- reescribe el nombre del schema), pero se retarget-ea el search_path para
-- dejar todo explícito.
--
-- Idempotente. Requiere conexión con rol propietario `supabase_admin` /
-- superusuario.
-- =============================================================================

ALTER FUNCTION nutriesteticanserp.jwt_email_normalized() SET search_path TO 'nutriesteticanserp';
ALTER FUNCTION nutriesteticanserp.empresa_id_actual()    SET search_path TO 'nutriesteticanserp';
ALTER FUNCTION nutriesteticanserp.es_super_admin()        SET search_path TO 'nutriesteticanserp';

-- Guard heredado específico de otros tenants (si existiera). No aplica a
-- nutriesteticanserp; se elimina defensivamente por si el clonador lo copió.
DROP FUNCTION IF EXISTS nutriesteticanserp.neura_enlodemari_block_other_empresas();
