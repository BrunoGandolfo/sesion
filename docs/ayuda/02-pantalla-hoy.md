# La pantalla de Hoy

**Para qué sirve.** Es la primera pantalla: la sesión que viene o está en
curso, la agenda del día, lo que espera una acción tuya, y dos números del día
y del mes.

## Lo que ves, de arriba abajo

Si tu consultorio se creó con una invitación, arriba de todo hay un aviso de la
prueba: cuántas de las **15 sesiones** llevás grabadas, cuántas te quedan cuando
son 3 o menos, y cuando llegaste al tope. Ver `11-tu-consultorio.md`.

1. **Tu cabecera** — tu avatar con tus iniciales, tu primer nombre y, debajo, el
   saludo con la fecha corta: *Buen día* hasta las 12, *Buenas tardes* hasta las
   19 y *Buenas noches* después. Tocar el nombre no hace nada: a **Tu
   consultorio** se entra por el **engranaje** de arriba a la derecha.
2. **El día** — el día de la semana y, al lado, *"3 sesiones en el día"* o
   *"sin sesiones agendadas"*.
3. **La tarjeta de ahora** — borde verde a la izquierda, arriba de todo. Es la
   sesión en curso, o la próxima del día. Si ya no queda ninguna: *"No queda
   ninguna sesión por delante hoy."* La tarjeta tiene el nombre, la modalidad,
   la duración, la tarifa, la hora en grande y un chip:
   - **"En curso"** (verde, con un punto que late) — la hora ya empezó y todavía
     no terminó.
   - **"Enseguida"** (gris) — es el próximo turno y todavía no empezó.
   Debajo puede aparecer la señal de riesgo, *"Última vez (…):"* y *"Para la
   próxima:"*, tomadas de la última nota aprobada. Son dos líneas: si el
   resumen es más largo lo dice (*"Hay más."*), y si hay una nota sin revisar
   o una propuesta del Recorrido sin decidir que ese resumen todavía no
   incluye, también lo dice, con el enlace **Preparar sesión**.
   Después, los botones:
   - Si la nota de ese turno **falló**, espera **revisión** o se está
     **escribiendo**, eso es lo único que se ofrece: **Nota fallida · Ver qué
     pasó**, **Para revisar**, o *Procesando la sesión de …* (sin botón, con
     un anillo que gira).
   - Si no, **Grabar sesión** y **Cobrar** no se reemplazan: pueden estar los
     dos a la vez. **Grabar sesión** aparece mientras el turno sea de hoy y
     todavía no haya una grabación terminada de él, **aunque la hora ya haya
     pasado**: si empezás cinco minutos tarde, el botón sigue ahí. **Cobrar**
     aparece en cuanto empezó la hora del turno y no está cobrado, aunque
     todavía figure como agendado; si también se puede grabar, va al lado,
     más discreto.
   - Si la paciente no firmó la autorización, en lugar de **Grabar sesión**
     aparece **Firmar autorización**, que lleva a la ficha. Si ya no hay nada
     que grabar y hay que cobrar, se muestra **Cobrar** y al lado **Falta la
     autorización →**.
   - Si ya está todo hecho, un chip **"Nota lista"**.
   Siempre están además **Preparar sesión** (abre la ficha en modo
   preparación) y el enlace **Ver ficha →**.
4. **Agenda del día** — una fila por turno, en orden de hora, con el botón
   **Agendar** y, en la computadora, **Ver semana →**. Cada fila muestra la hora,
   la duración, la paciente, la modalidad y la tarifa, y a la derecha lo que
   corresponde hacer (ver abajo). Si no hay turnos: *"Hoy no hay nada
   agendado."* *"A veces eso también es parte del trabajo."*
5. **Pendientes** — una tarjeta con borde dorado a la izquierda. Aparece solo si
   hay algo:
   - **Los primeros pasos**, en una cuenta nueva: *"Cargá tu tarifa"*, *"Cargá
     tu primera paciente"*, *"Agendá la primera sesión"*.
   - **"1 nota que no se pudo escribir"** — sesiones que ocurrieron y cuya
     nota falló, **de cualquier fecha**, de la más vieja a la más nueva. Cada
     una muestra la paciente, la fecha y **Ver qué pasó →**, que lleva a la
     sesión, donde se explica el fallo y se puede reintentar o eliminar. Si ya
     no queda con qué reintentar (ni el audio ni la transcripción), lo dice:
     *"No se puede reintentar; se puede eliminar"*. El detalle técnico del
     fallo no se muestra acá.
   - **"2 notas para revisar"** — notas escritas y sin aprobar, **de cualquier
     fecha**. Cada una lleva a la nota.
   - **"1 paciente te debe · $ 2.200"** — el total, agrupado por persona, con el
     enlace **Ver todos → Cobros**. No lista nombres.
   - **"1 paciente sin autorización hoy"** — pacientes con turno hoy que no
     firmaron la autorización de grabación.
   De las notas y de las autorizaciones se muestran hasta 3, y el resto se
   resume como *"y N más"*.
6. **Los dos números** — **Sesiones hoy**, con cuántas están pagas, y **Este
   mes**, lo cobrado en el mes corriente. No se tocan.

## Lo que ofrece cada fila de la agenda del día

- **Falta la autorización →** — si la paciente no firmó; lleva a la ficha.
- **Cobrar** — en cuanto pasó la hora del turno y no está cobrado, aunque
  todavía figure como agendado.
- **Grabar sesión** — si el turno se puede grabar hoy.
- El estado de la nota, aparte del pago y siempre a la vista: **Nota fallida ·
  Ver qué pasó** (la nota no se pudo escribir; lleva a la sesión, que explica
  qué pasó), **Para revisar** (hay una nota escrita esperando que la leas) o
  **Nota lista** (ya está aprobada). Los tres llevan a la nota.
- **Procesando** — mientras se escribe la nota.

Una sesión cuya nota falló nunca se ve sólo como **Cobrar**: la deuda es una
cosa y la nota que falta es otra, y las dos se muestran.

Si cobrás un turno que todavía figuraba **Agendado**, pasa a realizado y
cobrado en el momento, en la fila y en la tarjeta de ahora, y suma a **Este
mes**. Si igual lo intentaras cobrar dos veces (por ejemplo desde otra
pestaña), el segundo cobro no entra y la app avisa *"No se pudo cobrar."*:
recargá y vas a ver el turno ya cobrado. Ver `14-cuando-algo-falla.md`.

## Los colores

- **Verde (sage)** — hecho, cobrado, en curso.
- **Dorado (gold)** — algo espera algo tuyo: turno agendado, nota para revisar,
  la nota escribiéndose.
- **Terracotta** — plata sin cobrar, falta la autorización, señal de riesgo.
- **Gris** — "No vino", o simplemente sin acento.

## Qué hace la app por detrás

La pantalla lee la agenda, los pendientes y los números juntos, y la tarjeta de
ahora pide aparte el brief de esa paciente. Las notas para revisar salen de las
sesiones sin aprobar; la deuda, de los turnos realizados e impagos; y las
autorizaciones faltantes, de cruzar los turnos de hoy con las autorizaciones
vigentes; las notas que no se pudieron escribir, de las sesiones fallidas
de cualquier fecha (hasta 20). La hora se resuelve siempre en hora de Montevideo, corra donde corra el
servidor.

Un turno **Agendado** cuya hora ya pasó todavía no cuenta como deuda: pasa a
contar cuando se graba o se cobra.

## Lo que NO hace

- **No se actualiza sola.** Si grabás en otra pestaña, hay que volver a entrar o
  recargar.
- **No muestra los turnos cancelados.**
- **No muestra el bloque de pendientes** cuando no hay nada pendiente.
- **No cobra desde el bloque de pendientes**: ahí se enlaza a la nota, a la ficha
  o a Cobros.

<!-- fuentes:
src/app/(dashboard)/page.tsx
src/components/layout/aviso-prueba.tsx
src/app/(dashboard)/_components/dashboard.tsx
src/app/(dashboard)/_components/saludo.tsx
src/app/(dashboard)/_components/pendientes.tsx
src/app/(dashboard)/_components/card-ahora.tsx
src/app/(dashboard)/_components/kpis.tsx
src/app/(dashboard)/_components/agenda-del-dia.tsx
src/app/(dashboard)/_components/datos.ts
src/app/(dashboard)/_components/textos.ts
src/app/api/_lib/casos-uso/obtener-dashboard.ts
src/components/layout/cabecera-usuario.tsx
src/components/ui/session-row.tsx
src/components/clinico/brief-corto.tsx
src/lib/glosario.ts
src/lib/format.ts
src/app/api/_lib/casos-uso/pendientes-terapeuta.ts
-->
