# Finanzas

**Para qué sirve.** Ver cuánta plata entró y cuánto trabajaste en un mes, en un
año o desde que empezaste, sin hacer cuentas. Los números salen solos de la
agenda y de los cobros: no hay nada que cargar aparte.

## Cómo se llega

- **En el teléfono:** entrá a **Cobros** y tocá la tarjeta **Finanzas del
  consultorio**, arriba de la lista. La tarjeta ya te dice cuánto cobraste este
  mes y la diferencia con el mes pasado. Para volver, tocá **Cobros**, arriba a
  la izquierda.
- **En la computadora:** **Finanzas**, en el menú del costado, debajo de
  **Cobros**.

## Las dos platas: lo que entró y lo que trabajaste

Es lo único que hay que entender antes de mirar el resto. La pantalla muestra
dos números que se parecen y no son el mismo:

- **Lo que entró** es la plata que te pagaron. Cada cobro cuenta en el mes en
  que lo **registraste como pagado**. Es lo que dice el banco.
- **Lo que trabajaste** es el valor de las sesiones que diste. Cada sesión
  cuenta en el mes en que **ocurrió**, esté cobrada o no. Es lo que dice la
  agenda.

Un ejemplo: una sesión del 20 de agosto que la paciente te paga el 3 de
septiembre suma a **Lo que trabajaste** de agosto y a **Lo que entró** de
septiembre. Los dos números están bien, y son distintos.

## Elegir el período

Arriba hay cuatro opciones: **Este mes**, **Este año**, **12 meses** y
**Todo**. La pantalla abre en **12 meses**. Con **Este año** aparecen dos
flechas al lado del año para ir a años anteriores, hasta el primero en que hay
algo registrado. Si es el año en curso, va de enero hasta este mes. **Todo**
va desde tu primer turno o cobro hasta hoy, y muestra una barra por año. No se
puede elegir un rango de fechas a mano.

## Lo que entró

El número grande es lo cobrado en el período, con cuántas sesiones cobradas
fueron. Debajo hay dos comparaciones, en pesos y en porcentaje:

- **Contra el período anterior**: los meses inmediatamente anteriores, la misma
  cantidad. Con **Este mes**, dice **Contra el mes anterior**.
- **Contra el mismo período del año pasado**: los mismos meses, un año antes.

Si en aquellos meses no había nada registrado, dice *"Sin datos para
comparar"*: un cero ahí diría que cobraste cero, cuando en realidad todavía no
usabas Sesión. Si aquel período fue cero, aparece la diferencia en pesos y no el
porcentaje.

## Lo que trabajaste

El valor de las sesiones realizadas en el período y, debajo, cuánto de eso ya
cobraste y cuánto falta. Después, tres números:

- **Sesiones realizadas**.
- **Pacientes**: cuántas personas distintas vinieron. Quien vino en marzo y en
  abril cuenta una sola vez en el año.
- **Tarifa promedio**: lo trabajado dividido las sesiones. Si no diste
  sesiones, aparece "—".

La frase *"De cada diez sesiones que diste, cobraste N"* mira las sesiones que
diste en el período y cuántas de esas ya están cobradas. Un cobro viejo que
entró este mes no la cambia.

Aparte, en una línea, los turnos con **No vino** (y lo que valían) y los
cancelados. No suman a lo trabajado. Si cobraste un turno en el que la paciente
no vino, ese pago sí está en **Lo que entró**.

## Las barras

**Mes a mes** (o **Año a año** con **Todo**): una barra por período, del valor
de lo que trabajaste. La parte llena es lo **Ya cobrado** y la parte en trazo,
lo que **Falta cobrar**.

Tocá una barra y se abre el detalle de ese período: lo que entró, lo que
trabajaste, lo ya cobrado, lo que falta, las pacientes y la tarifa promedio. Si
la barra es de un mes, abajo aparece *"Lo que entró en…"* con cada cobro de ese
mes: la paciente, el monto, la fecha y el método. En las barras de años se ven
sólo los números.

## Te deben hoy

La deuda de **hoy**, no la del período que estás mirando: es la misma deuda
que ves en Cobros. Está partida en tres tramos, según los días desde la
sesión: **Hasta 30 días**, **De 31 a 90 días** y **Más de 90 días**, cada uno
con sesiones, monto y pacientes. Una paciente con una sesión vieja y una nueva
aparece en los dos tramos. Estos tramos no son las zonas de colores de Cobros.
**Ver a quiénes** te lleva a Cobros, donde está la lista con nombres.

## Cómo te pagan

Lo que entró en el período, repartido por método de pago (**Efectivo**,
**Transferencia**, **MercadoPago**, **Débito**, **Crédito**, **Otro**, o **Sin
método** si el cobro no lo dijo), de mayor a menor, con una barra que muestra
qué parte del total es cada uno.

## ¿Cuánto gané?

Finanzas te dice cuánto **entró**, no cuánto ganaste: Sesión no conoce los
gastos del consultorio. Y los montos están en pesos de cada momento, sin ajuste
por inflación, así que comparar años lejanos subestima los viejos. Las dos
cosas están dichas al pie de la pantalla.

## Lo que NO hace

- **No ajusta por inflación.**
- **No conoce gastos, metas ni presupuestos**: no calcula ganancia.
- **No exporta** a planilla ni a PDF.
- **No deja elegir un rango de fechas a mano**: sólo los cuatro períodos.
- **No muestra nada clínico**: ni notas, ni transcripciones, ni el Recorrido.
- **Lupita no ve tus números**: te puede explicar cómo leer esta pantalla, pero
  no sabe cuánto cobraste.

<!-- fuentes:
docs/contrato-finanzas.md
src/app/(dashboard)/finanzas/_components/finanzas-view.tsx
src/app/(dashboard)/finanzas/_components/bloques.tsx
src/app/(dashboard)/finanzas/_components/barras.tsx
src/app/(dashboard)/finanzas/_components/sheet-periodo.tsx
src/app/(dashboard)/finanzas/_components/periodo.ts
src/app/(dashboard)/cobros/_components/tarjeta-finanzas.tsx
src/app/api/_lib/casos-uso/finanzas.ts
src/components/layout/sidebar.tsx
src/lib/glosario.ts
-->
