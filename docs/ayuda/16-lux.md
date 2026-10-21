# Lux

**Para qué sirve.** Lux te ayuda a repasar a una paciente antes o después de
una sesión. Leyó su Recorrido, sus notas y sus últimas sesiones, y le podés
preguntar como a una colega que tiene la ficha abierta: *"¿De qué venimos
hablando?"*, *"¿Cuándo apareció lo del trabajo?"*. Es un sol quieto: no se
mueve, y tampoco es Lupita. Lupita explica cómo se usa la app; Lux habla de
esta paciente.

## Dónde está

En la ficha, pestaña **Lux**, la que tiene el sol, después de **Recorrido**.
Al entrar ves primero lo que ya hablaron otras veces, con una línea por día:
*"Conversación del 14/10"*. Abajo, la app te saluda —*"Hola, dame un momentito
que repaso lo de …"*, con tu nombre si lo cargaste en **Tu consultorio**— y
enseguida Lux empieza a escribir: habla primero, con un repaso corto. Si ya
hablaron, arranca por en qué quedaron y cuándo. La respuesta va apareciendo a
medida que llega.

Arriba del chat hay una línea que no se va: *"Lux lee el Recorrido, las notas
y las últimas sesiones de …, y recuerda lo que hablaron acá."*

## Cómo se conversa

- Escribís abajo y apretás **Enter** (o **Enviar**). **Shift+Enter** baja de
  línea sin mandar.
- Si Lux necesita volver a una sesión, vas a ver en gris *"Mirando la
  transcripción del 03/10…"*. No es algo que te dice: es la app avisando qué
  está leyendo.
- Debajo de algunas respuestas aparece **Ver en qué me baso**, plegado. Al
  tocarlo se abre la lista de lo que Lux usó para contestar: de qué sesión, de
  qué fecha y la frase. Es texto, no un enlace: sirve para ir a buscarlo vos
  en la nota o en la transcripción.
- Si una respuesta se corta (se fue la señal, cerraste la pestaña mientras
  escribía), queda lo que llegó con *"La respuesta se cortó acá."* debajo.
  Podés volver a preguntar.

## Lux recuerda la conversación

Lo que hablás con Lux sobre una paciente queda guardado, para que otro día
puedas preguntarle *"¿Dónde habíamos quedado?"* y seguir.

- **Qué se guarda:** cada pregunta tuya y cada respuesta de Lux, tal como la
  viste (con sus citas y sus *"Mirando la transcripción…"*). Una respuesta
  cortada se guarda con lo que llegó.
- **Dónde:** en la base de la app, junto a la ficha de esa paciente, **cifrado**
  con la misma clave que las notas. No queda en tu teléfono ni en el
  navegador.
- **Qué recuerda Lux:** al abrir ves los últimos turnos; Lux lee los más
  recientes de esos. Lo que no está ahí, no lo recuerda.
- **Cada paciente tiene la suya:** desde la ficha de una no se ve ni se usa la
  conversación de otra.
- **Si archivás a la paciente,** la conversación se conserva. Si se elimina la
  paciente, se borra con ella.

Si dejaste algo escrito sin mandar y cambiás de pestaña, la app te pregunta
antes, como con las notas privadas: lo que no mandaste no se guarda.

## Empezar de cero

El botón **Empezar de cero**, arriba a la derecha del chat, borra toda la
conversación con Lux sobre esa paciente. Antes te pregunta: *"¿Empezar de
cero con Lux?"*, y recién al tocar **Borrar la conversación** la borra. No se
puede recuperar. Las notas y el Recorrido no se tocan. Después Lux vuelve a
abrir como la primera vez. Mientras Lux está respondiendo, el botón espera.

## Qué lee

Solo lo que ya aprobaste: el Recorrido, las notas aprobadas y las
transcripciones de esas sesiones. Una sesión que todavía está en revisión no
entra. Si hay una propuesta de Recorrido que no aceptaste, Lux la ve marcada
como no aceptada.

## A dónde viaja lo que lee

Para contestar, el Recorrido, las notas, las sesiones que mira y tus preguntas
viajan a **Anthropic**, el mismo proveedor que escribe las notas. Ver
`12-camino-del-audio-y-privacidad.md`.

## El tope del día

Lux tiene un tope de uso por día. Cuando lo alcanza, dice *"Lux llegó a su
tope de hoy."* y lo que escribiste vuelve al campo. Al día siguiente vuelve a
responder.

## Lo que NO hace

- **No guarda nada en tu teléfono**: la conversación queda cifrada en la app
  hasta que la borres con **Empezar de cero**.
- **No cambia nada**: no edita el Recorrido, no toca las notas, no aprueba
  ni agenda. Solo lee y conversa.
- **No reemplaza tu lectura**: lo que dice Lux es una ayuda para repasar, la
  interpretación clínica es tuya. Si algo te importa, abrí la nota o la
  transcripción de esa sesión: **Ver en qué me baso** te dice cuál.
- **No habla de otra paciente** desde esta pestaña: lee solo la ficha donde
  estás.

<!-- fuentes:
src/app/(dashboard)/pacientes/[id]/_components/paciente-detail-view.tsx
src/app/(dashboard)/pacientes/[id]/_components/lux-tab.tsx
src/components/lux/conversacion-lux.tsx
src/components/lux/use-conversacion-lux.ts
src/components/lux/respuesta.ts
src/lib/glosario.ts
src/lib/lux/contrato.ts
src/app/api/_lib/casos-uso/lux/material.ts
src/app/api/_lib/casos-uso/lux/memoria.ts
src/app/api/_lib/casos-uso/lux/conversar.ts
src/components/ui/lux.tsx
-->
