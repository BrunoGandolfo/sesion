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
  tocás **Grabar sesión** (ese turno no genera recordatorio). Ese turno se crea
  aunque a esa hora haya otro en la agenda: la sesión está ocurriendo, y un
  choque de horarios no impide grabarla.
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

Si el teléfono no dejó que Sesión mantenga la pantalla encendida (por el ahorro
de batería, por ejemplo), lo dice **antes de empezar**, debajo del botón: *"Este
teléfono no dejó que Sesión mantenga la pantalla encendida. Si se bloquea, la
grabación se puede cortar: sacá el bloqueo automático o tocá la pantalla cada
tanto."* Igual podés grabar.

Arriba ves el nombre de la paciente y la hora del turno. Un punto que respira
marca que está grabando, el cronómetro cuenta el **audio que realmente entró** y
debajo hay un medidor de sonido: barras que se mueven con la voz y una leyenda
que dice *"El audio se escucha bien"*. Si pasan dos minutos sin sonido con la
pantalla a la vista, las barras quedan en cero y la leyenda pasa a *"No está
entrando sonido"*. El medidor sólo avisa: nunca corta la grabación. Al pie lo
recuerda: *"Dejá la pantalla encendida mientras grabás."*

## Mientras grabás

El navegador entrega el audio **cada segundo** y la app intenta guardar cada
entrega en el teléfono apenas llega. Si el navegador no deja guardar (por falta
de espacio, por ejemplo), la grabación sigue sin avisar, pero queda solo en la
memoria de la pantalla abierta: si se cierra, se pierde. Es una sola grabación, un solo
archivo, de punta a punta: pausar no la corta en pedazos. Nada se envía hasta
que terminás.

**Dejá la pantalla encendida y Sesión abierta.** La app pide mantener la
pantalla encendida mientras grabás y mientras envía; si el teléfono la apaga
igual, aparece *"La pantalla se apagó. Con la pantalla apagada el teléfono puede
dejar de grabar: mantenela encendida."* y queda ahí hasta que tocás
**Entendido**. Con la pantalla apagada el teléfono puede dejar de entregar
sonido sin avisar, y eso la app no lo puede evitar.

**Si dejó de llegar audio, la pantalla lo dice con las horas.** Al volver de un
bloqueo vas a ver, por ejemplo, *"No se grabó entre las 10:12 y las 10:20. Ahora
está grabando de nuevo: podés seguir o terminar."* Tocá **Seguir grabando** o
**Terminar la sesión**. Mientras el audio todavía no volvió dice *"No está
llegando audio desde las 10:12."* Ese rato no cuenta como tiempo grabado.

**Una llamada entrante no corta la grabación.** El teléfono silencia el
micrófono mientras dura y la pantalla dice *"El teléfono silenció el micrófono
(¿una llamada?). La grabación sigue abierta y vuelve sola cuando lo libere."*

**Ninguna interrupción envía nada sola.**

### Pausar

**Pausar** detiene la captura y aparece **En pausa**. El cronómetro se detiene
y el tiempo en pausa no cuenta. **Reanudar** sigue la captura de audio en el
mismo archivo, las veces que haga falta. Justo después de tocar, el botón queda
apagado un instante: un doble toque no pausa ni reanuda dos veces.

### Si el micrófono se desconecta

Si otra app se lleva el micrófono del todo o se le quita el permiso, la
grabación **termina ahí**: *"El micrófono se desconectó y la grabación terminó
acá. No se puede continuar esta grabación: guardá lo grabado."* El único botón
es **Guardar lo grabado**, que la envía como cualquier otra. No se puede seguir
en el mismo archivo, y pegar dos grabaciones lo rompería. La recuperación
completa no está garantizada: lo que el teléfono no llegó a capturar no se puede
recuperar.

## Terminar

1. Tocá **Terminar la sesión** (el botón verde salvia). No hay pantalla intermedia.
2. La pantalla entera pasa a decir *"Preparando la grabación…"* y enseguida
   *"Enviando la grabación… 37 %. No cierres esta pantalla."*, con un indicador
   que gira y una barra. Mientras envía, el menú de abajo no está: no hay nada
   que tocar hasta que llegue. La pantalla sigue encendida.
3. Cuando el servidor confirma que llegó, dice *"La grabación llegó bien. La
   nota va a estar lista en unos minutos: te avisamos acá, en la app, cuando
   esté."* y se queda ahí hasta que tocás **Volver a la ficha**. Mientras se
   escribe, la ficha y **Hoy** muestran *"Procesando la sesión de …"*; cuando
   termina aparece arriba, en cualquier pantalla, una franja *"La nota de … está
   lista"* con **Revisar**, y el ítem **Hoy** del menú lleva un número. No llega ninguna notificación al teléfono. El turno queda marcado como **realizado** y su
   recordatorio pendiente se cancela.

Con la confirmación en la mano, la app borra la copia del teléfono.

Si grabaste **menos de 10 segundos** (un toque sin querer), al tocar Terminar
no se envía nada: dice *"Grabaste menos de 10 segundos. No se guardó nada."* y
el botón **Grabar sesión** vuelve a estar ahí, para el mismo turno.

El límite es de **150 minutos** de audio grabado, con un aviso a los **135
minutos**: *"Quedan 15 minutos de grabación"*. Al llegar al límite la captura
queda pausada: *"Llegaste a las 2 horas y media de grabación. Lo grabado está a
salvo: tocá Terminar la sesión para enviarlo."* Todavía tenés que tocar
**Terminar la sesión** para que se envíe y se procese. No se envía sola.

## Si la subida falla

La pantalla dice *"No se pudo guardar el audio. Está a salvo en tu teléfono.
Probá de nuevo."* con un botón **Reintentar**. Nada se borra: la grabación sigue
guardada en el teléfono. Poné el teléfono en una conexión buena y tocá
**Reintentar** las veces que haga falta. No des por guardada una sesión hasta
ver *"La grabación llegó bien."*

Si el audio ya subió pero el turno no quedó marcado, dice *"La sesión se guardó,
pero el turno quedó como agendado. Probá de nuevo."*: **Reintentar** repite solo
ese paso.

## Si se cerró la app o el navegador

Volvé a la pantalla de grabar de **ese mismo turno**, en el mismo teléfono. La
app encuentra la copia y dice *"Quedó una grabación de ~N min sin enviar"*, con
**Guardarla ahora** y **Descartarla**. **Guardarla ahora** la envía tal cual,
como si hubieras tocado **Terminar la sesión**. Esa grabación no se puede
continuar: sólo enviar o descartar.

Si esa sesión ya había llegado al servidor (está procesándose o ya tiene nota),
la app borra sola la copia del teléfono en vez de ofrecerla otra vez.

Empezar una grabación nueva del mismo turno reemplaza la copia anterior.

## Si quedó una grabación sin terminar

Si el envío de una grabación se cortó hace **más de 30 minutos**, o una
grabación quedó abierta **más de tres horas** (el tope de dos horas y media más
un margen), la app entiende que quedó a medias —el teléfono se apagó, se cerró
el navegador, se cortó la subida— y deja de decir *"Procesando"*: en **Hoy** y
en la ficha dice **Grabación sin terminar**, y en **Hoy**, en el bloque de
pendientes, aparece con el nombre de la paciente y dos opciones:

- **Subir desde este teléfono** abre la pantalla de grabar de ese turno. Si la
  copia quedó en ese teléfono, ofrece **Guardarla ahora**. Si grabaste en otro
  teléfono, abrilo desde ese.
- **Descartar** pregunta *"¿Descartar esta grabación?"* y, al confirmar con
  **Descartar la grabación**, la sesión se quita y el turno queda libre para
  volver a grabar. Si el audio llegó a subirse, también se borra. No queda
  nada para eliminar después. No se puede deshacer.

Antes no aparece: puede estar grabando o enviando ahora mismo. Mientras grabás
no llega nada al servidor, por eso una grabación abierta tiene más margen.

Si nadie hace nada, **a los siete días la app la abandona sola**. Si el audio
había llegado, se borra y la sesión queda entre las notas que no se pudieron
escribir, con el motivo *"La grabación quedó a medias."*, para que te enteres;
ahí sólo se puede **Eliminar**. Si no había llegado, la sesión se quita.
Mientras tanto la copia del teléfono todavía se puede enviar.

## Qué hace la app por detrás

- **La app no cifra el audio.** Mientras grabás queda en el almacenamiento del
  navegador de tu teléfono, protegido por el bloqueo del teléfono. Viaja al
  servidor por una conexión cifrada (TLS), el almacén donde espera lo cifra en
  reposo. Se pide borrarlo cuando aprobás la nota o eliminás la sesión, no
  apenas termina de procesarse. Las notas y la transcripción sí las
  cifra la app. Ver `12-camino-del-audio-y-privacidad.md`.
- El archivo se envía tal como se grabó, sin copiarlo entero a la memoria: por
  eso una sesión de dos horas no congela la pantalla.
- El servidor comprueba que el archivo llegó antes de dar la grabación por
  terminada. Con la subida confirmada, la copia del teléfono se borra.
- Junto con la grabación viaja un registro técnico de lo que le pasó al
  grabador —horas de pausas y huecos, si la pantalla se apagó, cuántos trozos
  llegaron—, sin nada de lo que se dijo en la sesión. Sirve para entender un
  corte sin tener que adivinar.

## Lo que NO hace

- **No graba video.**
- **No transcribe en vivo**: no ves texto mientras grabás.
- **No graba sin autorización vigente.**
- **No graba dos veces el mismo turno**: un turno tiene una sola sesión clínica.
- **No sube nada mientras grabás**: el archivo sale entero al terminar.
- **No cifra el audio en el teléfono.**
- **No garantiza seguir grabando con la pantalla bloqueada**: eso lo decide el
  teléfono. Si dejó de entregar audio, al volver la pantalla te dice entre qué
  horas no se grabó.
- **No continúa una grabación después de cerrar la app**: lo que quedó se envía
  o se descarta.
- **No te avisa con el teléfono bloqueado ni con la app cerrada** cuando la
  nota está lista: mientras la tengas abierta aparece la franja arriba y el
  número en **Hoy**; si no, la franja sale la próxima vez que abrís Sesión.
- **No traduce todos los errores del micrófono**: si el navegador niega el
  permiso, puede mostrar su propio mensaje, a veces en inglés.

<!-- fuentes:
src/app/(dashboard)/grabar/[turnoId]/page.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/medidor-audio.tsx
src/components/grabacion/GrabadorSesion.tsx
src/hooks/useGrabacionSesion.ts
src/lib/grabacion-storage.ts
src/hooks/usePantallaEncendida.ts
src/lib/grabacion-captura.ts
src/app/api/_lib/casos-uso/audio.ts
src/app/api/_lib/casos-uso/sesion/abandonar.ts
src/app/api/_lib/casos-uso/mantenimiento.ts
src/app/api/_lib/casos-uso/pendientes-terapeuta.ts
src/app/(dashboard)/_components/pendientes.tsx
src/lib/sesion-clinica/estados.ts
src/lib/limites-prueba.ts
src/lib/glosario.ts
src/components/layout/avisos-de-notas.tsx
src/components/layout/globito-hoy.tsx
-->
