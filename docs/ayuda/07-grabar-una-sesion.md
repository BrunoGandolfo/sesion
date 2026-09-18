# Grabar una sesión

**Para qué sirve.** Grabar el audio de la sesión para que la app escriba después
el borrador de la nota clínica.

## Antes de nada: la autorización y el turno

- **Sin autorización vigente no se graba.** Si la paciente no firmó la
  autorización, la pantalla muestra **Falta la autorización** y un botón
  **Firmar autorización** que lleva a la ficha. No hay forma de grabar sin eso.
  Ver `04-pacientes-y-ficha.md`.
- **Con turno o sin turno.** Si hay turno hoy, se graba ese turno. Si tocás
  **Grabar** en la cabecera de la ficha y la paciente no tiene turno, la app
  **crea uno de 50 minutos, presencial, con la hora de ahora** recién cuando
  tocás **Grabar sesión** (ese turno no genera recordatorio).
- **Una cuenta de prueba graba hasta 15 sesiones.** Si tu consultorio se creó
  con una invitación, arriba dice cuántas llevás. Al llegar a 15, dice
  *"Llegaste a las 15 sesiones grabadas de la prueba y no podés grabar más.
  Para seguir, hablá con quien te invitó."* y **Grabar sesión** queda apagado.
  Una grabación que quedó guardada en el teléfono se puede enviar igual: ya
  está contada. Ver `11-tu-consultorio.md`.

## Grabar

1. Entrá desde **Hoy** (**Grabar sesión**), desde el turno en la agenda, o desde
   la ficha con el botón **Grabar** de la cabecera.
2. Tocá el botón redondo verde **Grabar sesión**.
3. La primera vez, el navegador te pide permiso para usar el micrófono.

Arriba ves el nombre de la paciente y la hora del turno. Un punto que respira
marca que está grabando, el cronómetro cuenta el tiempo grabado y debajo hay un
medidor de sonido: barras que se mueven con la voz y una leyenda que dice
*"El audio se escucha bien"*. Si deja de entrar sonido con la pantalla a la
vista, las barras quedan en cero y la leyenda pasa a *"No está entrando
sonido"*. Al pie lo recuerda: *"Se guarda cifrado en el teléfono. Dejá la
pantalla encendida."*

## Mientras grabás

El navegador entrega el audio **cada segundo**, y cada entrega **se cifra en el
teléfono antes de guardarse** con la clave de esa sesión. Es una sola grabación,
un solo archivo: pausar no la corta en pedazos. Nada se envía hasta que
terminás.

**Dejá la pantalla encendida y Sesión abierta.** La app pide mantener la
pantalla encendida mientras grabás; si el sistema la apaga igual, aparece
*"La pantalla se apagó: la grabación se puede cortar. Mantenela encendida."*
Con la pantalla apagada el teléfono puede dejar de entregar sonido sin avisar.

Lo que corta la captura es que el micrófono deje de estar (una llamada, otra app
que se lo lleve, la pista silenciada más de tres segundos), que pase un rato sin
que entre sonido (dos minutos de aviso y cinco de corte con la pantalla a la
vista; un minuto con la pantalla oculta), que la pantalla se apague y el
navegador descargue la página, o llegar al límite de tiempo. En todos esos casos
la grabación queda **pausada**, lo grabado se conserva, y sos vos quien decide
si reanuda o termina. **Ninguna interrupción envía nada sola.**

### Pausar

**Pausar** detiene la captura y aparece **En pausa**. El cronómetro se detiene
y el tiempo en pausa no cuenta. **Reanudar** sigue la captura de audio en el
mismo archivo.

### Si se corta el micrófono o se interrumpe la captura

La pantalla dice qué pasó y que lo grabado está a salvo; por ejemplo: *"Se cortó
el micrófono. Lo grabado está a salvo."*, *"Dejó de entrar sonido y se pausó la
grabación. Lo grabado está a salvo."* o *"La pantalla se apagó y se pausó la
grabación. Lo grabado está a salvo."* Elegí **Reanudar** (vuelve a pedir el
micrófono) o **Terminar la sesión** con lo que haya. Durante la interrupción no
se graba. La recuperación completa no está garantizada: lo que el teléfono no
llegó a capturar no se puede recuperar.

## Terminar

1. Tocá **Terminar la sesión** (el botón rojo). No hay pantalla intermedia.
2. Aparece **Guardando…** con el progreso: la app cifra el archivo entero con la
   clave de la sesión, lo sube y espera que el servidor confirme que llegó.
3. Al terminar aparece *"Te avisamos cuando la nota esté lista"*, la app vuelve
   sola a la ficha y el turno queda marcado como **realizado**; su recordatorio
   pendiente se cancela.

Con la confirmación en la mano, la app borra la copia cifrada del teléfono.

El límite es de **150 minutos** de grabación, con un aviso a los **135
minutos**: *"Quedan 15 minutos de grabación"*. Al llegar al límite la captura
queda pausada: *"Llegaste a las 2 horas y media de grabación. Lo grabado está a
salvo."* Todavía tenés que tocar **Terminar la sesión** para que se envíe y se
procese. No se envía sola.

## Si la subida falla

La pantalla dice *"No se pudo guardar el audio. Está a salvo en tu teléfono.
Probá de nuevo."* con un botón **Reintentar**. Nada se borra: el archivo
cifrado sigue en memoria y la copia cifrada en el teléfono. Poné el teléfono en
una conexión buena y tocá **Reintentar** las veces que haga falta. No des por
guardada una sesión hasta ver *"Te avisamos cuando la nota esté lista"*.

Si el audio ya subió pero el turno no quedó marcado, dice *"La sesión se guardó,
pero el turno quedó como agendado. Probá de nuevo."*: **Reintentar** repite solo
ese paso.

## Si se cerró la app o el navegador

Volvé a la pantalla de grabar de **ese mismo turno**, en el mismo teléfono. La
app encuentra la copia cifrada y dice *"Quedó una grabación de ~N min sin
enviar"*, con **Guardarla ahora** y **Descartarla**. Para abrirla, la app le pide
al servidor la clave de esa sesión (nunca quedó en el teléfono) y después la
envía como si hubieras tocado **Terminar la sesión**.

Si el navegador solo descargó la página con la pantalla apagada, al volver
recupera lo guardado y queda **En pausa** con *"La pantalla se apagó y se pausó
la grabación. Lo grabado está a salvo."*: podés **Reanudar** o **Terminar la
sesión**.

Empezar una grabación nueva del mismo turno reemplaza la copia anterior.

## Qué hace la app por detrás

- Cada sesión tiene una clave propia, que genera el servidor y el teléfono pide
  al empezar a grabar. Cada trozo se cifra en el teléfono con esa clave antes
  de guardarse en el almacenamiento del navegador; en el teléfono no queda audio
  sin cifrar. Lo que está en la memoria de la pestaña mientras grabás no se
  guarda en claro en ningún lado.
- Al terminar, el archivo entero se cifra con esa misma clave y viaja cifrado.
  El servidor comprueba que el archivo llegó antes de dar la grabación por
  terminada.
- Con la subida confirmada, la copia cifrada del teléfono se borra.
- Al aprobar la nota, la app destruye la clave con la que trabaja; un respaldo
  de la base puede conservar esa clave hasta 12 meses. Ver
  `12-camino-del-audio-y-privacidad.md`.

## Lo que NO hace

- **No graba video.**
- **No transcribe en vivo**: no ves texto mientras grabás.
- **No graba sin autorización vigente.**
- **No graba dos veces el mismo turno**: un turno tiene una sola sesión clínica.
- **No sube nada mientras grabás**: el archivo sale entero al terminar.
- **No garantiza seguir grabando con la pantalla bloqueada**: si el sistema
  suelta el micrófono, la grabación queda pausada con lo capturado hasta ahí.
- **No te avisa al teléfono** cuando la nota está lista.
- **No traduce todos los errores del micrófono**: si el navegador niega el
  permiso, puede mostrar su propio mensaje, a veces en inglés.

<!-- fuentes:
src/app/(dashboard)/grabar/[turnoId]/page.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/medidor-audio.tsx
src/components/grabacion/GrabadorSesion.tsx
src/hooks/useGrabacionSesion.ts
src/lib/grabacion-storage.ts
src/lib/grabacion-cifrado.ts
src/lib/grabacion-captura.ts
src/app/api/_lib/casos-uso/audio.ts
src/lib/limites-prueba.ts
src/lib/glosario.ts
-->
