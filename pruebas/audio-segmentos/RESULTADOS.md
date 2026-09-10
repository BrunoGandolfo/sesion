# Prueba de factibilidad: segmentos de audio independientes

Fecha: 10 de septiembre de 2026. Repositorio: BrunoGandolfo/sesion. Rama: `prueba-audio`.

**Página pública:** https://prueba-audio.vercel.app/ — proyecto Vercel independiente `prueba-audio`.

**Chromium / WebM-Opus: segmentos independientes viables a 60 s en la muestra de escritorio, no viables a 10 s con el umbral solicitado.** A 60 s se conservaron 125/125 pitidos y las fronteras midieron 980.771 y 999.728 ms. Es una viabilidad acotada a esa corrida; falta confirmar otros dispositivos y las interrupciones con ese tamaño.

En la matriz de 10 s, 12 fronteras superan 40 ms; máximo desvío absoluto 50.159 ms. Poder decodificar los archivos no demuestra continuidad de la captura.

**WebKit de escritorio instalado: segmentos independientes no viables en este binario:** no expone `MediaRecorder`. No hay una medición de AAC ni un veredicto sobre Safari/iPhone. Los cuatro casos quedaron bloqueados antes de iniciar la fuente.

## Entorno y alcance

- Playwright 1.63.0; Chromium 153.0.8010.12; WebKit 26.6. Ubuntu 24.04 bajo WSL2 (linux 6.18.33.2-microsoft-standard-WSL2). Node 22.23.1.
- Chromium con ventana real bajo Xvfb/Openbox, controlado por Playwright vía CDP con `noDefaults: true`. No se emulan el foco ni los relojes. Cambiar de pestaña produce `visibilitychange` real.
- Salida de audio virtual privada PulseAudio, reloj en tiempo real. No se usa el puente de sonido de WSLg en la matriz final. Esta salida reemplaza al parlante de la máquina de pruebas; no sustituye el MediaRecorder ni su codificador.
- Fuente sintética de 1000 Hz: envolvente de 80 ms, un pitido cada 1000 ms mediante Web Audio. Se conserva la fase durante la pausa, con el reloj de audio activo y la envolvente silenciada.
- MediaRecorder nuevo por segmento; bitrate solicitado 64000 bit/s; selección automática de MIME. Cada archivo tiene su propia cabecera. El siguiente empieza sin esperar la persistencia del anterior.
- Cada transacción solicita y verifica `durability: strict`; el archivo se anuncia guardado después de `complete`. Se probó recarga de página, no corte de energía ni cierre forzado del sistema operativo.
- Base de la rama: `f3b37d1e8561bceac4884a5cd2233d459810ff96`. SHA-256 del HTML final: `05156ca79de80c8cd25ccac996f58b45a9cb90e03e7271a1fa7043dc0cbf71a6`. Los JSON incluyen el hash del HTML que midieron.

**WebKit de escritorio NO es un iPhone.** Playwright distribuye un WebKit propio; su documentación advierte que los códecs dependen de la plataforma. En el parche de compilación de los puertos GTK y WPE aparece `ENABLE_MEDIA_RECORDER PRIVATE OFF`. Se verificó `typeof MediaRecorder === "undefined"` tanto con ventana como sin ella. Instalar bibliotecas GStreamer no incorpora una API excluida del binario. [Documentación de Playwright](https://playwright.dev/docs/browsers#webkit), [parche de compilación consultado](https://github.com/microsoft/playwright/blob/efb0761d304adfda66ad91f6596ac33eb1036ec9/browser_patches/webkit/patches/bootstrap.diff).

## Protocolo y significado de los números

- Continua: 65 segundos grabados, cortes cada 10 segundos y un último archivo parcial.
- Pausa: pausa alrededor de 27,5 s, cinco segundos pausada y fin en la marca de 65 s de la ventana; quedan aproximadamente 60 s de captura activa. Pausar finaliza el archivo en curso y reanudar crea otro.
- Recarga: a los 35 s se toma una observación externa y se recarga. Se conservan los archivos confirmados. La página permanece abierta hasta el segundo 65, sin reiniciar la grabación. Es una prueba de recuperación de una captura interrumpida a los 35 s, no 65 s de audio ni una reanudación automática.
- Segundo plano: otra pestaña al segundo 20 durante 20 segundos completos, luego regreso y fin al segundo 65. El arnés exige `document.visibilityState === "hidden"`; no alcanza con quitarle el foco a una ventana.
- Todos los archivos se decodifican por separado con `decodeAudioData`. El detector RMS trabaja sobre las muestras concatenadas y agrupa un pitido que atraviese un corte. Resolución de ventana aproximadamente 1 ms; los tres decimales son el cálculo sobre muestras, no una exactitud acústica de 1 microsegundo.
- Calibración antes de cada caso: desplazamientos conocidos de −80, −40, 0, +40 y +80 ms; intervalos esperados 920, 960, 1000, 1040 y 1080 ms. Los JSON conservan cada comparación.
- Desvío = intervalo observado − 1000 ms. Un valor negativo indica que ese tramo del audio concatenado quedó más corto; uno positivo, más largo. El umbral es estrictamente mayor a 40 ms, redondeado a 0,001 ms para evitar errores de coma flotante en el límite.
- Los pitidos esperados por reloj y los que corresponden al avance del reloj de la fuente se guardan por separado. Una señal de período fijo no puede localizar por sí sola pérdidas de segundos enteros; se contrastan también conteo y duración.

## Matriz principal

| Navegador / caso | Archivos | Decodificables | Pitidos esperados / encontrados | Audio decodificado (s) | Reloj activo (s) | Fronteras: intervalos (ms) |
|---|---:|---|---|---:|---:|---|
| Chromium / continua | 7 | 1: sí; 2: sí; 3: sí; 4: sí; 5: sí; 6: sí; 7: sí | 65 / 65 | 64.740 | 65.031 | 1→2: 959.819 **✕**; 2→3: 959.819 **✕**; 3→4: 949.841 **✕**; 4→5: 970.794; 5→6: 949.841 **✕**; 6→7: 959.819 **✕** |
| Chromium / pausa | 7 | 1: sí; 2: sí; 3: sí; 4: sí; 5: sí; 6: sí; 7: sí | 60 / 60 | 59.700 | 59.978 | 1→2: 969.796; 2→3: 949.841 **✕**; 3→4: 1006.712; 4→5: 978.776; 5→6: 977.778; 6→7: 988.753 |
| Chromium / recarga | 3 | 1: sí; 2: sí; 3: sí | 35 / 30 | 29.880 | 35.036 | 1→2: 969.796; 2→3: 959.819 **✕** |
| Chromium / segundo-plano | 7 | 1: sí; 2: sí; 3: sí; 4: sí; 5: sí; 6: sí; 7: sí | 65 / 65 | 64.800 | 65.037 | 1→2: 959.819 **✕**; 2→3: 959.819 **✕**; 3→4: 949.841 **✕**; 4→5: 970.794; 5→6: 949.841 **✕**; 6→7: 959.819 **✕** |
| WebKit / continua | 0 | No hay archivos | No se generó señal | — | No iniciado | No medibles: MediaRecorder ausente |
| WebKit / pausa | 0 | No hay archivos | No se generó señal | — | No iniciado | No medibles: MediaRecorder ausente |
| WebKit / recarga | 0 | No hay archivos | No se generó señal | — | No iniciado | No medibles: MediaRecorder ausente |
| WebKit / segundo-plano | 0 | No hay archivos | No se generó señal | — | No iniciado | No medibles: MediaRecorder ausente |

✕ = supera el desvío permitido. En recarga, reloj y conteo esperado de la tabla provienen de la observación externa inmediatamente anterior a recargar. La página recuperada sólo dispone de su último checkpoint.

### Chromium: continua

[Evidencia completa](evidencia/chromium-continua.json). Estado del arnés: **ejecutado**.

Reloj de la fuente: 65.039 s. Pitidos según ese reloj: 65. Diferencia decodificado − reloj de la página: -291.359 ms.

| Archivo | Bytes | MIME real | Reloj (s) | Decodificado (s) | Motivo de cierre |
|---:|---:|---|---:|---:|---|
| 1 | 10519 | audio/webm;codecs=opus | 10.005 | 9.960 | rotation |
| 2 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 3 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 4 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 5 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 6 | 10519 | audio/webm;codecs=opus | 10.001 | 9.960 | rotation |
| 7 | 5409 | audio/webm;codecs=opus | 5.021 | 4.980 | finish |

Desvíos por frontera, en orden: -40.181 ms; -40.181 ms; -50.159 ms; -29.206 ms; -50.159 ms; -40.181 ms.

Descarga individual: completada. ZIP: 8 entradas, CRC de todas las entradas correcto. Separación máxima **añadida por la programación de reproducción**: 0.000 ms. Esto verifica la programación, no una escucha en el DAC de un teléfono.

### Chromium: pausa

[Evidencia completa](evidencia/chromium-pausa.json). Estado del arnés: **ejecutado**.

Reloj de la fuente: 59.977 s. Pitidos según ese reloj: 60. Diferencia decodificado − reloj de la página: -278.159 ms.

| Archivo | Bytes | MIME real | Reloj (s) | Decodificado (s) | Motivo de cierre |
|---:|---:|---|---:|---:|---|
| 1 | 10519 | audio/webm;codecs=opus | 10.001 | 9.960 | rotation |
| 2 | 10519 | audio/webm;codecs=opus | 10.003 | 9.960 | rotation |
| 3 | 7575 | audio/webm;codecs=opus | 7.524 | 7.500 | pause |
| 4 | 29714 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 5 | 29714 | audio/webm;codecs=opus | 10.001 | 9.960 | rotation |
| 6 | 29714 | audio/webm;codecs=opus | 10.001 | 9.960 | rotation |
| 7 | 10306 | audio/webm;codecs=opus | 2.444 | 2.400 | finish |

Desvíos por frontera, en orden: -30.204 ms; -50.159 ms; 6.712 ms (pausa deliberada); -21.224 ms; -22.222 ms; -11.247 ms.

Pausa observada externamente: 5024.484 ms.

Descarga individual: completada. ZIP: 8 entradas, CRC de todas las entradas correcto. Separación máxima **añadida por la programación de reproducción**: 0.000 ms. Esto verifica la programación, no una escucha en el DAC de un teléfono.

### Chromium: recarga

[Evidencia completa](evidencia/chromium-recarga.json). Estado del arnés: **ejecutado**.

Reloj de la fuente: 34.992 s. Pitidos según ese reloj: 35. Diferencia decodificado − reloj de la página: -5120.968 ms.

| Archivo | Bytes | MIME real | Reloj (s) | Decodificado (s) | Motivo de cierre |
|---:|---:|---|---:|---:|---|
| 1 | 10519 | audio/webm;codecs=opus | 10.003 | 9.960 | rotation |
| 2 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 3 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |

Desvíos por frontera, en orden: -30.204 ms; -40.181 ms.

Se conservaron los mismos índices, tamaños, MIME y tiempos antes/después de la recarga: **sí**. Audio guardado: 29.880 s frente a 35.036 s activos antes de interrumpir. Diferencia: 5156.268 ms; incluye el archivo en curso no guardado y las pérdidas pequeñas de codificación/cortes.

Descarga individual: completada. ZIP: 4 entradas, CRC de todas las entradas correcto. Separación máxima **añadida por la programación de reproducción**: 0.000 ms. Esto verifica la programación, no una escucha en el DAC de un teléfono.

### Chromium: segundo-plano

[Evidencia completa](evidencia/chromium-segundo-plano.json). Estado del arnés: **ejecutado**.

Reloj de la fuente: 65.051 s. Pitidos según ese reloj: 65. Diferencia decodificado − reloj de la página: -237.059 ms.

| Archivo | Bytes | MIME real | Reloj (s) | Decodificado (s) | Motivo de cierre |
|---:|---:|---|---:|---:|---|
| 1 | 10519 | audio/webm;codecs=opus | 10.001 | 9.960 | rotation |
| 2 | 10519 | audio/webm;codecs=opus | 10.001 | 9.960 | rotation |
| 3 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 4 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 5 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 6 | 10519 | audio/webm;codecs=opus | 10.000 | 9.960 | rotation |
| 7 | 5423 | audio/webm;codecs=opus | 5.030 | 5.040 | finish |

Desvíos por frontera, en orden: -40.181 ms; -40.181 ms; -50.159 ms; -29.206 ms; -50.159 ms; -40.181 ms.

Estado oculto comprobado: **hidden**; permanencia 20034.355 ms. Los eventos completos de visibilidad están en el JSON.

Descarga individual: completada. ZIP: 8 entradas, CRC de todas las entradas correcto. Separación máxima **añadida por la programación de reproducción**: 0.000 ms. Esto verifica la programación, no una escucha en el DAC de un teléfono.

## Comparaciones adicionales

Son variantes del arnés sobre el mismo HTML. Las opciones se aplican antes de cargar la página y quedan explícitas en el JSON; no cambian el comportamiento predeterminado de la página pública.

| Variante | Duración / segmento (s) | Archivos decodificables | Esperados / encontrados | Decodificado (s) | Intervalos de frontera (ms) | Bytes totales |
|---|---|---|---|---:|---|---:|
| [timeslice20](evidencia/chromium-continua-timeslice20.json) | 65 / 10 | 7/7 | 65/65 | 64.740 | 959.819 **✕**; 949.841 **✕**; 959.819 **✕**; 960.816; 959.819 **✕**; 949.841 **✕** | 76092 |
| [60s](evidencia/chromium-continua-60s.json) | 125 / 60 | 3/3 | 125/125 | 124.980 | 980.771; 999.728 | 138623 |
| [pcm16k](evidencia/chromium-continua-pcm16k.json) | 65 / 10 | 7/7 | 65/65 | 65.010 | 1000.000; 1000.000; 1000.000; 1000.000; 1000.000; 1000.000 | 4208163 |
| [12s](evidencia/chromium-continua-12s.json) | 65 / 12 | 6/6 | 65/65 | 64.980 | 999.728; 1000.726; 989.751; 939.864 **✕**; 999.728 | 68289 |
| [opus16k](evidencia/chromium-continua-opus16k.json) | 65 / 10 | 7/7 | 65/65 | 64.800 | 960.000; 960.000; 960.000; 950.000 **✕**; 970.000; 1000.000 | 70108 |

- `timeslice20`: la misma rotación de 10 s, pero `MediaRecorder.start(20)` entrega fragmentos internos con más frecuencia; se juntan todos los de cada instancia antes de guardar su archivo.
- `60s`: instancias de 60 s durante 125 s, para observar dos fronteras con el tamaño propuesto para el teléfono.
- `12s`: seis archivos durante 65 s, para comprobar si otro tamaño de segmento reduce el problema observado a 10 s.
- `opus16k`: control con Opus, 16000 Hz y un canal, frente a PCM con esa misma frecuencia y cantidad de canales. Mantiene cortes cada 10 s.
- `pcm16k`: MediaRecorder con `audio/webm;codecs=pcm`, fuente a 16000 Hz y un canal, segmentos de 10 s. No usa AudioWorklet. Es una comparación de códec en Chromium; no prueba que Safari lo admita ni que un micrófono entregue esa frecuencia sin un paso de conversión.

PCM de esta prueba: 4.208 MB en 65.031 s, equivalente a aproximadamente **582.4 MB por 150 min** a esta tasa y fragmentación. Es una extrapolación del archivo sin comprimir, no una medición de una sesión de 150 min.

Se verificó en la cabecera del archivo PCM el identificador `A_PCM/FLOAT/IEEE` y profundidad de 32 bits. Por eso esta variante pesa aproximadamente el doble que PCM mono de 16 bits a 16 kHz (288 MB por 150 min), más el contenedor. [Verificación de archivos](evidencia/verificacion.json).

### Decisión propuesta a partir de estas pruebas

Mantener 60 s como candidato comprimido para la prueba en teléfono: pasó los dos cortes observados y genera menos fronteras por sesión. No adoptar cortes de 10 s con WebM/Opus tal como están. Entregar blobs internos cada 20 ms no corrigió sus pérdidas; tampoco convierte cada blob en un archivo independiente.

Doce segundos tampoco es una solución demostrada: hubo una frontera de 939,864 ms (−60,136 ms). No conviene extrapolar que cualquier duración distinta de diez segundos resuelve el problema.

PCM mediante MediaRecorder merece una comparación adicional antes de implementar AudioWorklet: en Chromium produjo 65/65 pitidos y seis intervalos de exactamente 1000 ms, dentro de la resolución del detector. A cambio, los archivos son mucho mayores. No se probó su soporte en Safari ni la conversión de un micrófono real a 16 kHz; el ajuste de frecuencia de esa corrida corresponde a la fuente sintética.

El control Opus a los mismos 16 kHz y un canal conservó 65/65 pitidos, con intervalos 960.000, 960.000, 960.000, 950.000, 970.000, 1000.000 ms. Su máximo desvío fue 50.000 ms. Por lo tanto, la mejora observada con PCM no se explica solamente por bajar la frecuencia o pasar a mono; sigue siendo una comparación acotada a este entorno.

No hay evidencia suficiente para decir que ninguna variante web comprimida sirve, ni para exigir ya la ruta AudioWorklet/PCM. Primero hace falta la prueba real de 60 s en iPhone y Android. Si esos cortes superan el umbral o el bloqueo interrumpe la captura, habrá que rediseñar la captura con esos resultados. Capturar PCM tampoco garantiza por sí mismo que el sistema operativo deje correr una página bloqueada.

## Incidencias del banco de pruebas conservadas

- El puente PulseServer de WSLg dejó de avanzar el reloj de la fuente alrededor de los 15 s, aunque el estado del AudioContext seguía siendo `running`. Se observaron archivos de sólo 110 bytes que no decodificaban. Retener los nodos y añadir una salida de escucha no corrigió ese entorno; el servidor PulseAudio privado sí. Las corridas originales se guardan como [fuente interrumpida](evidencia/preliminar-fuente-interrumpida.json), [control de 25 s](evidencia/chromium-continua-control-25.json), [control con salida audible](evidencia/chromium-continua-control-salida-25.json) y [control con PulseAudio privado](evidencia/chromium-continua-control-pulse-25.json). No se usan para el veredicto del codificador.
- La primera pausa suspendía el AudioContext. Su reanudación introdujo aproximadamente dos segundos sin avance de la fuente: 58 pitidos emitidos frente a 60 esperados por reloj. La versión final mantiene activo ese reloj, calla la envolvente y conserva su fase. Se repitió la matriz con ese ajuste; los cuatro JSON `preliminar-antes-ajuste-pausa-*` conservan la corrida anterior.
- Playwright con sus opciones habituales mantuvo la visibilidad emulada aunque se abriera otra ventana. Por eso la matriz final usa la conexión sin esas opciones y exige el evento `hidden`. No se falsificaron propiedades del documento.
- En la primera corrida, el archivo ZIP se descargó, pero el arnés esperaba un evento administrado por Playwright que no llegaba con `noDefaults`. La versión final escucha el evento de descarga del propio Chromium y verifica el ZIP con Python. La matriz final repite también esa comprobación.

## Publicación y prueba en teléfono pendiente

Se verificó sin credenciales la respuesta HTTP **200**, sin redirección; el HTML servido coincide byte por byte con el local. Contexto seguro: **true**; API de micrófono presente; ancho de página 390 px en viewport 390 px; errores JavaScript 0. [Evidencia](evidencia/publicacion.json).

La página pública ofrece la prueba con micrófono a 60 s y el modo sintético; archivos y diagnóstico quedan en IndexedDB. La descarga conjunta es ZIP con archivos completos, no la concatenación binaria de archivos comprimidos. El HTML no envía audio a la red.

Falta probar un iPhone real y un Android real durante tres minutos, con pausa y bloqueo de pantalla, y escuchar los archivos. Faltan también la modalidad PWA instalada, sesiones de 150 minutos, llamadas entrantes, presión de memoria/almacenamiento y pérdida de energía. No se sostiene todavía la promesa de perder como máximo un minuto: si el navegador demora el temporizador, el archivo en curso puede durar más. MDN documenta que los eventos de MediaRecorder se pueden retrasar, incluso por bloqueo de pantalla en Android o suspensión de captura en Safari. [MediaRecorder y sus eventos](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).

## Fuentes y reproducción

Los fragmentos entregados con `timeslice` no tienen obligación de ser reproducibles por separado; la especificación garantiza el conjunto de una grabación completada. Por eso el experimento reinicia la instancia y decodifica cada archivo completo. [MediaStream Recording, W3C](https://www.w3.org/TR/mediastream-recording/).

`strict` pide que la transacción se confirme tras la persistencia en el medio de almacenamiento; no equivale a haber ensayado una falla eléctrica. [IndexedDB: transaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction).

Para repetir: [README](README.md), [arnés](pruebas.mjs), [página autocontenida](index.html). Los datos crudos están en `evidencia/`; las grabaciones sintéticas y las capturas descargadas quedan localmente en `artefactos/`, fuera de Git. La página estática publica únicamente el HTML y su configuración de alojamiento.
