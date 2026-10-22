# Recordatorios

**Para qué sirve.** Cada turno agendado se le recuerda a la paciente por
WhatsApp: la app te prepara el mensaje en **Hoy** y lo mandás vos desde tu
teléfono. Acá está qué turnos aparecen, cuándo, cómo se escribe el mensaje y
qué ves en el turno.

## WhatsApp desde tu teléfono

En **Hoy** aparece el bloque **Recordatorios para hoy**, después de la agenda
del día. Si no hay a quién avisar, dice *"No hay turnos para avisar hoy"*. La
app no manda mensajes por su cuenta: el recordatorio sale de tu WhatsApp.

**Qué turnos aparecen.** Los que ya llegaron a su momento de aviso según lo
que elegiste en **Cuándo se avisa**: con **El día anterior**, hoy aparecen los
turnos de mañana; con **Dos días antes**, los de pasado mañana; con **La misma
mañana**, los de hoy. También los que agendaste cuando la hora del aviso ya
había pasado (por ejemplo, un turno de esta tarde agendado esta mañana). Un
turno que no avisaste el día que le tocaba sigue en la lista hasta que lo
avises o hasta que empiece. No aparecen los turnos que ya empezaron, los
cancelados ni las pacientes archivadas.

Cada fila tiene la paciente, el día y la hora del turno, y cómo está:

- **Sin avisar** — todavía no lo abriste.
- **Avisado 10:32** — lo abriste hoy a esa hora. Al día siguiente ya no
  aparece.
- **Sin teléfono** — la paciente no tiene teléfono cargado. La fila se ve
  apagada, sin botón, con **Ver ficha →** para cargarlo.

**Abrir WhatsApp** abre la conversación con la paciente y el mensaje ya
escrito: en el teléfono, en la app de WhatsApp; en la computadora, en WhatsApp
Web. El mensaje lo arma la app con los datos del turno; lo ves antes de
mandarlo, y podés cambiarlo ahí mismo. **Lo mandás vos**: la app no lo envía.

Tocar el botón deja la fila en **Avisado** con la hora. "Avisado" quiere decir
que **abriste** el WhatsApp de ese turno, no que el mensaje salió: eso pasa
cuando tocás enviar en WhatsApp, y la app no lo ve. WhatsApp se abre siempre,
aunque anotar el aviso falle; si falla, la fila lo dice: *"Se abrió WhatsApp,
pero no quedó anotado."*

Como el mensaje sale de tu número, **las respuestas te llegan a tu WhatsApp**,
como cualquier conversación.

Si movés un turno después de abrir su WhatsApp, la paciente tiene el horario
viejo: el aviso nuevo es un **cambio de horario** y aparece enseguida en la
lista como **Sin avisar**, falte lo que falte para el turno. Su mensaje dice
que el turno cambió: *"Consultorio Tu nombre / Nombre, tu turno cambió al
Fecha a las Hora. Cambios: llamar al Tu teléfono"*. Su texto es fijo.

## Cuándo se avisa

En **Tu consultorio → Recordatorio → Cuándo se avisa** elegís uno de tres
momentos, y vale para todos los turnos:

- **El día anterior** — la pantalla dice *"Desde las 20:00 del día antes"*.
- **Dos días antes** — *"Desde las 20:00 de dos días antes"*.
- **La misma mañana** — *"Desde las 08:00 del día del turno"*.

Desde esa hora el turno aparece en **Recordatorios para hoy**, y lo mandás
cuando te quede cómodo.

Una excepción, y la app la dice cuando elegís **La misma mañana**: *"Si el
turno es a las 08:00 o antes, se avisa la tarde anterior, desde las 20:00: a la
mañana no llegaría antes del turno."* Ese turno aparece en la lista del día
anterior.

Cambiar la opción vale enseguida, también para los turnos ya agendados: la
lista se arma cada vez con lo que elegiste.

Todo se calcula en **hora de Montevideo**.

## El mensaje y sus fichas

En **Mensaje** escribís el texto y agregás **fichas** (píldoras verdes) con los
botones **+ Nombre**, **+ Fecha**, **+ Hora** y **+ Dirección**: se insertan
donde está el cursor. El mensaje que viene por defecto es:

> Consultorio **Tu nombre**
> **Nombre**, tu turno es el **Fecha** a las **Hora**.
> **Dirección**
> Cambios: llamar al **Tu teléfono**

Debajo, en **"Así lo recibe la paciente"**, ves el mensaje armado con datos de
ejemplo (Lucía, martes 21 de abril, 10:00) y tus datos reales.

**El mensaje siempre empieza con *"Consultorio"* y tu nombre**, y **siempre
termina con la línea de contacto** *"Cambios: llamar al"* y tu teléfono: si las
borrás, la app las vuelve a agregar. El mensaje no puede quedar vacío.

El texto se arma **cuando se carga la lista en Hoy**: si cambiás el mensaje,
también cambia el de los turnos que ya estaban agendados.

## Ver el estado en el turno

Abrí el turno en Agenda. Mientras el turno sigue agendado, el bloque
**Recordatorio** dice *"Pendiente de avisar por WhatsApp"* o *"Avisado por
WhatsApp el 14/10"*, según si ya abriste su WhatsApp para la fecha que tiene
ahora. Si lo moviste después de avisar, vuelve a decir pendiente: hay que
mandarle el cambio de horario.

Cancelar, cobrar o marcar **No vino** saca el turno de la lista de
recordatorios. Un mensaje que ya mandaste no puede retirarse del teléfono de la
paciente. Un turno creado para una sesión que ya empezó no genera
recordatorio.

## El aviso de cobro

**Recordar cobro por WhatsApp**, en **Cobros**, te abre el mensaje para
mandarlo vos, solo cuando confirmás el envío. No cambia el momento ni el texto
de los recordatorios de turno. El detalle está en `05-cobros.md`.

<!-- fuentes:
src/lib/recordatorios-programacion.ts
src/lib/recordatorio-texto.ts
src/app/api/_lib/casos-uso/recordatorios-whatsapp.ts
src/app/api/_lib/casos-uso/recordar-cobro.ts
src/app/api/recordatorios/whatsapp/route.ts
src/app/api/recordatorios/whatsapp/[turnoId]/route.ts
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/config/_components/opciones-radio.tsx
src/app/(dashboard)/config/_components/mensaje-recordatorio.tsx
src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx
src/app/(dashboard)/agenda/_components/detalle-datos.ts
src/app/(dashboard)/agenda/_components/detalle-ver.tsx
src/lib/glosario.ts
src/app/(dashboard)/_components/recordatorios-whatsapp.tsx
src/app/(dashboard)/_components/recordatorios-datos.ts
-->
