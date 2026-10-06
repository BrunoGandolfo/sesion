-- DESTRUCTIVA: el código que usaba esto salió en e64915f
-- Fase 2 de la limpieza del audio cifrado en el teléfono (15 al 18/9/2026).
-- Desde e64915f (fase 1, publicada) ninguna línea de la app ni del worker
-- lee ni escribe estas columnas: estaban con @ignore. No hay datos que
-- recuperar: el audio ya no se cifra y las claves que quedaban eran de
-- audios borrados o por borrar. Reversión: scripts/mantenimiento/
-- revertir-sin-audio-cifrado.sql (vuelve a crear las columnas vacías).
ALTER TABLE "sesiones_clinicas" DROP COLUMN "audio_clave_encrypted",
DROP COLUMN "audio_iv";
