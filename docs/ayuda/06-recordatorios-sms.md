# El recordatorio por SMS

**Para qué sirve.** Cada turno agendado avisa a la paciente por SMS. Acá está
cuándo sale, cómo se escribe el mensaje y qué hacer si no salió.

## Cuándo sale

En **Tu consultorio → Recordatorio → Cuándo se avisa** elegís uno de tres
momentos, y vale para todos los turnos:

- **El día anterior** — *a las 20:00 del día antes*.
- **Dos días antes** — *a las 20:00 de dos días antes*.
- **La misma mañana** — *a las 8:00 del día del turno*.

Una excepción, y la app la dice: *"Si el turno es antes de las 8:00, el aviso
sale la tarde anterior a las 20:00: a esa hora la paciente ya estaría viniendo."*

Todo se calcula en **hora de Montevideo**.

## El mensaje y sus fichas

En **Mensaje** escribís el texto y agregás **fichas** (píldoras verdes) con los
botones **+ Nombre**, **+ Fecha**, **+ Hora** y **+ Dirección**: se insertan
donde está el cursor. El mensaje que viene por defecto es:

> Hola **Nombre**, te recordamos tu sesión el **Fecha** a las **Hora**. Para
> cambios, comunicate con **Tu nombre** al **Tu teléfono**

Debajo, en **"Así lo recibe la paciente"**, ves el mensaje armado con datos de
ejemplo (Lucía, martes 21 de abril, 10:00) y tus datos reales.

**La línea de contacto es obligatoria**: si la borrás, la app la vuelve a agregar
al final antes de enviar. Y el mensaje no puede quedar vacío.

## Por qué la paciente no puede contestar

El SMS sale de un número de servicio, no de tu teléfono. **Si responde, esa
respuesta no llega a ninguna parte y vos no la ves.** Por eso todo mensaje
termina diciendo a quién y a qué número escribir: ese es el camino de vuelta.

## Ver el estado de un recordatorio

Abrí el turno en la agenda. En un turno **agendado** aparece el bloque
**Recordatorio** con la fecha y uno de estos estados:

- **Todavía no salió** — está en cola, esperando su hora.
- **Saliendo** — se está enviando en este momento.
- **Enviado** — salió, con la fecha y hora de envío.
- **No se pudo enviar** — falló todas las veces que tenía (en terracotta).
- **Cancelado** — el turno dejó de estar programado, o se reprogramó.

## Si no salió

Con el estado **No se pudo enviar**, y solo si el turno **sigue agendado y
todavía no pasó**, aparece **Volver a intentarlo**: *"Se pone otra vez en la cola
y sale en la próxima pasada, en unos minutos. Si vuelve a fallar, lo vas a ver
acá."*

Si el turno ya pasó, o está cancelado o marcado "No vino", el botón no aparece:
avisar de una sesión que ya no existe es peor que no avisar.

## Qué hace la app por detrás

Cada **5 minutos** la app manda los recordatorios que llegaron a su hora, por
Twilio. Cada uno tiene hasta **3 intentos**; si los agota queda en "No se pudo
enviar". Si una corrida se corta, la siguiente lo retoma sin gastarle un intento.

## Lo que NO hace

- **No manda WhatsApp.** El canal es SMS, también en **Recordar cobro**.
  El recordatorio de cobro sale solo cuando vos confirmás el envío en Cobros.
- **No recibe respuestas.**
- **No manda mails** ni notificaciones.
- **No hay un recordatorio distinto por paciente**: el momento y el texto son los
  mismos para todos.
- **No avisa de un turno creado para una sesión que ya está empezando**: esos no
  generan recordatorio.
- **No manda un segundo aviso** el mismo día si ya salió uno.

<!-- fuentes:
src/lib/recordatorios-programacion.ts
src/lib/sms-texto.ts
src/lib/recordatorios-sms.ts
src/lib/fechas-montevideo.ts
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/config/_components/editor-recordatorio.tsx
src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx
src/app/api/cron/recordatorios/route.ts
src/app/api/_lib/casos-uso/enviar-recordatorios.ts
src/app/api/_lib/casos-uso/recordatorios-del-turno.ts
src/app/api/recordatorios/[id]/reintentar/route.ts
src/lib/glosario.ts
vercel.json
-->
