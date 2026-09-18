-- DESTRUCTIVA: el código que usaba esto salió en 4de7b06
--
-- El grabador vuelve a un solo archivo por sesión: el inventario de segmentos
-- (audio_segmentos, con su columna continuacion) deja de existir y el IV del
-- archivo pasa a la sesión. La tabla se vacía con la sesión de cada grabación
-- que quedó a medias con el diseño anterior; sus objetos en R2 siguen bajo el
-- prefijo <org>/<sesion>/ y los borra el trabajo borrar_audio_r2 al eliminar.

ALTER TABLE "sesiones_clinicas" ADD COLUMN "audio_iv" BYTEA;

DROP TABLE "audio_segmentos";
