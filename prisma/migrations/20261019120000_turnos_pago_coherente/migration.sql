-- B10 de la revisión del dominio: el pago de un turno es coherente en la
-- base. Pagado ⇔ tiene fecha y método de pago (un pendiente no puede tener
-- los dos). Hasta acá lo garantizaba sólo el código (cobrar-turno.ts
-- escribe estado, fecha y método en la misma sentencia; deshacer el cobro
-- los vuelve a null juntos), y una escritura a mano podía dejar un turno
-- "pagado" sin fecha, que no cuenta en ningún mes de cobro.
--
-- NO es destructiva: no borra ni cambia filas. ADD CONSTRAINT valida la
-- tabla entera, así que exige que no haya filas incoherentes; en producción
-- se verificó que hay cero con:
--   SELECT id FROM turnos
--   WHERE (pago_estado = 'pagado') <> (pago_fecha IS NOT NULL AND pago_metodo IS NOT NULL);
-- El código de release ya escribe sólo combinaciones que pasan el CHECK, así
-- que puede verlo antes de que avance release.
--
-- solapamiento-turnos.test.ts lo compara con la base real.

ALTER TABLE "turnos" ADD CONSTRAINT "turnos_pago_coherente_check"
  CHECK ((pago_estado = 'pagado') = (pago_fecha IS NOT NULL AND pago_metodo IS NOT NULL));
