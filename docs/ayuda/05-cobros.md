# Cobros

**Para qué sirve.** Registrar el pago de cada sesión, ver lo que entró en el mes
y quién te debe.

## Cobrar una sesión

El cobro es **por sesión**. Si la paciente te paga una sesión que ya pasó, lo más
directo es **Cobros → Te deben → Registrar pago** (más abajo). Además, **Cobrar**
aparece en el turno, en varios lugares:

- En **Hoy**, en la fila del turno y en la tarjeta de ahora, en cuanto pasó su
  hora, esté *Agendado* o ya realizado. En la tarjeta, **Cobrar** aparece al
  lado de **Grabar sesión**, no en lugar de.
- En la **Agenda**, abriendo el turno.
- En la **ficha**, en **Turnos y pagos** para los turnos realizados sin cobrar, y
  en la sesión de hoy de la pestaña **Sesiones** cuando la nota ya está
  aprobada.

Hay seis métodos de pago: **Efectivo**, **Transferencia**, **MercadoPago**,
**Débito**, **Crédito** y **Otro**. El selector se llama distinto según dónde
estés: **Método de pago** en Hoy y en Cobros, *"¿Cómo pagó?"* en la Agenda y **Cobrar
sesión** en la ficha. Al elegir uno:

- En **Hoy** y en **Cobros** se dibuja un tilde verde, el sheet se cierra solo y
  aparece *"Cobrado. Ese ya está."*
- En la **Agenda** se cierra y aparece *"Cobro registrado"*.
- En la **ficha** se dibuja un tilde y aparece *"Cobrado"*.

**Cobrar cierra la sesión.** Si el turno todavía figuraba *Agendado* y la hora ya
pasó, al cobrar queda **realizado** en el mismo movimiento, y su recordatorio se
cancela.

Si el pago no entra, no se dibuja ningún tilde. En **Hoy** el aviso siempre es
*"No se pudo cobrar. Probá de nuevo."*; en la Agenda y en la ficha aparece el
motivo concreto. En **Hoy**, el turno cobrado se actualiza en la pantalla sin
recargar, y **Este mes** suma el cobro.

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
  Cada persona tiene el botón **Registrar pago**. Si ya le recordaste el cobro,
  dice *"Avisado hace N días"*. Si no debe nadie: *"Nadie te debe"*.
- **Cobros del mes** — cada pago con su fecha, la paciente, el **método** y el
  monto. Si todavía no cobraste nada: *"Todavía no cobraste este mes"*.

## Registrar un pago desde "Te deben"

Cuando una paciente te paga, no hace falta ir a su ficha:

1. En **Te deben**, tocá **Registrar pago** en su fila.
2. Se abre *"¿Qué sesiones te pagó?"* con sus sesiones sin cobrar, de la más
   vieja a la más nueva, cada una con su **fecha** y su **monto**. Marcá las que
   te pagó. Si tiene una sola, ya viene marcada; si tiene varias, **Marcar
   todas** las marca de una vez. Abajo ves cuántas marcaste y el total.
3. Tocá **Elegir método de pago** y elegí cómo pagó. El método vale para todas
   las sesiones marcadas.

Se dibuja el tilde, aparece *"Cobrado. Ese ya está."* y la pantalla se actualiza
sola: baja **Sin cobrar**, sube **Cobraste este mes**, y la persona sale de la
lista si ya no debe nada. Hasta que elegís el método no se registra nada:
**Cancelar**, o cerrar el selector sin elegir, no cobra.

Si marcaste varias y una no se pudo registrar, la app se detiene ahí y te dice
cuántas quedaron: *"Quedaron registradas 1 de 2. Probá de nuevo con las que
faltan."*

## Las tres zonas de la deuda

Según los días de atraso de la deuda más vieja: **hasta 14 días** en verde
(*"hace 5 días"*), **15 a 30** en dorado y **31 o más** en terracotta, dentro de
una píldora. En la computadora, el menú lateral muestra al lado de **Cobros** una
píldora terracotta, por ejemplo *"2 · +30 días"*, con cuántas personas están en
esa última zona.

Un turno **Agendado** cuya hora ya pasó todavía no cuenta como deuda: empieza a
contar cuando lo grabás o lo cobrás.

## "Recordar cobro por SMS"

En **Te deben**, debajo de **Registrar pago**, cada persona con teléfono cargado
tiene la acción **Recordar cobro por SMS**. Tocarla **no envía nada**: se abre
*"¿Mandarle este mensaje?"* con el texto y el número al que sale. Revisá el
mensaje y confirmá con **Enviar SMS**: recién ahí se programa un **SMS**. Con
**Cancelar** no sale nada.

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

Abrí el turno cobrado en Agenda o, en la ficha, en **Datos → Turnos y pagos** y tocá
**Deshacer cobro**. Revisá la confirmación: el monto vuelve a la deuda y el
turno queda sin cobrar. No vuelve a Agendado ni se reactiva su recordatorio.

## Lo que NO hace

- **No cobra plata ni emite factura ni recibo.**
- **No cobra parcial**: se cobra la tarifa completa del turno, no un monto libre.
- **No cambia el mensaje de "Recordar cobro por SMS"**: no es configurable.
- **No registra un pago "a cuenta" de toda la deuda**: se marcan sesiones enteras.
- Deshacer un cobro **no vuelve el turno a "Agendado"**: haber cobrado por error
  no significa que la sesión no ocurrió.

<!-- fuentes:
src/app/(dashboard)/cobros/_components/cobros-view.tsx
src/app/(dashboard)/_components/sheet-metodo-pago.tsx
src/app/(dashboard)/_components/dashboard.tsx
src/app/(dashboard)/_components/datos.ts
src/app/(dashboard)/_components/card-ahora.tsx
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
