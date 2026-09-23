# "Para vos": la auto-supervisión

**Para qué sirve.** Es la otra cara de una sesión: habla de **tu** trabajo en
esa sesión, no de la paciente. Se lee cuando querés, no antes que la nota.

**Dónde está.** Arriba de la nota hay un selector de tres opciones, **Nota
clínica | Para vos | Transcripción**, que aparece siempre que la nota está para
revisar o guardada, haya análisis o no. Si hay análisis, se llega también desde el aviso
que queda en la nota apenas la aprobás (**Leer Para vos**) y desde la fila de la
sesión en la pestaña Sesiones de la ficha. Tiene dirección propia, así que se
puede volver con el botón de atrás. Abrir la vista no genera un análisis nuevo.

**Qué ves, en orden.** Primero lo que se lee: **Fortalezas observadas**,
**Áreas de crecimiento** y **Observación general**. Después, plegado, **El
instrumento y su puntaje** (con la sigla al lado: **GTFS**, o **MITI 4.2.1 + CTS-R**); se abre
con un toque. Si el análisis trajo solo el instrumento, viene abierto para que
la pantalla no quede vacía. Al pie, el aviso de que lo escribió la IA.

Si al análisis le faltó una parte, se muestra igual lo que llegó, con un aviso
que dice *"Parte del análisis no llegó."*

## Si todavía no está listo

El análisis tiene su propio estado, separado de la nota. Cuando no hay análisis
para mostrar, la vista dice en cuál está:

- **Todavía no se pidió.** — *"Esta sesión no tiene análisis."* y el botón
  **Preparar Para vos**.
- **Se está generando…** — *"El análisis está en preparación. Podés seguir
  trabajando; lo vas a encontrar acá cuando esté listo."* La vista se actualiza
  sola.
- **No se pudo generar.** — con el botón **Volver a pedir Para vos**.
- **Listo** sin contenido visible — *"El análisis figura listo, pero no pudimos
  mostrar su contenido. Volvé a abrir la sesión para comprobarlo."*

Pedirlo de nuevo no vuelve a transcribir ni rehace la nota, y se puede aunque la
nota ya esté aprobada. Mientras tanto dice *"Pidiendo el análisis…"*. Los botones
aparecen solo si la sesión tiene transcripción. Si el pedido no se pudo
confirmar: *"No pudimos confirmar el pedido. Probá de nuevo; la nota se
conserva."*

## Qué instrumento te toca

Depende de lo que elegiste en **Tu consultorio → Tu enfoque**:

- **Gestalt** → **GTFS**
- **Cognitivo-conductual** → **CTS-R** + **MITI 4.2.1**

Las sesiones ya analizadas conservan el instrumento con el que se generaron:
cambiar el enfoque no reescribe lo viejo. Pero si después volvés a pedir **Para
vos** o volvés a escribir la nota, el análisis nuevo usa el enfoque que tengas
elegido en ese momento.

## GTFS — Gestalt Therapy Fidelity Scale

*Tu práctica gestáltica en esta sesión.*

Son **20 ítems**, agrupados en siete dimensiones: **Relación dialogal**, **Aquí y
ahora**, **Práctica fenomenológica**, **Conciencia corporal**, **Sensible al
campo**, **Procesos de contacto** y **Actitud experimental**.

Al abrir **El instrumento y su puntaje**, lo primero es la
**Adherencia global**: *"13 de 18 ítems evaluables presentes"* (si ninguno se
pudo evaluar: *"Ningún ítem fue evaluable a partir de la transcripción de esta
sesión."*), y debajo la aclaración: *"La GTFS releva la presencia de prácticas gestálticas en
la sesión. Es una referencia para tu auto-supervisión, no una calificación."*

En **Ver detalle** cada ítem aparece con uno de tres estados:

- **Presente** (punto verde) — apareció. El modelo tiene instrucciones de
  respaldarlo con una cita textual; revisá que la cita esté.
- **Ausente** (punto gris) — la sesión daba lugar y no apareció.
- **No determinable** (punto punteado) — no hay cómo saberlo desde el audio, con
  la razón escrita al lado.

**"No determinable" no es "mal".** El instrumento fue validado con video; desde
una transcripción solo se puede acreditar lo que dejó huella verbal. Si hiciste
una observación corporal sin decirla en voz alta, para el sistema no existe.

## MITI 4.2.1 — Motivational Interviewing Treatment Integrity

*Cómo acompañaste en esta sesión.* Dos escalas globales, de **1 a 5**:
**Empatía** y **Colaboración**. Verde de 3 para arriba, dorado en 2, terracotta
en 1.

## CTS-R — Cognitive Therapy Scale, Revised

*Cómo estructuraste esta sesión.* Cuatro ítems, de **0 a 6**: **Establecimiento
de agenda**, **Feedback del paciente**, **Colaboración** y **Descubrimiento
guiado**. Es un subconjunto elegido: son los cuatro que se pueden leer desde una
transcripción, no la escala completa de doce.

## Lo que comparten los tres

Es lo que está arriba de todo, antes del instrumento:

- **Fortalezas observadas** — hasta 3, cada una con la cita que la sostiene.
- **Áreas de crecimiento** — hasta 3, cada una con una observación y una
  sugerencia concreta.
- **Observación general** — una idea para la próxima sesión.
- Cada puntaje debería traer **la cita literal y el minuto** que lo justifican,
  y sin cita el modelo tiene que marcar **"No determinable"** con la razón. Es
  una instrucción al modelo, no algo que la app compruebe: si ves un puntaje sin
  cita, tomalo con más cautela.

Y al pie, siempre: *"Este análisis es generado por IA a partir de la
transcripción. No sustituye la supervisión clínica profesional. Las métricas son
orientativas y deben interpretarse en contexto."*

## Cómo leerlo

Miralo como una segunda lectura de la sesión, no como una nota escolar. Lo útil
está en las citas: te devuelven momentos concretos con el minuto, y ahí podés
juzgar vos si el sistema leyó bien. Un ítem sin evidencia dice más sobre lo que
el audio no muestra que sobre lo que hiciste.

## Lo que NO es

- **No es supervisión.** No la reemplaza ni la resume.
- **No es una evaluación de competencia** ni una calificación de tu trabajo.
- **No habla de vos como profesional**, solo de lo que pasó en esa sesión: está
  escrito así a propósito.
- **No mezcla enfoques**: el reporte gestáltico no evalúa agenda ni tareas, y el
  cognitivo-conductual no evalúa experimentos.
- **No lo ve nadie más.** Es tuyo.
- **No cambia la nota** ni influye en si podés aprobarla.

<!-- fuentes:
src/components/grabacion/FeedbackTerapeutaView.tsx
src/lib/glosario.ts
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/para-vos-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/selector-vista.tsx
src/app/(dashboard)/sesiones/[id]/para-vos/page.tsx
src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx
src/app/api/_lib/casos-uso/sesion/reintentar-feedback.ts
src/app/api/_lib/casos-uso/sesion/reclamar.ts
processor/prompts/therapist_feedback_gestalt_v1.1.md
processor/prompts/therapist_feedback_v1.1.md
-->
