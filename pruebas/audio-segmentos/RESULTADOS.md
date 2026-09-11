# Segunda vuelta: solape al reiniciar el grabador

Fecha: 11 de septiembre de 2026. Rama: `prueba-audio`. Sólo cambia `pruebas/audio-segmentos/`.

Página publicada: **https://prueba-audio.vercel.app/**, proyecto Vercel independiente de la aplicación.

## Resultado de esta vuelta

Chromium 153.0.8010.12, WebM/Opus: **dos recorders simultáneos sobre el mismo stream funcionaron en esta muestra**. Ambos ensayos de 125 s produjeron tres archivos, todos decodificables. Con solape, se encontraron 127 pitidos brutos: los 125 originales y dos repeticiones dentro de los solapes. El recorte nominal conservó 125/125; no se detectaron IDs faltantes, inesperados ni repetidos fuera del solape. Esto verifica esta señal sintética de escritorio; no demuestra la corrección del reinicio AAC en un iPhone.

**WebKit de escritorio no tiene MediaRecorder en el binario instalado (26.6); no se midió captura AAC. WebKit de escritorio NO es un iPhone. La prueba física de iPhone la hace el dueño con la página publicada.**

## Configuración y medición

- Página autocontenida: duración 60 s, solape predeterminado 1000 ms; 0 ms conserva detener y arrancar en el mismo turno. Máximo configurable 5000 ms, menor que la mitad del segmento.
- Con 1000 ms, los inicios nominales son 0, 59, 118 s; el viejo termina a los 60, 119 s. Se mantienen como máximo dos instancias activas sobre los mismos IDs de pistas. Pausar o terminar cierra ambas y espera las escrituras.
- MediaRecorder real, sin timeslice, bitrate solicitado 64 kbps, almacenamiento IndexedDB strict. No se agregó cifrado, subida, backend ni dependencias.
- Playwright 1.63.0, Chromium con ventana bajo Xvfb/Openbox y CDP noDefaults; PulseAudio privado a 48 kHz. Relojes sin acelerar. El oscilador genera pitidos de 80 ms, uno por segundo, en el hilo de audio.
- Detector calibrado con huecos/repeticiones de −80, −40, 0, +40 y +80 ms. Intervalos calculados sobre muestras; ventanas de detección de aproximadamente 1 ms. Los decimales impresos no implican exactitud acústica de microsegundos.
- SHA-256 del HTML medido: `d0da8ad2682a83d1413dc92f6c37fd48cfd31c9301f9d70a1d83b47e16271b2c`. Evidencia íntegra en los JSON enlazados; audios y ZIP descargados permanecen en `artefactos/`, excluidos de Git.

## Ensayos de 60 segundos por archivo

| Solape pedido | Archivos / decodificables | Pitidos esperados | Encontrados brutos | Después del recorte | Reloj activo (s) | Audio bruto (s) | Audio recortado (s) |
|---|---|---:|---:|---:|---:|---:|---:|
| 0 ms | 3 / 3 | 125 | 125 | 125 | 125.039 | 125.040 | 125.040 |
| 1000 ms | 3 / 3 | 125 | 127 | 125 | 125.027 | 127.020 | 125.020 |

| Solape pedido | Frontera | Solape real entre llamadas (ms) | Inicio nuevo (ms) | Fin viejo (ms) | Intervalo bruto (ms) | Intervalo recortado (ms) | Desvío recortado (ms) |
|---|---|---:|---:|---:|---:|---:|---:|
| 0 | 1→2 | -0.900 | 61327.100 | 61326.200 | 1000.726 | 1000.726 | 0.726 |
| 0 | 2→3 | -1.200 | 121327.900 | 121326.700 | 989.751 | 989.751 | -10.249 |
| 1000 | 1→2 | 998.900 | 60658.100 | 61657.000 | 1000.726 | 1001.723 | 1.723 |
| 1000 | 2→3 | 1000.700 | 119658.700 | 120659.400 | 989.751 | 988.753 | -11.247 |

Un solape negativo significa una separación entre las llamadas de las dos instancias. El umbral de audio se evalúa en las muestras decodificadas, no en esa separación. El solape positivo se recorta del **principio del archivo nuevo**, conservando el viejo completo. Los archivos descargados son siempre los originales.

### Chromium, solape 0 ms

[Evidencia completa](evidencia/chromium-continua-solape-0.json).

| Archivo | Bytes | Decodificable | Duración decodificada (s) | Recorte inicial nominal (s) |
|---:|---:|---|---:|---:|
| 1 | 61727 | Sí | 60.000 | 0.000 |
| 2 | 69905 | Sí | 60.000 | 0.000 |
| 3 | 7154 | Sí | 5.040 | 0.000 |

Máximo de instancias activas: 1. Mismas pistas: sí. Repeticiones de pitidos: 0; fuera del solape: 0; IDs faltantes: 0; inesperados: 0. Diferencia audio recortado − reloj: 0.932 ms.

ZIP descargado con 4 entradas, CRC correcto; incluye diagnostico.json. Descarga individual verificada por tamaño. Errores de página: 0.

### Chromium, solape 1000 ms

[Evidencia completa](evidencia/chromium-continua-solape-1000.json).

| Archivo | Bytes | Decodificable | Duración decodificada (s) | Recorte inicial nominal (s) |
|---:|---:|---|---:|---:|
| 1 | 61727 | Sí | 60.000 | 0.000 |
| 2 | 69754 | Sí | 60.000 | 0.999 |
| 3 | 10138 | Sí | 7.020 | 1.001 |

Máximo de instancias activas: 2. Mismas pistas: sí. Repeticiones de pitidos: 2; fuera del solape: 0; IDs faltantes: 0; inesperados: 0. Diferencia audio recortado − reloj: -6.437 ms.

ZIP descargado con 4 entradas, CRC correcto; incluye diagnostico.json. Descarga individual verificada por tamaño. Errores de página: 0.

Los IDs son una proyección de cada pitido sobre el reloj conocido de Web Audio; cada error de alineación está guardado en `identityCheck.perSegment`. La señal periódica sola no demuestra identidad absoluta: se contrastan reloj de fuente, conteo, duración y posición. Esta comprobación no es un método de alineación para voz. Un solape de exactamente un segundo puede repetir un pitido y aun así dejar intervalos de 1000 ms en el audio bruto; por eso no alcanza con mirar una única columna.

## Controles de pausa, fin y recuperación

Controles breves con segmentos de 4 s y solape 1000 ms para interrumpir cuando hay dos instancias. Son comprobaciones de ciclo de vida; no reemplazan la medición a 60 s.

| Caso | Archivos guardados / decodificables | Reloj guardado (s) | Pitidos esperados / brutos / recortados | Observación |
|---|---|---:|---|---|
| continua | 2 / 2 | 3.715 | 4 / 5 / 4 | Fin al segundo 3,7; el último archivo está cubierto casi enteramente por el anterior. |
| pausa | 4 / 4 | 6.991 | 7 / 8 / 7 | Pausa de 5 s al segundo 3,7; ambas instancias se cerraron y se reanudó con una nueva. |
| recarga | 1 / 1 | 6.001 | 6 / 4 / 4 | Se preservaron los archivos ya confirmados; no se reinició captura. El conteo esperado del último checkpoint es una cota inferior. |

[Fin durante el solape](evidencia/chromium-continua-fin-en-solape-completo.json), [pausa durante el solape](evidencia/chromium-pausa-pausa-en-solape.json), [recarga](evidencia/chromium-recarga-recarga-solape.json), [verificación conjunta](evidencia/verificacion-solape.json).

Control adicional al terminar en 3,5 s, justo al empezar el cuarto pitido: el reloj marcó 3,5197 s y el audio recortado 3,480 s; se encontraron 3/4 pitidos. Se conserva [esa observación](evidencia/chromium-continua-fin-en-solape.json), sin ocultarla ni atribuirla a la rotación: el fin de captura no garantizó conservar el pitido que recién empezaba. Al terminar en 3,7 s se conservaron 4/4. Las dos pruebas principales a 60 s conservaron 125/125. Una frontera cuyo último archivo se recorta entero queda sin intervalo medible.

## Diagnóstico para quien pegue los archivos

ZIP: `diagnostico.json`, versión 2. `timing.timeOriginMs` identifica el origen del reloj de esa grabación y se conserva al recargar. `timing.segments` conserva, sin redondear, llamadas y retornos de start/stop, instantes de recepción de sus eventos, marcas temporales de eventos y reloj de la fuente sintética.

Cada entrada de `timing.boundaries` contiene `from`, `to`, `newStartCallMs`, `oldStopCallMs`, `actualOverlapMs`, eventos y si ambos archivos quedaron guardados. Solape real = fin del viejo − inicio del nuevo. `analysis.trimmed.segments` registra el recorte nominal convertido a muestras.

**Límite de precisión:** MediaRecorder no expone el instante del primer/último sample capturado. Estos son los tiempos de alta resolución observables de la API, con la resolución que permita el navegador. El arranque, padding y retardo de AAC/Opus requieren verificar el audio decodificado; no se presentan estos números como una garantía de unión exacta de voz. El recorte de 1 s está orientado a cubrir los ~900 ms de silencio de arranque informados en iPhone; ese margen de ~100 ms debe probarse en el dispositivo.

## Descargas y teléfono

Se retiró el reproductor que no se escuchaba en ambos teléfonos. El ZIP se prepara al terminar o recuperar, **antes** de tocar Descargar. Hay enlace Blob persistente y botón Compartir / guardar en Archivos, que llama a la API de compartir con un File ya construido y el gesto activo. Los audios originales siguen disponibles por separado.

En WebKit 26.6 de escritorio, con un perfil persistente, se descargaron realmente el ZIP, el enlace directo y el primer audio; los bytes de todos los audios y los tiempos del diagnóstico se conservaron tras la recarga. El control de compartir verificó File + activación de usuario mediante una sustitución explícita de esa API; no abrió una hoja nativa de iOS. El contexto efímero inicial de WebKit falló al persistir Blob con UnknownError; el perfil persistente permitió guardar y recuperar los mismos archivos sin cambiar el HTML. [Evidencia de descarga](evidencia/descarga-webkit-solape.json).

**Pendiente de prueba física:** Safari iOS 18.7, captura con dos recorders, silencio al inicio del nuevo, unión del audio, pausa, bloqueo y Guardar en Archivos. Abrir la URL, dejar 60 s / solape 1000 ms, hablar tres minutos con pausa y bloqueo, terminar, descargar ZIP o usar Compartir → Guardar en Archivos. Comparar las fronteras con los originales de la primera vuelta. No se afirma que esta descarga haya sido validada en un iPhone real.

## Observaciones del dueño y costos

Estos resultados de teléfono fueron informados por el dueño, no medidos otra vez aquí:

- Xiaomi/Chrome: cuatro archivos válidos, 197,0 s decodificados contra 198,2 s de reloj, fronteras limpias; 18 s de silencio digital al bloquear el teléfono. El solape no corrige un micrófono suspendido por Android.
- iPhone/Safari iOS 18.7: cuatro AAC/MP4 válidos, 224,0 s de audio y reloj; mantuvo audio durante 49 s bloqueado, pero agregó ~900 ms de silencio al inicio de cada archivo nuevo. Esta segunda vuelta pretende cubrir ese reinicio.
- Decisión vigente: segmentos de 60 s comprimidos; PCM descartado. No se investigó ni incorporó otra variante de captura.

**Costo del solape:** aproximadamente 1,7 % más segundos codificados/almacenados en régimen continuo (60/59), dos codificadores y más memoria durante el segundo compartido, y recorte obligatorio antes de concatenar. CPU, batería y variación de bytes por códec no se midieron en teléfonos. Si se recarga durante el solape, ambos archivos en curso pueden perderse; sobreviven los ya guardados. Los timers suspendidos por el sistema pueden acortar el solape real, por eso se registra y no se promete 1000 ms exactos.

## Primera vuelta conservada

Lo siguiente corresponde al HTML del 10 de septiembre, commit `13bd64ce4048fdbc583512146853485a3f71b4f3`. Sus referencias a reproducción y variantes son históricas. No describen la página publicada tras esta segunda vuelta.

<!-- PRIMERA_VUELTA_ARCHIVADA -->
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
