# Grabar una sesión

**Para qué sirve.** Grabar el audio de la sesión para que la app escriba después
el borrador de la nota clínica.

## Antes de nada: la autorización

Si la paciente **no firmó la autorización**, la pantalla muestra **"Falta la
autorización"** y un botón **Firmar autorización** que lleva a la ficha. No hay
forma de grabar sin eso. Ver `04-pacientes-y-ficha.md`.

## Grabar

1. Entrá desde **Hoy** (**Grabar sesión**), desde el turno en la agenda, o desde
   la ficha con el botón **Grabar** de abajo a la derecha. Si hay turno hoy, se
   graba ese turno; si no hay, la app **crea uno de 50 minutos, presencial, con
   la hora de ahora** recién cuando tocás el botón (y ese turno no genera
   recordatorio).
2. Tocá el botón redondo verde **Grabar sesión**.
3. La primera vez, el navegador te pide permiso para usar el micrófono.

## Mientras grabás

Un punto rojo que **late** y la palabra **REC**; el cronómetro grande; un medidor
que se mueve con tu voz (si pasan 5 segundos sin que entre audio, te avisa); y
abajo: *"Se guarda cifrado en el teléfono. Podés bloquear la pantalla."*

### Pausar

**Pausar** detiene la grabación: el punto deja de latir y aparece **En pausa**.
**El cronómetro se detiene**, el tiempo en pausa no cuenta, y **Reanudar** sigue
en el mismo archivo.

### Bloquear la pantalla

Podés. La app pide mantener la pantalla encendida, pero si el sistema la apaga o
cambiás de app, **la grabación sigue**.

### Si se corta el micrófono

Si llega una llamada o otra app se lleva el micrófono, la pantalla pasa a
**Cortado**: *"Se cortó el micrófono. Lo grabado está a salvo."* Tenés dos
caminos: **Reanudar** (sigue en el mismo archivo) o **Terminar la sesión**
(guarda lo que hay hasta ahí).

### Descartar

**Descartar grabación** pregunta: *"¿Descartar la grabación? Se borra el audio de
este teléfono. No se puede recuperar."*

## Terminar

1. Tocá **Terminar la sesión** (el botón rojo). No hay pantalla intermedia.
2. Aparece **Guardando…** con una barra: ahí adentro pasan el cifrado, la subida
   y la confirmación.
3. Al terminar aparece **"Te avisamos cuando la nota esté lista"**, la app vuelve
   sola a la ficha y el turno queda marcado como **realizado**.

La grabación se corta sola a la hora y media.

## Si la subida falla

Aparece: **"No se pudo guardar el audio. Está a salvo en tu teléfono. Probá de
nuevo."** y un botón **Reintentar**. **Nada se borró**: el audio cifrado sigue en
memoria y la copia sin cifrar, en el teléfono. Reintentar manda el mismo audio.

Si además se te cerró el navegador, al volver a la pantalla de grabar de ese
mismo turno la app te ofrece: *"Quedó una grabación de ~N min sin enviar"*, con
**Guardarla ahora** y **Descartarla**.

## Qué hace la app por detrás

El audio se graba en pedacitos de un segundo que forman un solo archivo, y cada
pedacito se guarda en el teléfono desde el primer momento: si el navegador muere,
la grabación sobrevive. Al terminar, el navegador genera una clave, cifra el
audio y **recién ahí** lo sube, directo al depósito, sin pasar por el servidor de
la app. La copia del teléfono se borra cuando la subida está confirmada.

## Lo que NO hace

- **No graba video.**
- **No transcribe en vivo**: no ves texto mientras grabás.
- **No graba dos sesiones a la vez**: un turno tiene una sola sesión clínica.
- **No graba sin autorización vigente.**
- **No te avisa al teléfono** cuando la nota está lista.
- **No se recupera** una grabación descartada.

<!-- fuentes:
src/app/(dashboard)/grabar/[turnoId]/page.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/medidor-audio.tsx
src/components/grabacion/GrabadorSesion.tsx
src/hooks/useGrabacionSesion.ts
src/lib/grabacion-storage.ts
src/lib/crypto.ts
src/app/api/sesion-clinica/route.ts
src/lib/glosario.ts
docs/pipeline.md
-->
