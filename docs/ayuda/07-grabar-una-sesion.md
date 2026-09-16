# Grabar una sesión

**Para qué sirve.** Grabar el audio de la sesión para que la app escriba después
el borrador de la nota clínica.

## Antes de nada: el turno y la autorización

- **Se graba siempre un turno agendado.** Si tocás **Grabar** en la cabecera de
  la ficha y la paciente no tiene turno hoy, la app dice *"Agendá el turno para
  grabar la sesión"* y ofrece **Ir a la agenda**. No crea un turno sola.
- **Sin autorización vigente no se graba.** La pantalla muestra **Falta la
  autorización** y *"Para iniciar o reanudar necesitás la autorización vigente
  de la paciente."* El botón para grabar queda apagado. Volvé con **Volver a la
  ficha** y firmala ahí. Ver `04-pacientes-y-ficha.md`.

## Grabar

1. Entrá desde **Hoy** (**Grabar sesión**), desde el turno en la agenda, o desde
   la ficha con el botón **Grabar** de la cabecera.
2. Mientras se prepara dice *"Preparando la grabación y comprobando si hay una
   copia para recuperar…"*.
3. Tocá **Grabar sesión**.
4. La primera vez, el navegador te pide permiso para usar el micrófono.

Arriba ves **Sesión clínica**, el nombre de la paciente y la hora del turno. El
estado dice **Grabando** y el cronómetro cuenta el tiempo grabado. No hay medidor
de sonido.

## Mientras grabás

La app corta el audio en **tramos de un minuto**. Cada tramo **se cifra en el
teléfono antes de guardarse** y se envía mientras seguís grabando. Mientras
tanto dice: *"Grabando. Cada segmento se guarda cifrado y se envía mientras
seguís."*

**No bloquees la pantalla mientras grabás** y no cambies de app. Si la pantalla
se apaga, se bloquea o pasás a otra app, **la captura se pausa en ese momento**.
La app no mantiene la pantalla encendida por vos. Al pie lo recuerda: *"Mantené
la pantalla encendida. Si se bloquea o se interrumpe el micrófono, el tramo
puede quedar incompleto y habrá que reanudar."*

Si intentás salir de la pantalla mientras grabás, la app pregunta antes: si
salís, la captura se pausa y lo grabado se conserva.

### Pausar

**Pausar** detiene la captura y el estado pasa a **En pausa**. El cronómetro se
detiene y el tiempo en pausa no cuenta. Para seguir, tocá **Reanudar grabación**:
la app vuelve a comprobar la autorización y a pedir el micrófono.

### Si se corta el micrófono o se interrumpe la captura

Una llamada, otra app o la pantalla bloqueada interrumpen la captura. El estado
pasa a **En pausa** y aparece: *"La captura se interrumpió. Este tramo puede estar
incompleto; revisá el micrófono antes de reanudar."*

Lo que ya estaba guardado se conserva. El tramo que se estaba grabando en ese
momento puede quedar incompleto. Elegí **Reanudar grabación** o **Terminar y
enviar**. Durante la interrupción no se graba nada. La recuperación completa no
está garantizada: lo que el teléfono no llegó a capturar no se puede recuperar.

## Terminar

1. Tocá **Terminar y enviar**. No hay pantalla intermedia.
2. La app guarda lo pendiente y termina de enviar los tramos.
3. Cuando el servidor tiene todo, el estado pasa a **Audio recibido**, aparece
   *"El servidor recibió la grabación. La nota está en camino."* y el enlace
   **Ver la sesión**. La app no vuelve sola a la ficha.

En ese momento el turno queda marcado como **realizado** y su recordatorio
pendiente se cancela.

El límite es de **150 minutos** de grabación, con un aviso a los **135
minutos**: *"Llevás 135 minutos. La captura se pausará al llegar a 150."* Al
llegar al límite la captura queda pausada: *"Llegaste al límite. Elegí Terminar
para procesar lo guardado."* Los tramos ya se enviaron, pero todavía tenés que
terminar para que se procese. No se procesa sola.

## Si el envío falla

La app reintenta sola, cada vez más espaciado y apenas vuelve la conexión.
Mientras no confirma, dice: *"No pudimos confirmar el envío. La copia cifrada se
conserva y se reintentará."* con el botón **Comprobar y reintentar envío**.

Si terminaste pero el cierre no se confirmó, el estado dice **Pendiente de
envío** y aparece **Enviar grabación pendiente**. No des por guardada una sesión
hasta ver **Audio recibido**.

## Si se cerró la app o el navegador

Volvé a la pantalla de grabar de **ese mismo turno**, en el mismo teléfono. La
app recupera lo guardado: *"Se recuperó lo guardado. El tramo que estaba en
captura al cerrarse la app puede estar incompleto."* y *"Hay una grabación de
este turno. Podés recuperar y enviar lo guardado o reanudarla."* Podés
**Reanudar grabación** o **Terminar y enviar**.

**Volver a grabar no reemplaza la copia anterior.** La app retoma la grabación
que ya existe para ese turno. Si el servidor ya tiene audio de ese turno y lo
intentás desde otro dispositivo, dice: *"Ya existe audio en el servidor para este
turno. Volvé al dispositivo que conserva la grabación; no se reemplazó nada."*

Si el servidor ya no conoce esa grabación (por ejemplo, porque eliminaste la
sesión), aparece **Conservar copia y habilitar otra grabación**. Guarda la copia
anterior aparte, sin borrarla, y deja grabar de nuevo ese turno.

## Qué hace la app por detrás

- Cada sesión tiene una clave propia. Los tramos se cifran en el teléfono con esa
  clave antes de guardarse en el almacenamiento del navegador. En el teléfono no
  queda audio sin cifrar; el tramo en curso existe sin cifrar solo en la memoria
  mientras se graba, hasta un minuto.
- Los tramos viajan ya cifrados, uno por uno, y el servidor comprueba que llegue
  cada uno completo y en orden.
- Si la misma grabación está abierta en otra pestaña, la app no deja grabar en
  las dos: *"Esta grabación está abierta en otra pestaña"*.
- Si abrís la pantalla de grabar en un navegador que tenía grabaciones de prueba
  de la versión anterior, sin cifrar, la app las borra y avisa: *"Se retiraron
  las grabaciones de prueba anteriores, que estaban sin cifrar."*
- La copia cifrada queda guardada en el navegador aunque la nota ya esté
  aprobada. Sin la clave, que se destruye al aprobar, no se puede abrir.
- Si hubo una interrupción, la nota lo avisa: **Audio posiblemente incompleto**.

## Lo que NO hace

- **No graba video.**
- **No transcribe en vivo**: no ves texto mientras grabás.
- **No graba sin turno** ni **sin autorización vigente**.
- **No graba dos veces el mismo turno**: un turno tiene una sola sesión clínica.
- **No sigue grabando con la pantalla bloqueada** ni en segundo plano.
- **No te avisa al teléfono** cuando la nota está lista.
- **No traduce todos los errores del micrófono**: si el navegador niega el
  permiso, puede mostrar su propio mensaje, a veces en inglés.

<!-- fuentes:
src/app/(dashboard)/grabar/[turnoId]/page.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/hooks/useAudioGrabacion.ts
src/lib/audio/grabadora.ts
src/lib/audio/captura.ts
src/lib/audio/cifrado.ts
src/lib/audio/almacen.ts
src/lib/audio/sincronizar.ts
src/lib/audio/contrato.ts
src/app/api/_lib/casos-uso/audio.ts
src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx
src/lib/glosario.ts
-->
