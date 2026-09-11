# Prueba aislada de audio por segmentos

Página pública: **https://prueba-audio.vercel.app/**. Proyecto Vercel independiente `prueba-audio`, sin conexión automática a Git y sin relación con el despliegue de la aplicación.

`index.html` contiene toda la página, los estilos y el JavaScript. No carga bibliotecas, no cifra, no sube audio y no tiene backend. Los otros archivos sirven para repetir las mediciones de escritorio y documentarlas.

## En el teléfono

1. Abrí la URL con Safari o Chrome. Usá voz de prueba.
2. Dejá Micrófono, 60 segundos por archivo y solape de 1000 ms (valor inicial). Tocá Grabar y autorizá el micrófono.
3. Hablá durante tres minutos, con una pausa de cinco segundos y un bloqueo de pantalla de veinte segundos. Anotá los momentos de esas acciones.
4. Tocá Terminar y esperá que el ZIP esté listo. Tocá Descargar conjunto; el ZIP incluye los audios originales y diagnostico.json. En iPhone también podés tocar Compartir / guardar en Archivos → Guardar en Archivos. Escuchá los archivos fuera de la página; se retiró el reproductor que falló en teléfonos.
5. Repetí con la fuente de pitidos para obtener números de los cortes.
6. En otra prueba, recargá a mitad de un archivo. Se recuperan los archivos ya confirmados en IndexedDB; no se vuelve a pedir el micrófono ni se reanuda sola la captura.

Una nueva prueba pide confirmación antes de reemplazar los archivos anteriores. La prueba no instala una PWA ni evita que el teléfono suspenda la página. Abrir la URL en Safari no demuestra el comportamiento de una PWA instalada: esa comparación sigue pendiente.

## Repetir en escritorio

Desde esta carpeta, con Node 22 o posterior:

```sh
npm ci
npx playwright install chromium webkit
npx playwright install-deps chromium webkit
```

En Ubuntu también se necesita Openbox para que el navegador tenga una ventana real dentro de Xvfb, y PulseAudio para una salida virtual independiente. La verificación del ZIP usa Python 3 de la máquina, sin paquetes adicionales.

```sh
sudo apt-get install openbox pulseaudio
GDK_BACKEND=x11 xvfb-run -a npm run test:audio
```

El arnés sirve únicamente el HTML en `127.0.0.1:4177`. Localhost permite usar las APIs de contexto seguro. La página pública usa HTTPS.

El arnés inicia un servidor PulseAudio privado con una salida virtual y termina ese proceso al finalizar. No cambia el servidor de audio de otras aplicaciones ni su volumen. `SYSTEM_AUDIO=1` permite repetir contra la salida del sistema; en este equipo el puente WSLg interrumpió el reloj de audio y produjo pruebas inválidas. Esa incidencia y los controles se conservan en el reporte.

Cada caso escribe su evidencia JSON en `evidencia/`. Los ZIP, archivos de audio descargados, capturas y perfiles de navegador quedan en `artefactos/`, excluidos de Git. El arnés usa un puerto de control de Chromium dedicado, `9230`: no correr dos instancias simultáneas.

Variables opcionales para controles y comparaciones:

```sh
GDK_BACKEND=x11 BROWSERS=chromium CASES=continua SEGMENT_SECONDS=60 DURATION_SECONDS=125 OVERLAP_MS=1000 LABEL=solape-1000 xvfb-run -a npm run test:audio
```

`BROWSERS`: `chromium,webkit`. `CASES`: `continua,pausa,recarga,segundo-plano`. `CODEC`: `auto`, `webm` o `mp4`. `OVERLAP_MS` configura el solape: el arnés usa 0 por defecto para conservar el protocolo histórico; la página usa 1000. Cada variante debe usar una etiqueta distinta para no reemplazar evidencia anterior. `PAUSE_AT_SECONDS` y `RELOAD_AT_SECONDS` permiten elegir la interrupción; por defecto son 27,5 y 35 s. La pausa dura 5 s.

Segunda vuelta, en orden (no ejecutar dos arneses a la vez):

```sh
GDK_BACKEND=x11 BROWSERS=chromium CASES=continua SEGMENT_SECONDS=60 DURATION_SECONDS=125 OVERLAP_MS=0 LABEL=solape-0 xvfb-run -a npm run test:audio
GDK_BACKEND=x11 BROWSERS=chromium CASES=continua SEGMENT_SECONDS=60 DURATION_SECONDS=125 OVERLAP_MS=1000 LABEL=solape-1000 xvfb-run -a npm run test:audio
GDK_BACKEND=x11 BROWSERS=chromium CASES=continua SEGMENT_SECONDS=4 DURATION_SECONDS=3.5 OVERLAP_MS=1000 LABEL=fin-en-solape xvfb-run -a npm run test:audio
GDK_BACKEND=x11 BROWSERS=chromium CASES=continua SEGMENT_SECONDS=4 DURATION_SECONDS=3.7 OVERLAP_MS=1000 LABEL=fin-en-solape-completo xvfb-run -a npm run test:audio
GDK_BACKEND=x11 BROWSERS=chromium CASES=pausa SEGMENT_SECONDS=4 DURATION_SECONDS=12 OVERLAP_MS=1000 PAUSE_AT_SECONDS=3.7 LABEL=pausa-en-solape xvfb-run -a npm run test:audio
GDK_BACKEND=x11 BROWSERS=chromium CASES=recarga SEGMENT_SECONDS=4 DURATION_SECONDS=8 OVERLAP_MS=1000 RELOAD_AT_SECONDS=6.5 LABEL=recarga-solape xvfb-run -a npm run test:audio
node descarga-webkit.mjs
node verificar-solape.mjs
node resultados-solape.mjs
```

`descarga-webkit.mjs` importa en IndexedDB los archivos reales del ZIP Chromium: comprueba descarga individual, botón ZIP, enlace directo y preservación del diagnóstico. La hoja de compartir se sustituye sólo para verificar que recibe un File y un gesto activo; no simula una prueba física de iOS. Este WebKit de escritorio no expone MediaRecorder.

Los scripts `variantes.mjs`, `generar-resultados.mjs` y `verificar-evidencia.mjs` corresponden a la primera vuelta, conservada en Git en `13bd64c`. No regenerar con ellos los resultados de esta segunda vuelta. PCM está descartado por decisión del dueño y no se volvió a probar.

## Qué mide

- Cada archivo corresponde a una instancia nueva de MediaRecorder. Con solape 1000 ms y duración 60 s, la nueva instancia arranca a los 59 s y la anterior se detiene a los 60 s: ambas usan el mismo MediaStream. Solape 0 detiene e inicia en el mismo turno, sin esperar el evento `stop` ni IndexedDB. Los timers demorados se registran; nunca se acumula una tercera instancia activa. Todos los fragmentos de **esa instancia** forman un único archivo.
- La escritura incluye el Blob y sus metadatos en una transacción `readwrite` con `durability: 'strict'`. Se comprueba el valor devuelto por el navegador y se espera `complete` antes de anunciarlo como guardado. No es una prueba de corte de energía del dispositivo.
- Los pitidos provienen de un oscilador de 1000 Hz con una envolvente de 80 ms, repetida cada segundo por Web Audio. Se envían al grabador y a una salida de escucha a volumen bajo. Un temporizador de JavaScript controla los cortes, pero no genera los pitidos.
- Se decodifica cada archivo de forma independiente. El detector RMS examina las muestras concatenadas y agrupa un pitido dividido entre archivos. La calibración introduce cortes conocidos de −80, −40, 0, +40 y +80 ms.
- El intervalo de cada frontera se expresa en milisegundos y se compara con 1000 ms. El signo describe el cambio en la separación de pitidos del audio concatenado; no identifica por sí solo si hubo pérdida, padding del códec o repetición.
- El conteo esperado por reloj y el avance del reloj de audio se informan por separado. Una señal periódica puede ocultar pérdidas de segundos enteros si sólo se miran los intervalos.
- Se informa el audio bruto y el audio con recorte nominal: conservar el viejo completo y quitar al inicio del nuevo el solape real medido. La página no modifica los archivos descargados. Un pitido periódico repetido un segundo entero puede conservar un intervalo de 1000 ms: también se cuentan los pitidos y se proyectan IDs sobre el reloj de la fuente para localizar duplicaciones.
- `diagnostico.json`, versión 2, incluye `timing.timeOriginMs`, `timing.segments` y `timing.boundaries`. `newStartCallMs` y `oldStopCallMs` son lecturas sin redondear de `performance.now()` inmediatamente antes de llamar a start/stop. `actualOverlapMs = oldStopCallMs - newStartCallMs`; un valor negativo indica una separación entre llamadas. También están los retornos y eventos de cada recorder. La resolución sigue siendo la que permite el navegador, y ningún evento identifica el primer/último sample capturado. El reloj original se conserva tras recargar.
- Pausar o terminar detiene todas las instancias y espera sus escrituras. Si se detiene durante el solape, el último archivo puede quedar enteramente cubierto por el anterior y el recorte nominal lo elimina. Una recarga durante el solape puede perder ambos archivos en curso; sólo sobreviven los ya confirmados en IndexedDB.
- El ZIP se construye antes del gesto de descarga, con enlace Blob persistente. El botón nativo de compartir recibe el File ya preparado. Descargar no depende de una promesa que construya el archivo después del clic. La prueba física con Safari iOS la hace el dueño.
- El conjunto se descarga como un ZIP STORE con archivos completos y diagnóstico. No se concatenan archivos comprimidos para fingir que son un único archivo reproducible.

## Publicar de nuevo

Únicamente esta carpeta, vinculada al proyecto independiente `prueba-audio`:

```sh
npx vercel@59.15.1 link --yes --project prueba-audio
npx vercel@59.15.1 deploy --prod --yes
node validar-publicacion.mjs
```

`.vercelignore` permite subir sólo `index.html` y `vercel.json`. La validación consulta la URL sin credenciales, compara el HTML con el local y comprueba la interfaz a 390 px. Los resultados medidos y sus límites están en `RESULTADOS.md`.
