# Cobros

**Para qué sirve.** Registrar el pago de cada sesión, ver lo que entró en el mes
y quién te debe.

## Cobrar una sesión

Se cobra **desde el turno**, y **Cobrar** aparece en varios lugares:

- En **Hoy**, en la fila del turno en cuanto pasó su hora, y en la tarjeta de
  ahora cuando la sesión ya quedó realizada.
- En la **Agenda**, abriendo el turno.
- En la **ficha**, en **Turnos y pagos** para los turnos realizados sin cobrar, y
  en la sesión de hoy de la pestaña **Sesiones** cuando la nota ya está
  aprobada.

Hay seis métodos de pago: **Efectivo**, **Transferencia**, **MercadoPago**,
**Débito**, **Crédito** y **Otro**. El selector se llama distinto según dónde
estés: **Método de pago** en Hoy, *"¿Cómo pagó?"* en la Agenda y **Cobrar
sesión** en la ficha. Al elegir uno:

- En **Hoy** se dibuja un tilde verde, el sheet se cierra solo y aparece
  *"Cobrado. Ese ya está."*
- En la **Agenda** se cierra y aparece *"Cobro registrado"*.
- En la **ficha** se dibuja un tilde y aparece *"Cobrado"*.

**Cobrar cierra la sesión.** Si el turno todavía figuraba *Agendado* y la hora ya
pasó, al cobrar queda **realizado** en el mismo movimiento, y su recordatorio se
cancela.

Si el pago no entra, no se dibuja ningún tilde. En **Hoy** el aviso siempre es
*"No se pudo cobrar. Probá de nuevo."*; en la Agenda y en la ficha aparece el
motivo concreto. Después de cobrar desde una fila de Hoy un turno que seguía
**Agendado**, la fila puede seguir ofreciendo **Cobrar**: el cobro ya quedó
registrado, recargá antes de volver a tocar.

## Cuándo NO se puede cobrar

- La hora del turno todavía no llegó: *"La sesión todavía no empezó: vas a poder
  cobrarla cuando llegue la hora"*.
- El turno está cancelado, o la paciente no vino: *"no hay sesión para cobrar"*.
- Ya está cobrado: *"El turno ya está cobrado"*.

En **Hoy** estos motivos no se ven: aparece el aviso general.

## La pantalla de Cobros

Arriba, dos importes: **Cobraste este mes** y **Sin cobrar**. Debajo de cada
importe aparece la cantidad de sesiones correspondiente. Más abajo hay dos
solapas:

- **Te deben** — *"Son N sesiones sin cobrar."* y la lista **ordenada por monto**,
  de mayor a menor: nombre, cuántas sesiones sin cobrar, cuánto hace y el total.
  Si ya le recordaste el cobro, dice *"Avisado hace N días"*. Si no debe nadie:
  *"Nadie te debe"*.
- **Cobros del mes** — cada pago con su fecha, la paciente, el **método** y el
  monto. Si todavía no cobraste nada: *"Todavía no cobraste este mes"*.

## Las tres zonas de la deuda

Según los días de atraso de la deuda más vieja: **hasta 14 días** en verde
(*"hace 5 días"*), **15 a 30** en dorado y **31 o más** en terracotta, dentro de
una píldora. En la computadora, el menú lateral muestra al lado de **Cobros** una
píldora terracotta, por ejemplo *"2 · +30 días"*, con cuántas personas están en
esa última zona.

Un turno **Agendado** cuya hora ya pasó todavía no cuenta como deuda: empieza a
contar cuando lo grabás o lo cobrás.

## "Recordar cobro"

En **Te deben**, cada persona con teléfono cargado tiene el botón **Recordar
cobro**. Se abre *"¿Mandarle este mensaje?"* con el texto y el número al que
sale. Revisá el mensaje y confirmá con **Enviar SMS**: se programa un **SMS**.

El recordatorio de cobro **sale solo cuando vos confirmás el envío**; el del
turno se programa automáticamente. El texto del cobro no es configurable.
La confirmación indica que quedó programado, no que ya llegó: *"Aviso programado.
Sale en los próximos minutos."* Se admite un pedido por paciente y por día: si ya
lo pediste, dice *"Ya pediste este aviso hoy. No se programó otro."*

El mensaje se arma **al salir**, con la deuda de ese momento. Si en el medio te
pagó todo, el aviso se cancela solo.
**Avisado** se cuenta desde que el servicio aceptó el mensaje; no significa
que la paciente lo leyó. Si pidió la baja, la app no programa el cobro.

## Qué hace la app por detrás

El pago se registra sobre el turno, con su fecha y su método. La deuda no es un
número guardado: se calcula sumando los turnos realizados y sin cobrar de cada
persona, y los días de atraso salen de la sesión impaga más vieja.

## Si cobraste por error

Abrí el turno cobrado en Agenda o en **Ficha → Turnos y pagos** y tocá
**Deshacer cobro**. Revisá la confirmación: el monto vuelve a la deuda y el
turno queda sin cobrar. No vuelve a Agendado ni se reactiva su recordatorio.

## Lo que NO hace

- **No cobra plata ni emite factura ni recibo.**
- **No cobra parcial**: se cobra la tarifa completa del turno, no un monto libre.
- **No cambia el mensaje de "Recordar cobro"**: no es configurable.
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
src/app/api/_lib/casos-uso/recordar-cobro.ts
src/app/api/_lib/casos-uso/despachar-sms.ts
src/app/(dashboard)/pacientes/[id]/_components/sesiones-tab.tsx
src/types/domain.ts
src/components/layout/sidebar.tsx
-->
