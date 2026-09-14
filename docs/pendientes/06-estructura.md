# Pendientes del Área 6 (estructura) para integrar al cierre

Textos de pantalla y de ayuda que esta área necesitó y dejó **en el código,
como constantes locales**, porque `glosario.ts` y `docs/ayuda/**` no se tocan
en paralelo (docs/como-trabajamos.md). Quien integre los mueve al glosario y
escribe la ayuda; cada bloque dice dónde está hoy el texto.

## Turnos recurrentes

### Formulario de turno (`src/components/forms/nuevo-turno-form.tsx`)

Constantes `OPCIONES_FRECUENCIA` y `AYUDA_SERIE`:

- Rótulo del control: **Se repite**
- Opciones: **Una vez** · **Cada semana** · **Cada 15 días**
- Ayuda que aparece al elegir una repetición: *Se agendan tres meses de
  turnos, cada uno independiente: podés mover o cancelar cualquiera sin
  tocar el resto.*

### Aviso al agendar (`src/lib/agendar-turno.ts`)

Constantes `SERIE_AGENDADA` y `SERIE_OMITIDAS`. Un turno suelto sigue
diciendo `TURNO_AGENDADO` del glosario.

- *N turnos agendados*
- Una fecha que chocó: *No se agendó el 29 sep: ya había un turno a esa hora.*
- Varias: *No se agendaron 2 fechas por choque de horario: 29 sep, 13 oct.*

### Detalle del turno (`src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx`)

Constantes `CANCELAR_SERIE`, `CANCELAR_SERIE_TITULO`, `CANCELAR_SERIE_MENSAJE`,
`CANCELAR_SERIE_ACCION`, `SERIE_CANCELADA`:

- Botón (solo si el turno es de una serie y está programado): **Cancelar el
  resto de la serie**
- Confirmación: título *¿Cancelar este turno y los que siguen?*; mensaje *Se
  cancelan este turno y todos los siguientes de la serie que todavía estén
  programados, con sus recordatorios. Los ya realizados y los anteriores
  quedan como están.*; acción **Cancelar el resto**; mientras envía
  *Cancelando…*
- Aviso al terminar: *Se cancelaron N turnos de la serie* / *Se canceló 1
  turno de la serie*

### Mensajes de la API (`src/app/api/_lib/casos-uso/`)

- `cancelar-serie-turno.ts`: `MENSAJE_SIN_SERIE` = *Este turno no es parte de
  una serie* (400).
- `turnos.ts`: `MENSAJE_NO_REABRIR` y `MENSAJE_SOLO_PROGRAMADOS` son los
  textos que ya devolvía el PATCH; solo cambiaron de archivo.
- `hot-words.ts`: `MENSAJE_HOT_WORD_DUPLICADA`, `MENSAJE_FALTA_PACIENTE`,
  ídem.

### Ayuda de Lupita (`docs/ayuda/`)

Falta una entrada sobre turnos recurrentes. Lo que tiene que decir, en el
tono de la ayuda:

- Al agendar podés elegir que el turno se repita cada semana o cada 15 días.
  Se agendan de una vez tres meses de turnos.
- Cada turno de la serie es independiente: moverlo, cobrarlo o cancelarlo no
  afecta a los demás.
- Si una fecha de la serie ya tenía otro turno a esa hora, esa fecha no se
  agenda y la app te lo dice al terminar; la podés agendar a mano en otro
  horario.
- Desde cualquier turno de la serie podés cancelar ese y todos los que
  siguen ("Cancelar el resto de la serie"). Los ya realizados y los
  anteriores no se tocan.
- Cuando se acaban los tres meses no se agrega nada solo: agendás una serie
  nueva.

## Verificación de la ayuda (`src/lib/__tests__/ayuda-vigente.test.ts`)

Cuando exista la entrada de ayuda de arriba, agregarle al corpus de ese test
las frases con número o regla: "tres meses", "cada semana o cada 15 días",
"cada turno es independiente".

## Costuras con otras ramas (para quien fusiona)

### Con `f3-identidad` (Área 3) y `f3-operacion` (Área 5): resueltas

`origin/main` (62aaa09) ya trae las dos ramas y esta rama las fusionó. Los
casos de uso llaman a `cifrarTurno/cifrarPaciente/cifrarHotWord(id, campos)` y
`hashTermino` reales, leen `notas`, `termino` y `datos` por campo lógico, y
los avisos por SMS pasan por `envios-del-turno.ts`
(`programarEnvioDelTurno`, `reprogramarEnvioDelTurno`,
`cancelarEnviosDelTurno`, con `tx`), también en `cobrar-turno.ts`, que el
Área 5 dejaba para esta área. `POST /api/turnos` ya no devuelve el campo
`recordatorio` (nadie lo leía y el modelo no existe): la respuesta es
`data: TurnoCreado`.

El test de series reemplaza `envios-del-turno` con un doble que anota las
llamadas (una por turno creado, una por turno cancelado); el cifrado es el
real. `config-contrato.test.ts` y `solapamiento-turnos.test.ts`, que ejercen
rutas de turnos y configuración, mockean `@/app/api/_lib/auth` como el resto
de los tests de `main`.

### Con el guardián `rutas-sin-prisma.test.ts`

`EXCEPCIONES_TEMPORALES` lista las rutas de las otras áreas que aún llaman a
Prisma, con su dueño. Al fusionar cada rama, sacar de la lista las que
migraron; el test avisa si una entrada ya está limpia.
