# Cobros

**Para qué sirve.** Registrar el pago de cada sesión, ver lo que entró en el mes
y quién te debe.

## Cobrar una sesión

Se cobra **desde el turno**, y el turno se abre desde tres lugares: en **Hoy**
(botón **Cobrar** de la tarjeta de ahora o de la fila), en la **Agenda** (abrí el
turno) y en la **ficha del paciente** (en **Turnos y pagos**, o en la sesión de
hoy de la pestaña Sesiones).

Después se abre **Método de pago** con seis opciones: **Efectivo**,
**Transferencia**, **MercadoPago**, **Débito**, **Crédito**, **Otro**. Tocás una,
se dibuja un tilde verde sobre esa opción y el sheet se cierra solo. Aparece
**"Cobrado"** (o *"Cobro registrado"* si lo hiciste desde la agenda).

**Cobrar cierra la sesión.** Si el turno todavía figuraba *Agendado* y la hora ya
pasó, al cobrar queda **realizado** en el mismo movimiento, y su recordatorio se
cancela.

Si el pago no entra, aparece *"No se pudo cobrar. Probá de nuevo."* y no se
dibuja ningún tilde: el tilde confirma lo que pasó de verdad.

## Cuándo NO se puede cobrar

- La hora del turno todavía no llegó: *"La sesión todavía no empezó: vas a poder
  cobrarla cuando llegue la hora"*.
- El turno está cancelado, o la paciente no vino: *"no hay sesión para cobrar"*.
- Ya está cobrado: *"El turno ya está cobrado"*.

## La pantalla de Cobros

Arriba, cuatro números: **Cobraste este mes**, **Te deben**, **Sesiones
cobradas** (del mes) y **Sin cobrar** (cantidad de sesiones). Debajo, dos
solapas:

- **Te deben** — *"Son N sesiones sin cobrar."* y la lista **ordenada por monto**,
  de mayor a menor: nombre, cuántas sesiones sin cobrar, cuánto hace y el total.
  Si no debe nadie: *"Nadie te debe"*.
- **Cobros del mes** — cada pago con su fecha, la paciente, el **método** y el
  monto. Si todavía no cobraste nada: *"Todavía no cobraste este mes"*.

## Las tres zonas de la deuda

Según los días de atraso de la deuda más vieja: **1 a 14 días** en verde (*"hace
5 días"*), **15 a 30** en dorado, **31 o más** en terracotta, dentro de una
píldora. En la computadora, el menú lateral muestra al lado de **Cobros** un
número rojo con cuántas personas están en esa última zona.

## "Recordar cobro"

En **Te deben**, cada persona con teléfono cargado tiene el botón **Recordar
cobro**. Abre **WhatsApp** en tu teléfono, con el mensaje ya escrito:

> Hola [Nombre], ¿cómo estás? Te escribo para recordarte que tenés N sesiones
> pendientes de pago por un total de $ …. Cualquier duda estoy a disposición.
> [Tu nombre]

**El mensaje no se manda solo: lo mandás vos desde WhatsApp.** Es distinto del
recordatorio del turno, que sale por SMS y sí es automático.

## Qué hace la app por detrás

El pago se registra sobre el turno, con su fecha y su método. La deuda no es un
número guardado: se calcula sumando los turnos realizados y sin cobrar de cada
persona, y los días de atraso salen de la sesión impaga más vieja.

## Lo que NO hace

- **No hay botón para deshacer un cobro.** Si registraste un pago por error, hoy
  no se corrige desde la pantalla.
- **No cobra plata ni emite factura ni recibo.**
- **No cobra parcial**: se cobra la tarifa completa del turno, no un monto libre.
- **No cambia el mensaje de "Recordar cobro"**: no es configurable.
- **No manda WhatsApp por su cuenta.**
- Deshacer un cobro **no vuelve el turno a "Agendado"**: haber cobrado por error
  no significa que la sesión no ocurrió.

<!-- fuentes:
src/app/(dashboard)/cobros/_components/cobros-view.tsx
src/app/(dashboard)/_components/sheet-metodo-pago.tsx
src/app/(dashboard)/_components/dashboard.tsx
src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx
src/app/(dashboard)/pacientes/[id]/_components/turnos-pagos-tab.tsx
src/app/api/_lib/casos-uso/cobrar-turno.ts
src/app/api/turnos/[id]/cobrar/route.ts
src/app/api/deudores/route.ts
src/lib/deudas.ts
src/components/layout/sidebar.tsx
-->
