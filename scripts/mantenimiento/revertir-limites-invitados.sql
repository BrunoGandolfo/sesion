-- Reversión administrativa de 20260917120000_limites_invitados.
-- Saca los contadores y la marca de prueba; no toca invitaciones ni sesiones.
-- Antes hay que desplegar un código que no lea estas columnas.
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
ALTER TABLE "organizaciones" DROP COLUMN "de_invitacion", DROP COLUMN "grabaciones_iniciadas";
ALTER TABLE "usuarios" DROP COLUMN "invitaciones_generadas", DROP COLUMN "ultima_invitacion_en";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260917120000_limites_invitados';
COMMIT;
