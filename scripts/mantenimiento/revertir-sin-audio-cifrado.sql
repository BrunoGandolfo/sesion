-- Reversión administrativa de 20261006120000_sin_audio_cifrado.
-- Vuelve a crear audio_clave_encrypted y audio_iv en sesiones_clinicas,
-- VACÍAS: el DROP no dejó datos que recuperar. Sólo hace falta si se vuelve
-- a publicar un código anterior a la migración que todavía las nombre en el
-- esquema de Prisma (con @ignore, el cliente no las lee, pero
-- `prisma migrate diff` las vería como drift). Saca su registro de
-- _prisma_migrations para que el historial coincida con la base.
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
ALTER TABLE "sesiones_clinicas" ADD COLUMN IF NOT EXISTS "audio_clave_encrypted" BYTEA,
ADD COLUMN IF NOT EXISTS "audio_iv" BYTEA;
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261006120000_sin_audio_cifrado';
COMMIT;
