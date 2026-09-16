# Cuando algo falla

**Para qué sirve.** Síntoma por síntoma: qué revisar y qué podés hacer,
sin dar por guardado lo que todavía no se confirmó.

---

## No puedo entrar

**Ves:** *"Email o contraseña incorrectos"* y debajo *"Después de varios intentos
seguidos el acceso queda bloqueado unos minutos."*

Ese mensaje es el mismo para contraseña equivocada, email mal escrito, acceso
bloqueado por intentos y también un problema momentáneo del servidor.

**Qué hacer:**
1. Revisá el email: sin espacios de más.
2. Probá la contraseña con cuidado.
3. Si ya probaste varias veces seguidas, **esperá 15 minutos y volvé**. El
   bloqueo se destraba solo. Mientras dura, ni siquiera la contraseña correcta
   entra.
4. Si vuelve a fallar después de esperar, el bloqueo puede ser más largo: 30
   minutos, una hora, o cuatro horas si se repitió mucho en el día.

Si la olvidaste, tocá **¿Olvidaste tu contraseña?** en la entrada y pedí un
enlace por correo. Detalle en `01-entrar-y-cuenta.md`.

---

## La grabación se cortó

### Se interrumpió la captura

**Ves:** el estado **En pausa** y *"La captura se interrumpió. Este tramo puede
estar incompleto; revisá el micrófono antes de reanudar."*

Pasa cuando entra una llamada, otra app se lleva el micrófono, o la pantalla se
bloquea o pasa a otra app. Si el propio micrófono falla, puede decir: *"El
micrófono interrumpió la captura. El último tramo puede estar incompleto."*

**Qué hacer:** lo ya guardado se conserva, cifrado. Elegí **Reanudar grabación**
o **Terminar y enviar**. Durante el corte no se graba, y la recuperación completa
no está garantizada: el tramo que estaba en curso puede quedar incompleto.

### Se cerró el navegador o se apagó el teléfono

**Qué hacer:** volvé a la pantalla de grabar de **ese mismo turno**, en el
**mismo teléfono**. La app recupera lo guardado y dice *"Se recuperó lo guardado.
El tramo que estaba en captura al cerrarse la app puede estar incompleto."*
Después podés **Reanudar grabación** o **Terminar y enviar**. Volver a grabar no
reemplaza la copia anterior.

Si probás desde otro dispositivo, dice *"Ya existe audio en el servidor para este
turno. Volvé al dispositivo que conserva la grabación; no se reemplazó nada."*

### No se confirma el envío

**Ves:** *"No pudimos confirmar el envío. La copia cifrada se conserva y se
reintentará."* y el botón **Comprobar y reintentar envío**.

Puede ser la conexión. La app reintenta sola y apenas vuelve la red. Si ya
terminaste, el estado dice **Pendiente de envío** con **Enviar grabación
pendiente**.

**Qué hacer:** poné el teléfono en una conexión buena y mantené la pantalla
abierta hasta ver **Audio recibido**.

### No se pudo guardar un tramo en el teléfono

**Ves:** *"La captura se detuvo porque no se pudo guardar un segmento. Mantené
esta página abierta y reintentá."*

Puede ser falta de espacio en el teléfono. **Qué hacer:** no cierres la pantalla,
liberá espacio si podés y reintentá.

### El micrófono no entregó audio

**Ves:** *"El micrófono no entregó audio para este tramo. No se pudo recuperar;
lo guardado anteriormente se conserva."*

Ese tramo no se recupera. Revisá el micrófono y reanudá.

### No puedo empezar a grabar

- **Falta la autorización** y el botón apagado: la paciente tiene que firmar la
  autorización en la ficha.
- *"Agendá el turno para grabar la sesión"*: no hay turno; agendalo primero.
- *"Esta grabación está abierta en otra pestaña"*: cerrá la otra pestaña.
- *"El micrófono o la pantalla se interrumpieron antes de empezar. Volvé a la app
  y reintentá."*
- *"Este navegador no permite grabar Opus ni AAC"* o *"Este navegador no puede
  impedir dos grabaciones simultáneas. Usá un navegador actualizado."*:
  actualizá el navegador o usá otro.
- Si negaste el permiso del micrófono o no hay micrófono, el navegador puede
  mostrar su propio mensaje, a veces en inglés. Habilitá el permiso del
  micrófono para Sesión en la configuración del navegador y volvé a tocar
  **Grabar sesión**.

### Eliminé la sesión y quiero grabar de nuevo

En el mismo teléfono puede aparecer **Conservar copia y habilitar otra
grabación**. Guarda la copia anterior aparte, sin borrarla, y deja grabar de
nuevo el turno.

---

## La nota no llega

### Sigue diciendo "Escribiendo la nota…"

Es normal que tarde. La pantalla se actualiza sola mientras la sesión está en
proceso.

**Qué hacer:** salí y volvé más tarde. La nota, cuando esté, aparece en **Hoy**,
en el bloque de pendientes, y en la ficha con el chip **Para revisar**.

### Dice "No pudimos escribir la nota"

La sesión quedó **fallida** y debajo figura el motivo. **Reintentar** usa lo que
ya hay: si la transcripción está guardada, no se vuelve a transcribir.
**Eliminar** borra la sesión y lo generado, y programa el borrado del audio; el
turno queda libre para grabar otra vez. No se puede deshacer y queda un registro
de auditoría.

Si se agotaron los reintentos automáticos, el motivo lo dice.

### La nota llegó rara, corta o equivocada

Mientras está en revisión, **Volver a escribirla** pide otra redacción con la
transcripción guardada. Los datos anteriores se conservan durante el proceso;
la pantalla muestra solo *"Escribiendo la nota…"*. Si el problema es puntual,
podés editar la sección antes de aprobar. Una nota aprobada no admite esa
acción.

### No puedo aprobar

El motivo aparece debajo del botón. Marcá **Revisé esta señal** en cada señal y
**Leí las menciones** si aparece el bloque **Frases para revisar**. Si dice *"La
nota cambió. Revisá la versión actual antes de aprobar."*, tocá **Revisar nota
actual**: tus correcciones quedan en **Tu borrador anterior**. Detalle en
`08-la-nota-clinica.md`.

### No llegó Para vos

Abrí **Para vos** desde el selector de la nota. Si dice **No se pudo generar.**,
tocá **Volver a pedir Para vos**; si dice **Todavía no se pidió.**, **Preparar
Para vos**. No rehace la nota ni la transcripción, y funciona también después de
aprobar.

### Dice "Esta sesión todavía no tiene nota."

La sesión existe pero la grabación todavía no terminó de enviarse. Volvé a la
pantalla de grabar de ese turno, en el teléfono donde grabaste, y terminá el
envío.

---

## El SMS no salió

**Dónde mirar:** abrí el turno en la agenda. En un turno agendado aparece el
bloque **Recordatorio** con su estado. En un turno que ya no está agendado ese
bloque no aparece.

**Programado** espera su hora; **Enviando** está intentando salir. **En camino**
indica aceptación del servicio, no entrega. **Entregado** confirma entrega del
operador, no lectura; **No llegó** informa un rechazo posterior.

Con **No salió**, mirá el motivo. Los problemas transitorios ya se reintentan
con esperas mientras el aviso sea útil; no hay botón de reintento manual.
**No sabemos si salió** necesita revisión de quien administra Sesión: no se
reenvía solo. Si el turno está por empezar, comunicate con la paciente por tu
cuenta.

**Cancelado** indica que el aviso pendiente se apagó. Si moviste un turno cuyo
aviso ya salió, se manda un cambio de horario. Un turno creado con fecha ya
pasada no genera recordatorio. Detalle en `06-recordatorios-sms.md`.

---

## Otros mensajes que podés ver

- **"Algo falló. Probá de nuevo."** — un problema puntual de conexión o del
  servidor. Reintentá; si sigue, esperá unos minutos.
- **"No pudimos traer la agenda."** / **"No pudimos traer los cobros."** — la
  pantalla no cargó. Aclara que no se perdió nada (*"Tus turnos no se
  perdieron."* / *"Tus datos no se perdieron."*). Tocá **Reintentar**.
- **"No pudimos abrir la ficha."** — lo mismo, con el motivo y **Reintentar**.
- **"No se pudo cobrar. Probá de nuevo."** (en Hoy) — mirá el turno antes de
  reintentar: puede que el cobro sí haya quedado registrado.
- **Cobraste desde una fila de Hoy y la fila sigue ofreciendo Cobrar.** Pasa con
  un turno que seguía **Agendado** cuando ya había pasado su hora: el cobro quedó
  registrado, pero la pantalla no se actualiza. **No vuelvas a cobrar**: recargá
  la pantalla o revisalo en Cobros. Si tocás de nuevo, aparece *"No se pudo
  cobrar"*.
- **"Hay cambios sin guardar. Revisá los datos y reintentá."** (en Tu consultorio)
  — algún campo quedó vacío o inválido: el nombre, la tarifa o el mensaje del
  recordatorio. Arreglalo y tocá **Reintentar**.
- **"El turno cambió mientras se cobraba. Probá de nuevo."** — se tocó el mismo
  turno desde dos lados a la vez. Volvé a mirar el estado antes de reintentar.
- **"La grabación ya se cerró. Revisá su estado."** — se quiso grabar un turno
  cuya grabación ya se envió. Mirá la ficha: probablemente la nota ya está en
  camino.

---

## Una regla general

No confundas una opción de reintento con una garantía de recuperación.
Podés perder lo que no llegó a grabarse o las correcciones de una nota si salís
sin aprobar. Si hay una grabación pendiente, volvé al mismo turno en el mismo
teléfono antes de intentar otra cosa. Comprobá el estado guardado antes de salir
y pedí ayuda si sigue fallando.

<!-- fuentes:
src/app/(auth)/login/page.tsx
src/lib/login-intentos.ts
src/lib/intentos-acceso.ts
src/app/(dashboard)/grabar/[turnoId]/page.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/lib/audio/grabadora.ts
src/lib/audio/captura.ts
src/app/api/_lib/casos-uso/audio.ts
src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/para-vos-view.tsx
src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx
src/app/(dashboard)/agenda/_components/agenda-view.tsx
src/app/(dashboard)/cobros/_components/cobros-view.tsx
src/app/(dashboard)/pacientes/[id]/_components/paciente-detail-view.tsx
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/_components/dashboard.tsx
src/app/(dashboard)/_components/datos.ts
src/components/ui/session-row.tsx
src/app/api/_lib/casos-uso/cobrar-turno.ts
src/lib/glosario.ts
-->
