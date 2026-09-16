-- =============================================================================
-- Nutriestéticans — clon de estructura del schema `heraclioerp` → `nutriesteticanserp`
-- =============================================================================
-- Crea el schema `nutriesteticanserp` como copia EXACTA de la estructura de
-- `heraclioerp` (tablas, columnas, constraints, índices, funciones, triggers,
-- políticas RLS, secuencias, tipos), SIN copiar filas de datos operativos.
--
-- Requiere que `public.neura_clone_schema_full(source, target, copy_data boolean)`
-- exista en la base (misma función usada para clonar previamente
-- `instemaq` → `heraclioerp`).
--
-- Ejecutar UNA sola vez con conexión con privilegios elevados
-- (rol `supabase_admin`/superusuario) — el clonador crea objetos owned por el
-- rol propietario del schema fuente.
--
-- Total independencia: NO toca `public`, ni `heraclioerp`, ni ningún otro schema.
-- Sólo crea `nutriesteticanserp` y sus objetos.
-- =============================================================================

SELECT public.neura_clone_schema_full('heraclioerp', 'nutriesteticanserp', false);
