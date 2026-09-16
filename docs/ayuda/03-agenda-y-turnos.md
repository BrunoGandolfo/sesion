# Agenda y turnos

**Para qué sirve.** Ver y manejar los turnos: crearlos, reprogramarlos,
cancelarlos, marcar que la paciente no vino, y saber qué pasa con el
recordatorio en cada caso.

## Cómo se ve

**En el teléfono** siempre se mira **un día**; tocando el título de la fecha se
despliega el mes, con un punto y la cantidad de turnos en cada día. **En la
computadora** elegís **Día**, **Semana** (empieza el lunes) o **Mes**. Las flechas
mueven según lo que estés mirando, y **Hoy** vuelve al día de hoy.

Un día sin turnos dice *"Nada agendado este día"*. **Los turnos cancelados no se
muestran en la agenda.**

## Agendar un turno

1. Tocá **Agendar** en Agenda o en **Hoy**.
2. Elegí la paciente, la **Fecha** y la **Hora**. Si la paciente ya tuvo turnos,
   la app propone el mismo día y hora de la última vez.
3. Elegí la **Duración**: 30, 45, 50, 60 o 90 minutos.
4. Elegí la **Modalidad**: **Presencial** u **Online**.
5. En **Se repite**, elegí **Una vez**, **Cada semana** o **Cada 15 días**.
6. Opcional: **Notas** ("Algo para recordar del turno.").
7. Guardá. Para un turno suelto aparece **"Turno agendado"**.

La tarifa del turno se copia de la tarifa de esa paciente en el momento de
crearlo. El turno nace **Agendado** y **Pendiente** de pago.

## Turnos que se repiten

Podés repetir cada semana o cada 15 días. Se agendan **tres meses** de turnos.
Cada turno es independiente: moverlo, cobrarlo o cancelarlo no cambia el resto.

Al guardar una serie aparece **Serie agendada**, con cuántos turnos se agendaron,
y queda abierta hasta que tocás **Entendido**. Si una fecha posterior choca con
otro turno, no se agenda y el aviso muestra cuáles se omitieron: *"Podés
agendarlas por separado en otro horario."* Si choca la primera fecha, no se crea
la serie: elegí otro comienzo.

Desde un turno de la serie, **Cancelar el resto de la serie** pide confirmación:
se cancelan ese turno y los siguientes que sigan programados, junto con sus
avisos pendientes. Los anteriores y los ya realizados quedan como están.
Cuando se acaban los tres meses no se agrega nada solo: agendá una serie nueva.

## Abrir un turno

Tocá el turno. Se abre una ficha con el chip de estado, la duración, la
modalidad, la tarifa, el pago y tus notas. En un turno agendado o realizado
aparece además el brief **"Para retomar"**. El estado del **Recordatorio** se
muestra solo mientras el turno sigue agendado. Un turno ausente dice *"La
paciente no vino a este turno."*

## Estados del turno

| Chip | Qué significa |
| --- | --- |
| **Agendado** (dorado) | Programado, todavía no pasó nada. |
| **Sin cobrar** (terracotta) | La sesión se hizo y falta el pago. |
| **Pagado** (verde) | Cobrado. |
| **No vino** (gris) | La paciente faltó. |
| **Cancelado** (gris) | El turno se anuló. No aparece en la agenda, pero sí en la ficha de la paciente. |

## Las acciones y el recordatorio

- **Cobrar** — abre *"¿Cómo pagó?"* con los métodos de pago. Si el turno todavía
  figuraba *Agendado* y la hora ya pasó, **cobrar lo cierra**: pasa a realizado.
  Mientras el turno está agendado, el propio sheet lo dice: *"al cobrar, el
  turno queda como realizado"*. **El recordatorio se cancela.**
- **Grabar sesión** / **Revisar nota** — **Grabar sesión** si el turno todavía no
  tiene sesión clínica; si ya la tiene, **Revisar nota** lleva a la nota, aunque
  ya esté aprobada.
- **Reprogramar** — cambiás fecha, hora, duración, modalidad y notas. Si
  cambiaste la fecha o la hora, **el recordatorio viejo se cancela y se programa
  uno nuevo** para el horario nuevo. Si solo cambiaste la duración o la
  modalidad, el recordatorio queda como estaba. Si el aviso anterior ya había
  salido, se manda **enseguida** un **cambio de horario** con la fecha nueva.
- **No vino** — pregunta *"¿[Nombre] no vino?"* y avisa: *"El turno queda
  registrado como ausencia. No se cobra y no se puede grabar."*
  **El recordatorio se cancela.**
- **Cancelar turno** — pregunta *"¿Cancelar este turno?"* y avisa: *"Se cancela
  el recordatorio por SMS. El turno queda en la ficha como cancelado y no se
  puede reabrir."* **El recordatorio se cancela.**

Cuando la grabación llega completa al servidor, la app marca el turno como
realizado, y con eso el recordatorio pendiente se cancela.

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
- **No se borran turnos.**

<!-- fuentes:
src/app/(dashboard)/agenda/_components/agenda-view.tsx
src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx
src/app/api/turnos/route.ts
src/app/api/turnos/[id]/route.ts
src/app/api/turnos/[id]/cobrar/route.ts
src/app/api/_lib/casos-uso/cobrar-turno.ts
src/app/(dashboard)/agenda/_components/agenda-header.tsx
src/app/(dashboard)/agenda/_components/month-view.tsx
src/components/forms/nuevo-turno-form.tsx
src/components/forms/resultado-serie.tsx
src/app/api/_lib/casos-uso/crear-turno.ts
src/app/api/_lib/casos-uso/turnos.ts
src/app/api/_lib/casos-uso/envios-del-turno.ts
src/app/api/_lib/casos-uso/audio.ts
src/lib/glosario.ts
-->
