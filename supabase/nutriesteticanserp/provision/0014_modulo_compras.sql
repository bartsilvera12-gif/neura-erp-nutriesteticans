-- =============================================================================
-- Nutriestéticans — habilitar el módulo Compras
-- =============================================================================
-- Idempotente. Solo toca nutriesteticanserp.empresa_modulos de esta empresa.
-- Mismo patrón que 0013_modulo_reportes.sql.
-- =============================================================================

UPDATE nutriesteticanserp.empresa_modulos em
   SET activo = true
  FROM nutriesteticanserp.modulos m
 WHERE em.modulo_id = m.id
   AND m.slug = 'compras'
   AND em.empresa_id = '33308550-2d5b-4137-b2bd-d2b331ae555d';

INSERT INTO nutriesteticanserp.empresa_modulos (empresa_id, modulo_id, activo)
SELECT '33308550-2d5b-4137-b2bd-d2b331ae555d'::uuid, m.id, true
  FROM nutriesteticanserp.modulos m
 WHERE m.slug = 'compras'
   AND NOT EXISTS (
     SELECT 1
       FROM nutriesteticanserp.empresa_modulos em
      WHERE em.empresa_id = '33308550-2d5b-4137-b2bd-d2b331ae555d'
        AND em.modulo_id = m.id
   );

SELECT m.slug, em.activo
  FROM nutriesteticanserp.empresa_modulos em
  JOIN nutriesteticanserp.modulos m ON m.id = em.modulo_id
 WHERE em.empresa_id = '33308550-2d5b-4137-b2bd-d2b331ae555d'
 ORDER BY m.slug;
