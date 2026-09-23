-- DESTRUCTIVA: el código que usaba esto salió en b4b9975
--
-- NO es destructiva: la marca está porque scripts/ci/migraciones.mjs lee
-- `ALTER TABLE … DROP CONSTRAINT` como un DROP, y Postgres no tiene otra
-- forma de cambiar la expresión de un CHECK que borrarlo y volver a crearlo.
-- No borra ni cambia filas: sólo AMPLÍA los valores admitidos (agrega 120).
-- Toda fila que pasaba el CHECK viejo pasa el nuevo, así que el ADD valida
-- la tabla sin rechazar nada. El código de b4b9975 (release al escribir
-- esto) sólo inserta 30/45/50/60/90: que vea este esquema antes de que
-- avance release no le cambia nada, por eso puede ir en el mismo
-- despliegue que el código que ofrece 120.
--
-- Prisma 5 manda este archivo entero como una sola transacción (verificado
-- contra Postgres 17: un error después del DROP deja el CHECK viejo en su
-- lugar), así que no hay un instante sin CHECK.
--
-- Los valores son exactamente DURACIONES de src/lib/constantes-turno.ts;
-- solapamiento-turnos.test.ts los compara contra la base.

ALTER TABLE "turnos" DROP CONSTRAINT "turnos_duracion_check";

ALTER TABLE "turnos" ADD CONSTRAINT "turnos_duracion_check"
  CHECK ("duracion" IN (30, 45, 50, 60, 90, 120));
