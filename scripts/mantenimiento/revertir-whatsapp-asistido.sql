-- Reversión administrativa de 20261008120000_whatsapp_asistido.
-- Borra la tabla avisos_whatsapp (con sus filas: el registro de qué
-- recordatorios abrió la profesional por WhatsApp se pierde), la columna
-- configuraciones.canal_recordatorio (toda organización vuelve a SMS) y los
-- dos enums. Los envíos ya cancelados por canal quedan cancelados: son
-- terminales y su motivo es texto. Saca su registro de _prisma_migrations
-- para que el historial coincida con la base.
-- Antes de correrla, publicar un código anterior a la migración: el actual
-- lee la columna en cada despacho de SMS.
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
DROP TABLE IF EXISTS "avisos_whatsapp";
ALTER TABLE "configuraciones" DROP COLUMN IF EXISTS "canal_recordatorio";
DROP TYPE IF EXISTS "tipo_aviso_whatsapp";
DROP TYPE IF EXISTS "canal_recordatorio";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261008120000_whatsapp_asistido';
COMMIT;
