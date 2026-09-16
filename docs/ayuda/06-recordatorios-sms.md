# El recordatorio por SMS

**Para qué sirve.** Cada turno agendado avisa a la paciente por SMS, si tiene un
celular cargado y no pidió la baja. Acá está cuándo sale, cómo se escribe el
mensaje y qué hacer si no salió.

## Cuándo sale

En **Tu consultorio → Recordatorio → Cuándo se avisa** elegís uno de tres
momentos, y vale para todos los turnos:

- **El día anterior** — la pantalla dice *"A las 20:00 del día antes"*.
- **Dos días antes** — *"A las 20:00 de dos días antes"*.
- **La misma mañana** — *"A las 8:00 del día del turno"*.

**No salen todos a la hora en punto.** Para no mandar todos los avisos del día
en el mismo instante, cada turno tiene su propio corrimiento, de **0 a 14
minutos** después de esa hora, siempre el mismo para ese turno. Además el envío
se revisa cada 5 minutos. Un aviso "de las 20:00" sale en la práctica entre las
20:00 y las 20:20, aproximadamente. En el turno, el recordatorio muestra la hora
que le tocó, por ejemplo *20:07*.

Una excepción, y la app la dice cuando elegís **La misma mañana**: *"Si el turno
es antes de las 8:00, el aviso sale la tarde anterior a las 20:00: a esa hora la
paciente ya estaría viniendo."* Por el corrimiento, lo mismo puede pasar con un
turno entre las 8:00 y las 8:14: si el aviso de la mañana no llega a salir antes
del turno, sale la tarde anterior.

El momento se fija **cuando agendás o reprogramás** el turno. Cambiar la opción
no mueve los avisos ya programados. Si agendás un turno cuando la hora del aviso
ya pasó (por ejemplo, a las 21:00 para mañana con **El día anterior**), el aviso
sale en los minutos siguientes.

Todo se calcula en **hora de Montevideo**.

## El mensaje y sus fichas

En **Mensaje** escribís el texto y agregás **fichas** (píldoras verdes) con los
botones **+ Nombre**, **+ Fecha**, **+ Hora** y **+ Dirección**: se insertan
donde está el cursor. El mensaje que viene por defecto es:

> Consultorio **Tu nombre**
> **Nombre**, tu turno es el **Fecha** a las **Hora**. Cambios: llamar al **Tu teléfono**

Debajo, en **"Así lo recibe la paciente"**, ves el mensaje armado con datos de
ejemplo (Lucía, martes 21 de abril, 10:00) y tus datos reales.

**El mensaje siempre empieza con *"Consultorio"* y tu nombre**, y **siempre
termina con la línea de contacto** *"Cambios: llamar al"* y tu teléfono: si las
borrás, la app las vuelve a agregar antes de enviar. El mensaje no puede quedar
vacío.

El texto se arma **en el momento de enviar**: si cambiás el mensaje, también
cambian los avisos que ya estaban programados y todavía no salieron.

## Si la paciente responde

El SMS sale de un número de servicio. Las respuestas comunes no llegan a tu
consulta: el mensaje indica tu teléfono para los cambios, y la pantalla lo
advierte: *"No pidas respuestas por SMS: no llegan."*
**BAJA**, **STOP** o **CANCELAR** sí se procesan, con o sin mayúsculas: dejan de
mandarse mensajes a ese número y se responde: *"Consultorio: no vas a recibir más
SMS"*.

## Ver el estado

Abrí el turno en Agenda. Mientras el turno sigue agendado, el recordatorio más
reciente puede mostrar:

| Estado | Qué significa |
| --- | --- |
| **Programado** | Espera el momento de salir. |
| **Enviando** | Se está intentando enviar. |
| **En camino** | El servicio lo aceptó; aceptado no es entregado. |
| **Entregado** | El operador confirmó la entrega; no confirma lectura. |
| **No llegó** | El operador informó que no lo entregó. |
| **Cancelado** | El aviso pendiente se canceló. |
| **No salió** | No se pudo enviar; mirá el motivo. |
| **No sabemos si salió** | Se perdió la confirmación y no se puede asegurar el resultado. |

Puede aparecer el motivo: sin teléfono, teléfono inválido, línea fija o número
que no es celular, número inexistente o bloqueado, falta de señal, baja
solicitada o un problema del servicio. Si no queda tiempo para avisar,
comunicate por tu cuenta con la paciente. No hay reintento manual de SMS.

## Reintentos y cambios de horario

Los problemas transitorios se reintentan con esperas crecientes, de 2 a 30
minutos, hasta dos horas antes del turno. No hay un límite fijo de tres
intentos. Con **La misma mañana** y un turno temprano esa ventana es corta: un
primer fallo puede dejarlo directamente en **No salió**. Un resultado
**No sabemos si salió** requiere revisión de quien administra Sesión y **no se
reenvía solo**, para evitar duplicados.

Si movés un turno y un aviso anterior ya había salido, se manda **enseguida** un
**cambio de horario**: *"Consultorio Tu nombre / Nombre, tu turno cambió al Fecha
a las Hora. Cambios: llamar al Tu teléfono"*. Es intencional, aunque los dos
mensajes sean del mismo día. Su texto es fijo.

Cancelar, cobrar o marcar **No vino** cancela los avisos pendientes. Un SMS que
ya salió no puede retirarse del teléfono de la paciente. Un turno creado para
una sesión que ya empezó no genera recordatorio.

**Recordar cobro** usa SMS y sale solo cuando vos confirmás el envío en Cobros:
primero se programa, después se intenta mandar. No cambia el momento ni el
texto de los recordatorios de turno.

<!-- fuentes:
src/lib/recordatorios-programacion.ts
src/lib/sms/texto.ts
src/lib/sms/clasificar.ts
src/app/api/_lib/casos-uso/envios-del-turno.ts
src/app/api/_lib/casos-uso/despachar-sms.ts
src/app/api/_lib/casos-uso/recordar-cobro.ts
src/app/api/sms/envios/route.ts
src/app/api/sms/entrante/route.ts
src/app/api/_lib/casos-uso/sms-webhooks.ts
src/lib/sms/backoff.ts
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/config/_components/mensaje-recordatorio.tsx
src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx
src/lib/glosario.ts
vercel.json
-->
