# La pantalla de Hoy

**Para qué sirve.** Es la primera pantalla: la agenda del día, lo que espera una
acción tuya, la sesión que viene o está en curso, y dos números del día y del
mes.

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
3. **Agenda del día** — una fila por turno, en orden de hora, con el botón
   **Agendar** y, en la computadora, **Ver semana →**. Cada fila muestra la hora,
   la duración, la paciente, la modalidad y la tarifa, y a la derecha lo que
   corresponde hacer (ver abajo). Si no hay turnos: *"Hoy no hay nada
   agendado."* *"A veces eso también es parte del trabajo."*
4. **Pendientes** — una tarjeta con borde dorado a la izquierda. Aparece solo si
   hay algo:
   - **Los primeros pasos**, en una cuenta nueva: *"Cargá tu tarifa"*, *"Cargá
     tu primera paciente"*, *"Agendá la primera sesión"*.
   - **"2 notas para revisar"** — notas escritas y sin aprobar, **de cualquier
     fecha**. Cada una lleva a la nota.
   - **"1 paciente te debe · $ 2.200"** — el total, agrupado por persona, con el
     enlace **Ver todos → Cobros**. No lista nombres.
   - **"1 paciente sin autorización hoy"** — pacientes con turno hoy que no
     firmaron la autorización de grabación.
   De las notas y de las autorizaciones se muestran hasta 3, y el resto se
   resume como *"y N más"*.
5. **La tarjeta de ahora** — borde verde a la izquierda. Es la sesión en curso, o
   la próxima del día. Si ya no queda ninguna: *"No queda ninguna sesión por
   delante hoy."* La tarjeta tiene el nombre, la modalidad, la duración, la
   tarifa, la hora en grande y un chip:
   - **"En curso"** (verde, con un punto que late) — la hora ya empezó y todavía
     no terminó.
   - **"Enseguida"** (gris) — es el próximo turno y todavía no empezó.
   Debajo puede aparecer la señal de riesgo, *"Última vez (…):"* y *"Para la
   próxima:"*, tomadas de la última nota aprobada. Después, **un solo botón**, el
   primero que corresponda en este orden: **Firmar autorización** → **Revisar
   nota** → *Procesando la sesión de …* (sin botón, con un anillo que gira) →
   **Cobrar** → **Grabar sesión**.
   **Cobrar** aparece cuando la sesión ya quedó realizada y sin cobrar. Si ya
   está todo hecho, un chip **"Nota guardada"**. Siempre está además el enlace
   **Ver ficha →**.
6. **Los dos números** — **Sesiones hoy**, con cuántas están pagas, y **Este
   mes**, lo cobrado en el mes corriente. No se tocan.

## Lo que ofrece cada fila de la agenda del día

- **Falta la autorización →** — si la paciente no firmó; lleva a la ficha.
- **Cobrar** — en cuanto pasó la hora del turno y no está cobrado, aunque
  todavía figure como agendado.
- **Grabar sesión** — si el turno se puede grabar hoy.
- **Revisar nota** o **Ver nota** — si ya hay una nota para revisar o guardada.
- **Procesando** — mientras se escribe la nota.

Si cobrás desde una fila un turno que todavía figuraba **Agendado**, el cobro
queda registrado pero la fila puede seguir mostrando **Cobrar** hasta que
recargues. No cobres dos veces. Ver `14-cuando-algo-falla.md`.

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
vigentes. La hora se resuelve siempre en hora de Montevideo, corra donde corra el
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
src/app/api/_lib/casos-uso/obtener-dashboard.ts
src/components/layout/cabecera-usuario.tsx
src/components/ui/session-row.tsx
src/components/clinico/brief-corto.tsx
src/lib/glosario.ts
src/lib/format.ts
src/app/api/_lib/casos-uso/pendientes-terapeuta.ts
-->
