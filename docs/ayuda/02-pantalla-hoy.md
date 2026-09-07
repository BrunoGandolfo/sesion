# La pantalla de Hoy

**Para qué sirve.** Es la primera pantalla: lo que espera una acción tuya, la
sesión que viene o está en curso, la agenda del día y quién te debe.

## Lo que ves, de arriba abajo

1. **Tu cabecera** — tu avatar con tus iniciales, el saludo (*Buen día* hasta
   las 12, *Buenas tardes* hasta las 19, *Buenas noches* después), tu nombre y
   la fecha corta. **Tocarla te lleva a "Tu consultorio".**
2. **El día en grande** — el día de la semana, y debajo *"3 sesiones en el día"*
   o *"sin sesiones agendadas"*.
3. **Pendientes** — una tarjeta con borde dorado a la izquierda. Aparece solo si
   hay algo. Tres filas posibles:
   - **"2 notas para revisar"** — notas escritas y sin aprobar, **de cualquier
     fecha**. Cada una lleva a la nota.
   - **"1 paciente te debe · $ 2.200"** — agrupado por persona, no por sesión, con
     el enlace **"Ver todos → Cobros"**.
   - **"1 paciente sin autorización hoy"** — pacientes con turno hoy que no
     firmaron la autorización de grabación.
   De cada lista se muestran hasta 3, y el resto se resume como *"y N más"*.
4. **La tarjeta de ahora** — borde verde a la izquierda. Es la sesión en curso, o
   la próxima del día. Tiene el nombre, la modalidad, la duración, la tarifa, la
   hora en grande y un chip:
   - **"En curso"** (verde, con un punto que late) — la hora ya empezó y todavía
     no terminó.
   - **"Enseguida"** (gris) — es el próximo turno y todavía no empezó.
   Debajo van dos líneas de "Para retomar" (última vez y foco), y **un solo
   botón**, el que no se puede saltear, en este orden: **Firmar autorización** →
   **Revisar nota** → *Escribiendo la nota…* (sin botón) → **Cobrar** →
   **Grabar sesión**. Si ya está todo hecho, un chip **"Nota guardada"**.
   Siempre hay además el enlace **Ver ficha →**.
5. **Los tres números** — *Sesiones hoy* (y cuántas pagas), **Por cobrar** (en
   terracotta si hay deuda; es el único que se toca y lleva a Cobros) y
   *Este mes* (lo cobrado en el mes corriente).
6. **Agenda del día** — una fila por turno, en orden de hora, con el botón
   **Turno** para agendar y **Ver semana →**. Si no hay turnos: *"Hoy tu agenda
   está libre."*
7. **Te deben** — los tres que más deben, con el monto en terracotta. Si no debe
   nadie: *"Nadie te debe. Día prolijo."*

## Los colores

- **Verde (sage)** — hecho, cobrado, en curso.
- **Dorado (gold)** — algo espera algo tuyo: turno agendado, nota para revisar,
  la nota escribiéndose.
- **Terracotta** — plata sin cobrar, falta la autorización, señal de riesgo.
- **Gris** — cancelado, "No vino", o simplemente sin acento.

## Qué hace la app por detrás

La pantalla lee todo de una sola vez y reparte los datos entre los bloques; no
recalcula reglas por su cuenta. Las notas para revisar salen de las sesiones sin
aprobar, la deuda de los turnos realizados e impagos, y las autorizaciones
faltantes de cruzar los turnos de hoy con los consentimientos vigentes. La hora
se resuelve siempre en hora de Montevideo, corra donde corra el servidor.

## Lo que NO hace

- **No se actualiza sola.** Si grabás en otra pestaña, hay que volver a entrar o
  recargar.
- **No muestra el bloque de pendientes** cuando no hay nada pendiente.
- **No cobra desde el bloque de pendientes**: ahí se enlaza a la ficha o a
  Cobros; el cobro se hace desde el turno.

<!-- fuentes:
src/app/(dashboard)/_components/dashboard.tsx
src/app/(dashboard)/_components/saludo.tsx
src/app/(dashboard)/_components/pendientes.tsx
src/app/(dashboard)/_components/card-ahora.tsx
src/app/(dashboard)/_components/kpis.tsx
src/app/(dashboard)/_components/agenda-del-dia.tsx
src/app/(dashboard)/_components/te-deben.tsx
src/app/(dashboard)/_components/datos.ts
src/components/layout/cabecera-usuario.tsx
src/components/ui/session-row.tsx
src/lib/glosario.ts
src/lib/format.ts
src/app/api/_lib/casos-uso/pendientes-terapeuta.ts
-->
