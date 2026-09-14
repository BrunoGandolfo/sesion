# Pendientes que deja el Área 5 (operación) para otras áreas

Fecha: 14 de septiembre de 2026 · Rama `f3-operacion`.

El SMS durable quedó implementado y probado del lado del servidor
(`src/lib/sms/`, `src/app/api/_lib/casos-uso/{despachar-sms,envios-del-turno,recordar-cobro}.ts`,
`src/app/api/sms/{callback,entrante,envios}/`, `src/app/api/cron/recordatorios/`).
Lo que sigue son las piezas que tocan archivos de otras áreas y que el Área 5
no cambió a propósito: se listan con lo que hay que hacer y con qué reemplazarlo.

## 1. Área 6 (turnos): cablear las tres funciones

Los archivos que todavía importan `casos-uso/recordatorios-del-turno.ts`
(borrado) son `src/app/api/turnos/route.ts`, `src/app/api/turnos/[id]/route.ts`
y `src/app/api/_lib/casos-uso/cobrar-turno.ts`. Las tres funciones nuevas
viven en `src/app/api/_lib/casos-uso/envios-del-turno.ts`, se llaman
**dentro de la misma transacción** que escribe el turno (reciben el `tx`),
son idempotentes y devuelven `void` (cancelar devuelve cuántas apagó):

```ts
programarEnvioDelTurno(tx, { turnoId, organizationId, pacienteId, fechaTurno, ahora }): Promise<void>
//   Turno nuevo, o reabierto (realizado/ausente → programado) sin tocar la fecha.
//   Si la fecha ya pasó no crea nada. Si la paciente no tiene teléfono, la fila
//   nace `fallido` con el motivo (la pantalla lo puede mostrar en el acto).
//   Un envío cancelado que nunca salió se revive; uno que salió no se toca.

reprogramarEnvioDelTurno(tx, { turnoId, organizationId, pacienteId, fechaTurno, fechaTurnoPrevia, ahora }): Promise<void>
//   La fecha cambió. Apaga lo pendiente de la fecha vieja y programa el aviso
//   de la nueva. Si para la fecha previa ya había salido un aviso (aceptado,
//   entregado, no_entregado o desconocido), el nuevo es `cambio_de_horario` y
//   sale en el próximo tick; si no, es el recordatorio de siempre a su hora.
//   Con la misma fecha no hace nada.

cancelarEnviosDelTurno(tx, turnoId, motivo?): Promise<number>
//   El turno dejó de estar programado (cancelado, realizado, ausente).
//   Apaga `pendiente` y `enviando`; no toca lo que ya salió.
```

Reemplazos concretos:

| Hoy | Reemplazo |
| --- | --- |
| `programarRecordatorio({ prisma: tx, turnoId, organizationId, fechaTurno, ahora })` en `turnos/route.ts` | `programarEnvioDelTurno(tx, { turnoId, organizationId, pacienteId, fechaTurno, ahora })`. Ahora necesita `pacienteId` (lo tiene el turno recién creado). Devuelve `void`: el campo `recordatorio` de la respuesta del POST deja de existir (nadie lo lee). |
| `cerrarRecordatoriosDelTurno(tx, id)` en `turnos/[id]/route.ts` cuando el turno deja de estar programado | `cancelarEnviosDelTurno(tx, id)` |
| `cerrarRecordatoriosDelTurno` + `programarRecordatorio` en `turnos/[id]/route.ts` cuando cambia la fecha | `reprogramarEnvioDelTurno(tx, { turnoId, organizationId, pacienteId, fechaTurno: updated.fecha, fechaTurnoPrevia: actual.fecha, ahora })` |
| ídem cuando el turno se reabre sin cambiar la fecha | `programarEnvioDelTurno(tx, { … fechaTurno: updated.fecha, ahora })` (revive el cancelado) |
| `turnoSigueProgramado` importado de `recordatorios-del-turno` | Misma función, ahora exportada desde `envios-del-turno.ts` |
| `cerrarRecordatoriosDelTurno(tx, turnoId)` en `cobrar-turno.ts` | `cancelarEnviosDelTurno(tx, turnoId)` |

Los tests que fijaban el comportamiento viejo (`turno-recordatorios.test.ts`,
`recordatorios-del-turno.test.ts`) se borraron; el nuevo es
`src/lib/__tests__/envios-del-turno.test.ts`.

**Contrato C5 (teléfono normalizado).** `envios-del-turno.ts` congela
`Paciente.telefono` tal cual está. Si el formulario de paciente no valida
E.164 al escribir, un teléfono mal cargado termina `fallido` en el primer
intento con "el teléfono no es válido" (21211): funciona, pero el lugar
correcto de la validación es el formulario.

## 2. Área 3 (middleware): dos rutas públicas

`POST /api/sms/callback` y `POST /api/sms/entrante` las llama Twilio sin
sesión; se autentican solas con `X-Twilio-Signature`. Hay que sacarlas del
`matcher` de `src/middleware.ts` (agregar `api/sms/callback|api/sms/entrante`
a la lista de exclusiones). **Sólo esas dos**: `GET /api/sms/envios` es de la
pantalla y va con sesión. Hasta que esto no esté, Twilio recibe una
redirección a `/login` y ningún envío pasa de `aceptado` a `entregado`.

De paso: `api/seed` sigue en las exclusiones y la ruta ya no existe (se
borró `src/app/api/seed/route.ts`; el seed es `prisma/seed.ts` a mano).

## 3. Frontend (agenda, cobros, configuración)

- `src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx` pide
  `GET /api/recordatorios?turnoId=` (borrado) y ofrece
  `POST /api/recordatorios/[id]/reintentar` (borrado). Reemplazo:
  `GET /api/sms/envios?turnoId=<id>` devuelve la lista, el más reciente
  primero, con `{ id, motivo, estado, programadoEn, intentos, aceptadoEn,
  cerradoEn, codigoProveedor, motivoNoEnvio }`. No hay botón de reintento:
  con backoff hasta la ventana útil, un `fallido` ya intentó todo; lo que
  reemplaza al botón es mostrar `motivoNoEnvio`. Hoy la pantalla degrada sin
  romperse (el 404 cae en el `catch` y no dibuja el bloque).
- `src/app/(dashboard)/cobros/_components/cobros-view.tsx` pide
  `GET /api/sms/estado` (borrado). Ya cae en `{ ok: true }` ante el error, así
  que el botón se muestra siempre, que es lo que se quiere: sacar la llamada.
  Además, `POST /api/pacientes/[id]/recordar-cobro` ya no devuelve
  `enviadoEn` sino `{ envioId, creado, programadoEn, sesiones, monto }`: el
  aviso entra a la cola y sale en el próximo tick del cron (≤ 5 min).
  `ultimoAvisoEn` de `/api/deudores` sigue igual y ahora sale de
  `envios_sms` (último `aceptadoEn` de un aviso de cobro aceptado o
  entregado).
- `src/types/domain.ts`: `Recordatorio` y `RecordatorioEstado` describen el
  modelo borrado. El nuevo es `EnvioDelTurno` en
  `casos-uso/envios-del-turno.ts` y el enum `EstadoEnvioSms` de Prisma.
- Estados a mostrar en la pantalla del turno (ocho): `pendiente`, `enviando`,
  `aceptado` (NO es "llegó"), `entregado`, `no_entregado`, `cancelado`,
  `fallido`, `desconocido` ("no sabemos si salió": nunca se reenvía solo).

## 4. Textos nuevos (glosario y ayuda)

El Área 5 no toca `src/lib/glosario.ts` ni `docs/ayuda/`. Textos que hoy
viven en código y deberían pasar por el glosario:

- Respuesta TwiML a "BAJA" (`src/app/api/sms/entrante/route.ts`):
  «Listo: no vas a recibir más mensajes de este número.»
- Error 409 de recordar cobro (`casos-uso/recordar-cobro.ts`):
  «La paciente pidió no recibir más mensajes».
- Motivos de no envío (`motivo_no_envio`, para la pantalla): «la paciente no
  tiene teléfono cargado», «el turno dejó de estar programado», «el turno se
  reprogramó: sale un aviso nuevo», «el turno ya pasó», «la paciente pidió no
  recibir más mensajes», «no se pudo enviar antes de la sesión: el servicio de
  SMS no respondió a tiempo», «no hay deuda vigente para avisar», «una corrida
  se cortó después de llamar al servicio de SMS: no se sabe si el mensaje
  salió», «El SMS salió, pero el turno se cerró mientras se enviaba…», y la
  tabla de `src/lib/sms/clasificar.ts` («el teléfono no es válido», «el
  teléfono no es un celular», «el teléfono estaba apagado o sin señal», …).
- Plantilla fija del cambio de horario (`src/lib/sms/texto.ts`,
  `PLANTILLA_CAMBIO_DE_HORARIO`): «Hola {{nombre}}, cambió el horario de tu
  sesión: ahora es el {{fecha}} a las {{hora}}. Para cambios, comunicate con
  {{profesional}} al {{telefonoConsultorio}}».
- Nombres de estado para la pantalla (sugeridos): aceptado → «En camino»,
  entregado → «Entregado», no_entregado → «No llegó», desconocido → «No
  sabemos si salió», fallido → «No salió», cancelado → «Cancelado».

`docs/ayuda/06-recordatorios-sms.md` dice tres cosas que ya no son ciertas:
«No recibe respuestas» (ahora BAJA/STOP/CANCELAR da de baja el teléfono),
«No manda un segundo aviso el mismo día si ya salió uno» (si movés el turno y
el aviso ya salió, sale un aviso de **cambio de horario**, a propósito), y
el botón «Volver a intentarlo» (ya no existe). Y le falta: «Aceptado no es
entregado: la confirmación del operador llega después».

## 5. Lo que el Área 5 dejó abierto a propósito

- **No hay conciliación automática de `desconocido`** (`conciliar-sms.ts`
  del diseño no se escribió): decisión del dueño, un `desconocido` lo mira
  una persona. Cómo resolverlo a mano está en `docs/operaciones.md` §7. Una
  pantalla para hacerlo sin SQL es trabajo de UI.
- **`tsc` global sigue rojo** por código de otras áreas que habla con el
  esquema anterior (sesión clínica, worker, contexto clínico, `next-auth/react`
  en la UI). Los archivos del Área 5 compilan limpios; el CI de `main` no va a
  estar verde hasta que las demás áreas integren.
- **Acta de restauración**: `scripts/ci/acta-vigente.mjs` avisa que no hay
  ninguna en `docs/operaciones/actas/`; el primer ensayo tiene fecha límite
  2026-12-20.
