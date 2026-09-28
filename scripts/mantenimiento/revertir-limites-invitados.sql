-- OBSOLETO SALVO REVERSIÓN DE CÓDIGO. No correr contra el código actual.
--
-- Hoy el código LEE estas columnas: src/app/api/_lib/casos-uso/estado-prueba.ts,
-- src/lib/cuenta-registro-db.ts y el tope de grabaciones de
-- src/app/api/_lib/casos-uso/audio.ts (prepararAudio). Borrarlas con ese
-- código publicado rompe el alta por invitación y la grabación. Sólo tiene
-- sentido si antes se despliega un código que haya sacado los límites de
-- prueba (src/lib/limites-prueba.ts) y deje de leerlas.
--
-- Reversión administrativa de 20260917120000_limites_invitados.
-- Saca los contadores y la marca de prueba; no toca invitaciones ni sesiones.
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
ALTER TABLE "organizaciones" DROP COLUMN "de_invitacion", DROP COLUMN "grabaciones_iniciadas";
ALTER TABLE "usuarios" DROP COLUMN "invitaciones_generadas", DROP COLUMN "ultima_invitacion_en";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260917120000_limites_invitados';
COMMIT;
