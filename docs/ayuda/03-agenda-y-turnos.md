# Agenda y turnos

**Para qué sirve.** Ver y manejar los turnos: crearlos, reprogramarlos,
cancelarlos, marcar que la paciente no vino, y saber qué pasa con el
recordatorio en cada caso.

## Cómo se ve

**En el teléfono** siempre se mira **un día**; tocando el título de la fecha se
despliega el mes, con un punto en los días con turnos. **En la computadora**
elegís **día**, **semana** (empieza el lunes) o **mes**. Las flechas mueven según
lo que estés mirando, y hay un botón para volver a hoy.

## Agendar un turno

1. Tocá **Agendar** (el botón redondo abajo a la derecha), o **Turno** desde
   **Hoy**.
2. Elegí la paciente, la **Fecha** y la **Hora**.
3. Elegí la **Duración**: 30, 45, 50, 60 o 90 minutos.
4. Elegí la **Modalidad**: **Presencial** u **Online**.
5. Opcional: **Notas** ("Algo para recordar del turno.").
6. Guardá. Aparece **"Turno agendado"**.

La tarifa del turno se copia de la tarifa de esa paciente en el momento de
crearlo. El turno nace **Agendado** y **Pendiente** de pago.

## Abrir un turno

Tocá el turno. Se abre una ficha con el brief **"Para retomar"**, el chip de
estado, la duración, la modalidad, la tarifa, el pago, tus notas y el estado del
**Recordatorio**.

## Estados del turno

| Chip | Qué significa |
| --- | --- |
| **Agendado** (dorado) | Programado, todavía no pasó nada. |
| **Sin cobrar** (terracotta) | La sesión se hizo y falta el pago. |
| **Cobrado** (verde) | Pagado. |
| **No vino** (gris) | La paciente faltó. |
| **Cancelado** (gris) | El turno se anuló. |

## Las acciones y el recordatorio

- **Cobrar** — registra el pago. Si el turno todavía figuraba *Agendado* y la
  hora ya pasó, **cobrar lo cierra**: pasa a realizado. Dice, en el propio
  sheet: *"al cobrar, el turno queda como realizado"*. **El recordatorio se
  cancela.**
- **Grabar sesión** / **Revisar nota** — según el turno tenga o no una sesión
  clínica ya empezada.
- **Reprogramar** — cambiás fecha, hora, duración, modalidad y notas. Si
  cambiaste la fecha, **el recordatorio viejo se cancela y se programa uno
  nuevo** para la fecha nueva. Si solo cambiaste la duración o la modalidad, el
  recordatorio queda como estaba.
- **No vino** — pregunta *"¿[Nombre] no vino?"* y avisa: *"El turno queda
  registrado como ausencia. No se cobra y no se puede grabar."*
  **El recordatorio se cancela.**
- **Cancelar turno** — pregunta *"¿Cancelar este turno?"* y avisa: *"Se cancela
  el recordatorio por SMS. El turno queda en la ficha como cancelado y no se
  puede reabrir."* **El recordatorio se cancela.**

Al terminar de grabar, la app también marca el turno como realizado, y con eso
el recordatorio se cancela.

## Qué hace la app por detrás

Un turno que deja de estar programado —realizado, ausente o cancelado— apaga
todos sus recordatorios, estén esperando su hora o ya reservados para salir. Un
turno creado con fecha ya pasada (grabar una sesión sin turno previo) **no genera
ningún recordatorio**.

## Lo que NO hace

- **Un turno cancelado no se puede reabrir.**
- **No se editan fecha, hora, duración ni notas de un turno que ya no está
  programado**: solo de los agendados.
- **No cobra un turno agendado cuya hora todavía no llegó**: dice *"La sesión
  todavía no empezó: vas a poder cobrarla cuando llegue la hora"*.
- **No permite superponer turnos** con otro turno agendado o realizado.
  Si se pisan los horarios, no se guarda el cambio: elegí otra hora o duración.
  Un turno puede empezar justo cuando termina el anterior.
- **No hay turnos que se repitan solos** cada semana.
- **No se borran turnos.**

<!-- fuentes:
src/app/(dashboard)/agenda/_components/agenda-view.tsx
src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx
src/app/api/turnos/route.ts
src/app/api/turnos/[id]/route.ts
src/app/api/turnos/[id]/cobrar/route.ts
src/app/api/_lib/casos-uso/cobrar-turno.ts
src/app/api/_lib/casos-uso/recordatorios-del-turno.ts
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/lib/glosario.ts
-->
