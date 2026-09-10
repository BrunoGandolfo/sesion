# Prueba aislada de audio por segmentos

Página pública: **https://prueba-audio.vercel.app/**. Proyecto Vercel independiente `prueba-audio`, sin conexión automática a Git y sin relación con el despliegue de la aplicación.

`index.html` contiene toda la página, los estilos y el JavaScript. No carga bibliotecas, no cifra, no sube audio y no tiene backend. Los otros archivos sirven para repetir las mediciones de escritorio y documentarlas.

## En el teléfono

1. Abrí la URL con Safari o Chrome. Usá voz de prueba.
2. Dejá Micrófono y 60 segundos por archivo. Tocá Grabar y autorizá el micrófono.
3. Hablá durante tres minutos, con una pausa de cinco segundos y un bloqueo de pantalla de veinte segundos. Anotá los momentos de esas acciones.
4. Tocá Terminar, escuchá Reproducir todos y descargá el conjunto ZIP y el diagnóstico JSON. El ZIP también incluye ese diagnóstico.
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
GDK_BACKEND=x11 BROWSERS=chromium CASES=continua SEGMENT_SECONDS=60 DURATION_SECONDS=125 LABEL=60s xvfb-run -a npm run test:audio
```

`BROWSERS`: `chromium,webkit`. `CASES`: `continua,pausa,recarga,segundo-plano`. `CODEC`: `auto`, `webm` o `mp4`. Cada variante debe usar una etiqueta distinta para no reemplazar las pruebas principales. Los momentos de pausa, recarga y segundo plano están fijados para una ventana de 65 segundos; usar `continua` al cambiar la duración.

Para repetir las comparaciones adicionales y regenerar el reporte:

```sh
node variantes.mjs
node generar-resultados.mjs
```

El arnés admite `INTERNAL_TIMESLICE_MS`, `FORCE_MIME`, `SOURCE_SAMPLE_RATE` y `SOURCE_CHANNELS` como variantes explícitas. Son ajustes del experimento aplicados antes de cargar el HTML; la página pública conserva sus opciones normales. `variantes.mjs` las ejecuta secuencialmente para que cada una tenga el servidor de audio privado disponible.

## Qué mide

- Cada archivo corresponde a una instancia nueva de MediaRecorder. Se detiene la anterior y se inicia la siguiente sin esperar el evento `stop` ni IndexedDB. Todos los fragmentos de **esa instancia** forman un único archivo.
- La escritura incluye el Blob y sus metadatos en una transacción `readwrite` con `durability: 'strict'`. Se comprueba el valor devuelto por el navegador y se espera `complete` antes de anunciarlo como guardado. No es una prueba de corte de energía del dispositivo.
- Los pitidos provienen de un oscilador de 1000 Hz con una envolvente de 80 ms, repetida cada segundo por Web Audio. Se envían al grabador y a una salida de escucha a volumen bajo. Un temporizador de JavaScript controla los cortes, pero no genera los pitidos.
- Se decodifica cada archivo de forma independiente. El detector RMS examina las muestras concatenadas y agrupa un pitido dividido entre archivos. La calibración introduce cortes conocidos de −80, −40, 0, +40 y +80 ms.
- El intervalo de cada frontera se expresa en milisegundos y se compara con 1000 ms. El signo describe el cambio en la separación de pitidos del audio concatenado; no identifica por sí solo si hubo pérdida, padding del códec o repetición.
- El conteo esperado por reloj y el avance del reloj de audio se informan por separado. Una señal periódica puede ocultar pérdidas de segundos enteros si sólo se miran los intervalos.
- La reproducción programa todos los AudioBufferSourceNode en tiempos contiguos. No utiliza una cadena de eventos `ended` de reproductores HTML. No repara ni recorta los huecos que ya haya en la captura.
- El conjunto se descarga como un ZIP STORE con archivos completos y diagnóstico. No se concatenan archivos comprimidos para fingir que son un único archivo reproducible.

## Publicar de nuevo

Únicamente esta carpeta, vinculada al proyecto independiente `prueba-audio`:

```sh
npx vercel@59.15.1 link --yes --project prueba-audio
npx vercel@59.15.1 deploy --prod --yes
node validar-publicacion.mjs
```

`.vercelignore` permite subir sólo `index.html` y `vercel.json`. La validación consulta la URL sin credenciales, compara el HTML con el local y comprueba la interfaz a 390 px. Los resultados medidos y sus límites están en `RESULTADOS.md`.
