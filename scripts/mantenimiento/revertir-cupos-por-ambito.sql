-- Reversión administrativa de 20261008120000_cupos_por_ambito.
-- BORRA los cupos de Lux (ambito = 'lux'): son contadores diarios, no hay
-- nada que recuperar; lo peor es que una usuaria recupere preguntas a Lux
-- por el resto del día. Los de Lupita quedan como estaban. Sólo hace falta
-- si se vuelve a publicar un código anterior a la migración (que reserva con
-- ON CONFLICT (user_id, dia)). Saca su registro de _prisma_migrations para
-- que el historial coincida con la base.
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
DELETE FROM "cupos_ayuda" WHERE "ambito" = 'lux';
ALTER TABLE "cupos_ayuda" DROP CONSTRAINT "cupos_ayuda_pkey",
DROP COLUMN "ambito",
ADD CONSTRAINT "cupos_ayuda_pkey" PRIMARY KEY ("user_id", "dia");
DROP TYPE "ambito_cupo";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261008120000_cupos_por_ambito';
COMMIT;
