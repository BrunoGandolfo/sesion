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

### Con `f3-identidad` (Área 3): firmas que estos casos de uso ya llaman

Los casos de uso importan, con la firma exacta de esa rama, funciones que en
`main` todavía no existen. `tsc` queda rojo en esos archivos hasta la fusión:

| Firma | Módulo | La llama |
| --- | --- | --- |
| `cifrarTurno(id, { notas })` → `{ id, notasEncrypted }` | `@/lib/prisma-encryption` | `casos-uso/crear-turno.ts`, `casos-uso/turnos.ts` |
| `cifrarPaciente(id, { notas })` → `{ id, notasEncrypted }` | `@/lib/prisma-encryption` | `casos-uso/pacientes.ts` |
| `cifrarHotWord(id, { termino })` → `{ id, terminoEncrypted }` | `@/lib/prisma-encryption` | `casos-uso/hot-words.ts` |
| `hashTermino(termino): Promise<string>` | `@/lib/hot-words` | `casos-uso/hot-words.ts` |
| campos lógicos `notas` (pacientes y turnos), `termino` (hot words) y `datos` (sesiones clínicas) en `select` y en las filas leídas | extensión `withEncryption` | `domain.ts` (`toTurno`, `toPacienteConDeuda`), `casos-uso/obtener-dashboard.ts`, `casos-uso/hot-words.ts` |

Esa rama además editó `src/app/api/{pacientes,turnos,hot-words}/**/route.ts`
para llamar a esas funciones desde la ruta. En la fusión ganan las versiones
de `f3-estructura` (las rutas son finas y las llamadas ya están en los casos
de uso); de sus cambios en esos seis `route.ts` no hay nada que conservar.

El test `src/lib/__tests__/crear-serie-turno.test.ts` reemplaza `cifrarTurno`
con un doble **solo si no existe**: al fusionar usa el real sin tocar nada.

### Con `f3-operacion` (Área 5): las tres funciones del SMS durable

`docs/pendientes/05-operacion.md` §1 pide cablear `envios-del-turno.ts` en
las rutas de turnos. Esas llamadas ahora viven en los casos de uso, en
líneas marcadas `COSTURA con el área 5`:

| Hoy (`recordatorios-del-turno.ts`) | Reemplazo (`envios-del-turno.ts`) | Dónde |
| --- | --- | --- |
| `programarRecordatorio({ prisma: tx, turnoId, organizationId, fechaTurno, ahora })` | `programarEnvioDelTurno(tx, { turnoId, organizationId, pacienteId, fechaTurno, ahora })` | `crear-turno.ts` (por cada turno de la serie); `turnos.ts` rama `reabierto` |
| `cerrarRecordatoriosDelTurno(tx, id)` + `programarRecordatorio(…)` al cambiar la fecha | `reprogramarEnvioDelTurno(tx, { turnoId, organizationId, pacienteId, fechaTurno: updated.fecha, fechaTurnoPrevia: actual.fecha, ahora })` | `turnos.ts` rama `fechaCambio` |
| `cerrarRecordatoriosDelTurno(tx, id)` al dejar de estar programado | `cancelarEnviosDelTurno(tx, id)` | `turnos.ts`; `cancelar-serie-turno.ts` (uno por turno cancelado) |
| `turnoSigueProgramado` | misma función, exportada desde `envios-del-turno.ts` | `turnos.ts` |

`POST /api/turnos` ya no devuelve el campo `recordatorio` (nadie lo leía y el
modelo no existe): la respuesta es `data: TurnoCreado`.

El test de series reemplaza `recordatorios-del-turno` con un doble que anota
las llamadas (una por turno creado, una por turno cancelado). Al cablear las
tres funciones hay que apuntar ese doble al módulo nuevo.

### Con el guardián `rutas-sin-prisma.test.ts`

`EXCEPCIONES_TEMPORALES` lista las rutas de las otras áreas que aún llaman a
Prisma, con su dueño. Al fusionar cada rama, sacar de la lista las que
migraron; el test avisa si una entrada ya está limpia.
