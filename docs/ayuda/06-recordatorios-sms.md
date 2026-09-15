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

## Si la paciente responde

El SMS sale de un número de servicio. Las respuestas comunes no llegan a tu
consulta: el mensaje indica tu teléfono para los cambios.
**BAJA**, **STOP** o **CANCELAR** sí se procesan: dejan de mandarse mensajes a
ese número y se responde: *"Listo: no vas a recibir más mensajes de este número."*

## Ver el estado

Abrí el turno en Agenda. El recordatorio más reciente puede mostrar:

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

Puede aparecer el motivo: teléfono inválido, línea fija, falta de señal, baja
solicitada o un problema del servicio. Si no queda tiempo para avisar, comunicate
por tu cuenta con la paciente. No hay reintento manual de SMS.

## Reintentos y cambios de horario

Los problemas transitorios se reintentan con esperas crecientes mientras el
aviso todavía es útil. No hay un límite fijo de tres intentos. Un resultado
**No sabemos si salió** requiere revisión de quien administra Sesión y **no se
reenvía solo**, para evitar duplicados.

Si movés un turno y un aviso anterior ya había salido, se programa un **cambio de horario** que dice
**cambió el horario de tu sesión**, con la fecha y hora nuevas. Es intencional,
aunque los dos mensajes sean del mismo día. Su texto es fijo.

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
-->
