# Operación: lo que sigue abierto

- **Acta de restauración:** `docs/operaciones/actas/` sólo tiene la plantilla.
  Desde el 20 de diciembre de 2026 el CI falla si no hay un acta manual.
  Procedimiento en `docs/operaciones.md` §4.
- **Exports sin uso:** `REINTENTAR_RECORDATORIO`, `REINTENTAR_RECORDATORIO_TITULO`,
  `REINTENTAR_RECORDATORIO_MENSAJE` y `REINTENTANDO_RECORDATORIO` en
  `src/lib/glosario.ts` quedaron del reintento manual de SMS, que se retiró.
  Se pueden borrar.
- **SMS con resultado desconocido:** no hay pantalla de conciliación; se revisa
  a mano en Twilio y no se reenvía solo (`docs/operaciones.md` §6). Es una
  decisión, no un error.
