# Pendientes de la rama turnos-120

La agenda acepta turnos de 120 minutos (`DURACIONES` en
`src/lib/constantes-turno.ts` y el CHECK de la migración
`20260923120000_turnos_duracion_120`). Lo que sigue lo tiene que cambiar el
dueño de cada archivo; esta rama no lo tocó.

## Ayuda (`docs/ayuda/**`)

`docs/ayuda/03-agenda-y-turnos.md`, línea 22. Hoy dice:

    3. Elegí la **Duración**: 30, 45, 50, 60 o 90 minutos.

Tiene que decir:

    3. Elegí la **Duración**: 30, 45, 50, 60, 90 o 120 minutos.

Importa además por Lupita: `src/lib/ayuda-corpus.ts` arma su corpus desde
`docs/ayuda/**`, así que mientras esta línea no cambie, si la profesional le
pregunta qué duraciones hay, Lupita contesta sin la de 120.

Ningún test ata esta línea a `DURACIONES` (`ayuda-vigente.test.ts` lee el
03 pero no mira duraciones): si el cambio se olvida, nada se pone rojo.

## Comentario viejo en `src/app/api/_lib/domain.ts`

Línea 81, comentario de `toTurno`: dice `(IN (30, 45, 50, 60, 90), el mismo
DURACIONES de constantes-turno)`. El código de abajo usa `esDuracion`, así
que funciona con 120. Sólo el comentario quedó viejo. Propuesta: `(el mismo
DURACIONES de constantes-turno)`, sin repetir la lista.

## Agenda y formularios

No hace falta cambiar nada. Se comprobó en Chromium a 390 y 1280 px con un
turno de 120 creado desde el formulario:

- Semana (sólo en escritorio; en el celular la agenda es día y mes): el
  bloque va de 10:00 a 12:00, alto de dos horas (126 px), y el de las 12:00
  queda pegado debajo sin encimarse.
- Día, a los dos anchos: la fila dice "10:00 · 120 min".
- Selector del formulario: seis botones. A 390 px cada uno mide 50 px y
  "120′" entra sin recortarse (scrollWidth = clientWidth). No hay desborde
  horizontal de la página.
