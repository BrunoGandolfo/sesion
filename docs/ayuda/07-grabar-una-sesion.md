# Grabar una sesión

**Para qué sirve.** Grabar el audio de la sesión para que la app escriba después
el borrador de la nota clínica.

## Antes de nada: la autorización

Si la paciente **no firmó la autorización**, la pantalla muestra **"Falta la
autorización"** y un botón **Firmar autorización** que lleva a la ficha. No hay
forma de grabar sin eso. Ver `04-pacientes-y-ficha.md`.

## Grabar

1. Entrá desde **Hoy** (**Grabar sesión**), desde el turno en la agenda, o desde
   la ficha con el botón **Grabar** de la cabecera. Si hay turno hoy, se
   graba ese turno; si no hay, la app **crea uno de 50 minutos, presencial, con
   la hora de ahora** recién cuando tocás el botón (y ese turno no genera
   recordatorio).
2. Tocá el botón redondo verde **Grabar sesión**.
3. La primera vez, el navegador te pide permiso para usar el micrófono.

## Mientras grabás

La pantalla muestra el tiempo de grabación y un medidor de sonido.
Mantené la pantalla encendida y Sesión abierta. Si deja de entrar sonido,
la app avisa a los 2 minutos y pasa a interrumpida a los 5 minutos; si la
pantalla está oculta, el umbral de interrupción es de 1 minuto. Eso no
garantiza que el teléfono siga capturando cuando cambiás de app.

### Pausar

**Pausar** detiene la grabación: el punto deja de latir y aparece **En pausa**.
**El cronómetro se detiene**, el tiempo en pausa no cuenta, y **Reanudar** sigue
en el mismo archivo.

### Bloquear la pantalla

**No bloquees la pantalla mientras grabás.** La app intenta mantenerla
encendida, pero el sistema puede suspender el micrófono o la página. Si pasa,
volvé a Sesión y revisá su estado antes de seguir.

### Si se corta el micrófono

Una llamada u otra app puede interrumpir el micrófono. La pantalla ofrece
**Reanudar** o **Terminar la sesión** con lo que haya capturado. Durante la
interrupción no se graba. La recuperación completa no está garantizada: no
cierres la pantalla ni descartes el audio mientras intentás guardarlo.

### Descartar

**Descartar grabación** pregunta: *"¿Descartar la grabación? Se borra el audio de
este teléfono. No se puede recuperar."*

## Terminar

1. Tocá **Terminar la sesión** (el botón rojo). No hay pantalla intermedia.
2. Aparece **Guardando…** con una barra: ahí adentro pasan el cifrado, la subida
   y la confirmación.
3. Al terminar aparece **"Te avisamos cuando la nota esté lista"**, la app vuelve
   sola a la ficha y el turno queda marcado como **realizado**.

El límite es de **150 minutos** de grabación, con un aviso a los **135 minutos**.
Al alcanzar el límite, la captura se interrumpe; todavía tenés que terminar
y guardar la sesión. No se sube ni se aprueba sola.

## Si la subida falla

La pantalla ofrece **Reintentar** si no pudo completar el guardado. No tomes
un mensaje de respaldo como garantía de que todo quedó guardado: mantené
la pantalla abierta y comprobá que la subida se confirme.

Si el navegador se cerró, al volver al mismo turno puede aparecer un pendiente
con **Guardarla ahora** y **Descartarla**. La recuperación puede fallar. Si hay
audio pendiente, no empieces otra grabación del mismo turno ni lo descartes
mientras intentás recuperarlo; puede reemplazarse la copia anterior.

## Qué hace la app por detrás

Durante la captura, la app intenta guardar fragmentos en el navegador.
**La copia local previa no está cifrada** y puede faltar si el almacenamiento
no estuvo disponible. Al terminar, el navegador genera una clave y cifra el
audio antes de subirlo a R2. La app intenta limpiar la copia local cuando la
subida se confirma; no hay garantía de recuperación después de cerrar la página.

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
