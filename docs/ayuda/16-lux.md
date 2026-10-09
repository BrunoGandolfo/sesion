# Lux

**Para qué sirve.** Lux te ayuda a repasar a una paciente antes o después de
una sesión. Leyó su Recorrido, sus notas y sus últimas sesiones, y le podés
preguntar como a una colega que tiene la ficha abierta: *"¿De qué venimos
hablando?"*, *"¿Cuándo apareció lo del trabajo?"*. Es un sol quieto: no se
mueve, y tampoco es Lupita. Lupita explica cómo se usa la app; Lux habla de
esta paciente.

## Dónde está

En la ficha, pestaña **Lux**, la que tiene el sol, después de **Recorrido**.
Al entrar, la app te saluda —*"Hola, dame un momentito que repaso lo de …"*,
con tu nombre si lo cargaste en **Tu consultorio**— y enseguida Lux empieza a
escribir: habla primero, con un repaso corto. La respuesta va apareciendo a
medida que llega.

Arriba del chat hay una línea que no se va: *"Lux lee el Recorrido, las notas
y las últimas sesiones de … No guarda esta conversación."*

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
- **Nueva conversación** borra lo que hay en pantalla y Lux vuelve a abrir
  desde cero.

## La conversación no se guarda

Lo que hablás con Lux vive en esa pantalla y nada más. Si salís de la pestaña,
recargás o pasás a otra paciente, se va. Si dejaste algo escrito sin mandar y
cambiás de pestaña, la app te pregunta antes, como con las notas privadas.

Al pasar a otra paciente la pestaña arranca vacía: nada de una queda a la
vista de la otra.

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

- **No guarda la conversación**, ni en la app ni en tu teléfono.
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
src/components/ui/lux.tsx
-->
