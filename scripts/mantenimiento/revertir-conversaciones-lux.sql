-- Reversión administrativa de 20261021120000_conversaciones_lux.
-- BORRA todas las conversaciones guardadas con Lux: no hay copia en otro
-- lado (el texto sólo vive cifrado en esta tabla). Sólo hace falta si se
-- vuelve a publicar un código anterior a la migración; con el código de la
-- memoria de Lux publicado, Lux da 500. Saca su registro de
-- _prisma_migrations para que el historial coincida con la base.
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
DROP TABLE "conversaciones_lux";
DROP TYPE "rol_conversacion_lux";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021120000_conversaciones_lux';
COMMIT;
