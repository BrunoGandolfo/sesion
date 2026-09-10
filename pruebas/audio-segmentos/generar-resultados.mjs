import { readFile, writeFile } from 'node:fs/promises';
const load = name => readFile(new URL(`evidencia/${name}.json`,import.meta.url),'utf8').then(JSON.parse);
const n = (value,digits=3) => value === null || value === undefined ? '—' : Number(value).toFixed(digits);
const cases = ['continua','pausa','recarga','segundo-plano'];
const rows = [];
for (const browser of ['chromium','webkit']) for (const scenario of cases) rows.push(await load(`${browser}-${scenario}`));
const variants = [];
for (const label of ['timeslice20','60s','pcm16k','12s','opus16k']) {
  try {variants.push({label,...await load(`chromium-continua-${label}`)});} catch {}
}
const publication = await load('publicacion');
const main = rows.filter(r => r.browser === 'chromium');
const outliers = main.flatMap(r => r.diagnostic?.analysis?.boundaries || []).filter(b => b.exceeds40ms);
const maxDeviation = Math.max(...outliers.map(b => Math.abs(b.deviationMs)));
const sixty = variants.find(r => r.label === '60s')?.diagnostic?.analysis;
const sixtyPass = sixty?.allDecodable && sixty.expectedBeeps === sixty.foundBeeps && sixty.boundaries.every(b => b.exceeds40ms === false);
const opusControl = variants.find(r => r.label === 'opus16k')?.diagnostic?.analysis;
const lines = [
  '# Prueba de factibilidad: segmentos de audio independientes', '',
  'Fecha: 10 de septiembre de 2026. Repositorio: BrunoGandolfo/sesion. Rama: `prueba-audio`.', '',
  '**Página pública:** https://prueba-audio.vercel.app/ — proyecto Vercel independiente `prueba-audio`.', '',
  `**Chromium / WebM-Opus: segmentos independientes ${sixtyPass ? 'viables a 60 s en la muestra de escritorio' : 'sin aprobación a 60 s'}, no viables a 10 s con el umbral solicitado.** A 60 s se conservaron ${sixty?.foundBeeps ?? '—'}/${sixty?.expectedBeeps ?? '—'} pitidos y las fronteras midieron ${sixty?.boundaries.map(b => n(b.intervalMs)).join(' y ') ?? '—'} ms. Es una viabilidad acotada a esa corrida; falta confirmar otros dispositivos y las interrupciones con ese tamaño.`, '',
  `En la matriz de 10 s, ${outliers.length} fronteras superan 40 ms; máximo desvío absoluto ${n(maxDeviation)} ms. Poder decodificar los archivos no demuestra continuidad de la captura.`, '',
  '**WebKit de escritorio instalado: segmentos independientes no viables en este binario:** no expone `MediaRecorder`. No hay una medición de AAC ni un veredicto sobre Safari/iPhone. Los cuatro casos quedaron bloqueados antes de iniciar la fuente.', '',
  '## Entorno y alcance', '',
  `- Playwright ${rows[0].playwrightVersion}; Chromium ${rows[0].browserVersion}; WebKit ${rows.find(r => r.browser === 'webkit').browserVersion}. Ubuntu 24.04 bajo WSL2 (${rows[0].os}). Node 22.23.1.`,
  '- Chromium con ventana real bajo Xvfb/Openbox, controlado por Playwright vía CDP con `noDefaults: true`. No se emulan el foco ni los relojes. Cambiar de pestaña produce `visibilitychange` real.',
  '- Salida de audio virtual privada PulseAudio, reloj en tiempo real. No se usa el puente de sonido de WSLg en la matriz final. Esta salida reemplaza al parlante de la máquina de pruebas; no sustituye el MediaRecorder ni su codificador.',
  '- Fuente sintética de 1000 Hz: envolvente de 80 ms, un pitido cada 1000 ms mediante Web Audio. Se conserva la fase durante la pausa, con el reloj de audio activo y la envolvente silenciada.',
  '- MediaRecorder nuevo por segmento; bitrate solicitado 64000 bit/s; selección automática de MIME. Cada archivo tiene su propia cabecera. El siguiente empieza sin esperar la persistencia del anterior.',
  '- Cada transacción solicita y verifica `durability: strict`; el archivo se anuncia guardado después de `complete`. Se probó recarga de página, no corte de energía ni cierre forzado del sistema operativo.',
  '- Base de la rama: `f3b37d1e8561bceac4884a5cd2233d459810ff96`. SHA-256 del HTML final: `' + publication.sourceSha256 + '`. Los JSON incluyen el hash del HTML que midieron.', '',
  '**WebKit de escritorio NO es un iPhone.** Playwright distribuye un WebKit propio; su documentación advierte que los códecs dependen de la plataforma. En el parche de compilación de los puertos GTK y WPE aparece `ENABLE_MEDIA_RECORDER PRIVATE OFF`. Se verificó `typeof MediaRecorder === "undefined"` tanto con ventana como sin ella. Instalar bibliotecas GStreamer no incorpora una API excluida del binario. [Documentación de Playwright](https://playwright.dev/docs/browsers#webkit), [parche de compilación consultado](https://github.com/microsoft/playwright/blob/efb0761d304adfda66ad91f6596ac33eb1036ec9/browser_patches/webkit/patches/bootstrap.diff).', '',
  '## Protocolo y significado de los números', '',
  '- Continua: 65 segundos grabados, cortes cada 10 segundos y un último archivo parcial.',
  '- Pausa: pausa alrededor de 27,5 s, cinco segundos pausada y fin en la marca de 65 s de la ventana; quedan aproximadamente 60 s de captura activa. Pausar finaliza el archivo en curso y reanudar crea otro.',
  '- Recarga: a los 35 s se toma una observación externa y se recarga. Se conservan los archivos confirmados. La página permanece abierta hasta el segundo 65, sin reiniciar la grabación. Es una prueba de recuperación de una captura interrumpida a los 35 s, no 65 s de audio ni una reanudación automática.',
  '- Segundo plano: otra pestaña al segundo 20 durante 20 segundos completos, luego regreso y fin al segundo 65. El arnés exige `document.visibilityState === "hidden"`; no alcanza con quitarle el foco a una ventana.',
  '- Todos los archivos se decodifican por separado con `decodeAudioData`. El detector RMS trabaja sobre las muestras concatenadas y agrupa un pitido que atraviese un corte. Resolución de ventana aproximadamente 1 ms; los tres decimales son el cálculo sobre muestras, no una exactitud acústica de 1 microsegundo.',
  '- Calibración antes de cada caso: desplazamientos conocidos de −80, −40, 0, +40 y +80 ms; intervalos esperados 920, 960, 1000, 1040 y 1080 ms. Los JSON conservan cada comparación.',
  '- Desvío = intervalo observado − 1000 ms. Un valor negativo indica que ese tramo del audio concatenado quedó más corto; uno positivo, más largo. El umbral es estrictamente mayor a 40 ms, redondeado a 0,001 ms para evitar errores de coma flotante en el límite.',
  '- Los pitidos esperados por reloj y los que corresponden al avance del reloj de la fuente se guardan por separado. Una señal de período fijo no puede localizar por sí sola pérdidas de segundos enteros; se contrastan también conteo y duración.', '',
  '## Matriz principal', '',
  '| Navegador / caso | Archivos | Decodificables | Pitidos esperados / encontrados | Audio decodificado (s) | Reloj activo (s) | Fronteras: intervalos (ms) |',
  '|---|---:|---|---|---:|---:|---|'
];
for (const r of rows) {
  const a = r.diagnostic?.analysis;
  if (!a) {
    lines.push(`| WebKit / ${r.scenario} | 0 | No hay archivos | No se generó señal | — | No iniciado | No medibles: MediaRecorder ausente |`);
    continue;
  }
  const wall = r.beforeReload?.snapshot.wallRecordedMs ?? a.wallRecordedMs;
  const expected = r.beforeReload?.snapshot.expectedBeeps ?? a.expectedBeeps;
  lines.push(`| Chromium / ${r.scenario} | ${a.segments.length} | ${a.segments.map(s => `${s.index}: ${s.decodable?'sí':'NO'}`).join('; ')} | ${expected} / ${a.foundBeeps ?? 'no medible'} | ${n(a.decodedDurationSec)} | ${n(wall/1000)} | ${a.boundaries.map(b => `${b.from}→${b.to}: ${n(b.intervalMs)}${b.exceeds40ms?' **✕**':''}`).join('; ')} |`);
}
lines.push('', '✕ = supera el desvío permitido. En recarga, reloj y conteo esperado de la tabla provienen de la observación externa inmediatamente anterior a recargar. La página recuperada sólo dispone de su último checkpoint.', '');
for (const r of main) {
  const a = r.diagnostic?.analysis;
  if (!a) continue;
  lines.push(`### Chromium: ${r.scenario}`, '', `[Evidencia completa](evidencia/chromium-${r.scenario}.json). Estado del arnés: **${r.status}**.`, '',
    `Reloj de la fuente: ${n(a.sourceRenderedSec)} s. Pitidos según ese reloj: ${a.expectedBeepsByAudioClock}. Diferencia decodificado − reloj de la página: ${n(a.decodedMinusWallMs)} ms.`, '',
    '| Archivo | Bytes | MIME real | Reloj (s) | Decodificado (s) | Motivo de cierre |',
    '|---:|---:|---|---:|---:|---|');
  for (const s of a.segments) lines.push(`| ${s.index} | ${s.bytes} | ${s.mimeType} | ${n(s.wallDurationMs/1000)} | ${s.decodable?n(s.durationSec):'NO decodifica'} | ${s.reason || '—'} |`);
  lines.push('',`Desvíos por frontera, en orden: ${a.boundaries.map(b => `${n(b.deviationMs)} ms${b.intentionalPause?' (pausa deliberada)':''}`).join('; ')}.`, '');
  if (r.scenario === 'recarga') {
    lines.push(`Se conservaron los mismos índices, tamaños, MIME y tiempos antes/después de la recarga: **${r.recoveryPreservesFiles?'sí':'NO'}**. Audio guardado: ${n(a.decodedDurationSec)} s frente a ${n(r.beforeReload.snapshot.wallRecordedMs/1000)} s activos antes de interrumpir. Diferencia: ${n(r.beforeReload.snapshot.wallRecordedMs-a.decodedDurationSec*1000)} ms; incluye el archivo en curso no guardado y las pérdidas pequeñas de codificación/cortes.`, '');
  }
  if (r.scenario === 'segundo-plano') lines.push(`Estado oculto comprobado: **${r.visibilityWhileHidden}**; permanencia ${n(r.visibleAgainAtMs-r.hiddenAtMs)} ms. Los eventos completos de visibilidad están en el JSON.`, '');
  if (r.scenario === 'pausa') lines.push(`Pausa observada externamente: ${n(r.resumedAtMs-r.pauseStartedAtMs)} ms.`, '');
  lines.push(`Descarga individual: ${r.individualDownload?.failure === null ? 'completada' : 'no verificada'}. ZIP: ${r.zipVerification?.entries.length ?? '—'} entradas, ${r.zipVerification?.crcError === null ? 'CRC de todas las entradas correcto' : 'sin verificación satisfactoria'}. Separación máxima **añadida por la programación de reproducción**: ${n(r.maxScheduledPlaybackGapMs)} ms. Esto verifica la programación, no una escucha en el DAC de un teléfono.`, '');
  if (r.errors?.length || r.uiError) lines.push(`Errores: ${JSON.stringify([...r.errors,r.uiError].filter(Boolean))}`, '');
}
lines.push('## Comparaciones adicionales', '',
  'Son variantes del arnés sobre el mismo HTML. Las opciones se aplican antes de cargar la página y quedan explícitas en el JSON; no cambian el comportamiento predeterminado de la página pública.', '',
  '| Variante | Duración / segmento (s) | Archivos decodificables | Esperados / encontrados | Decodificado (s) | Intervalos de frontera (ms) | Bytes totales |',
  '|---|---|---|---|---:|---|---:|');
for (const r of variants) {
  const a = r.diagnostic?.analysis;
  if (!a) {lines.push(`| ${r.label} | ${r.durationSeconds} / ${r.segmentSeconds} | ${r.status} | — | — | — | — |`);continue;}
  lines.push(`| [${r.label}](evidencia/chromium-continua-${r.label}.json) | ${r.durationSeconds} / ${r.segmentSeconds} | ${a.segments.filter(s => s.decodable).length}/${a.segments.length} | ${a.expectedBeeps}/${a.foundBeeps} | ${n(a.decodedDurationSec)} | ${a.boundaries.map(b => `${n(b.intervalMs)}${b.exceeds40ms?' **✕**':''}`).join('; ')} | ${a.segments.reduce((v,s) => v+s.bytes,0)} |`);
}
lines.push('',
  '- `timeslice20`: la misma rotación de 10 s, pero `MediaRecorder.start(20)` entrega fragmentos internos con más frecuencia; se juntan todos los de cada instancia antes de guardar su archivo.',
  '- `60s`: instancias de 60 s durante 125 s, para observar dos fronteras con el tamaño propuesto para el teléfono.',
  '- `12s`: seis archivos durante 65 s, para comprobar si otro tamaño de segmento reduce el problema observado a 10 s.',
  '- `opus16k`: control con Opus, 16000 Hz y un canal, frente a PCM con esa misma frecuencia y cantidad de canales. Mantiene cortes cada 10 s.',
  '- `pcm16k`: MediaRecorder con `audio/webm;codecs=pcm`, fuente a 16000 Hz y un canal, segmentos de 10 s. No usa AudioWorklet. Es una comparación de códec en Chromium; no prueba que Safari lo admita ni que un micrófono entregue esa frecuencia sin un paso de conversión.', '');
const pcm = variants.find(r => r.label === 'pcm16k')?.diagnostic?.analysis;
if (pcm) {
  const bytes = pcm.segments.reduce((sum,s) => sum+s.bytes,0);
  lines.push(`PCM de esta prueba: ${n(bytes/1e6)} MB en ${n(pcm.wallRecordedMs/1000)} s, equivalente a aproximadamente **${n(bytes/(pcm.wallRecordedMs/1000)*9000/1e6,1)} MB por 150 min** a esta tasa y fragmentación. Es una extrapolación del archivo sin comprimir, no una medición de una sesión de 150 min.`, '');
  lines.push('Se verificó en la cabecera del archivo PCM el identificador `A_PCM/FLOAT/IEEE` y profundidad de 32 bits. Por eso esta variante pesa aproximadamente el doble que PCM mono de 16 bits a 16 kHz (288 MB por 150 min), más el contenedor. [Verificación de archivos](evidencia/verificacion.json).', '');
}
lines.push('### Decisión propuesta a partir de estas pruebas', '',
  'Mantener 60 s como candidato comprimido para la prueba en teléfono: pasó los dos cortes observados y genera menos fronteras por sesión. No adoptar cortes de 10 s con WebM/Opus tal como están. Entregar blobs internos cada 20 ms no corrigió sus pérdidas; tampoco convierte cada blob en un archivo independiente.', '',
  'Doce segundos tampoco es una solución demostrada: hubo una frontera de 939,864 ms (−60,136 ms). No conviene extrapolar que cualquier duración distinta de diez segundos resuelve el problema.', '',
  'PCM mediante MediaRecorder merece una comparación adicional antes de implementar AudioWorklet: en Chromium produjo 65/65 pitidos y seis intervalos de exactamente 1000 ms, dentro de la resolución del detector. A cambio, los archivos son mucho mayores. No se probó su soporte en Safari ni la conversión de un micrófono real a 16 kHz; el ajuste de frecuencia de esa corrida corresponde a la fuente sintética.', '',
  `El control Opus a los mismos 16 kHz y un canal conservó ${opusControl?.foundBeeps ?? '—'}/${opusControl?.expectedBeeps ?? '—'} pitidos, con intervalos ${opusControl?.boundaries.map(b => n(b.intervalMs)).join(', ') ?? '—'} ms. Su máximo desvío fue ${opusControl ? n(Math.max(...opusControl.boundaries.map(b => Math.abs(b.deviationMs)))) : '—'} ms. Por lo tanto, la mejora observada con PCM no se explica solamente por bajar la frecuencia o pasar a mono; sigue siendo una comparación acotada a este entorno.`, '',
  'No hay evidencia suficiente para decir que ninguna variante web comprimida sirve, ni para exigir ya la ruta AudioWorklet/PCM. Primero hace falta la prueba real de 60 s en iPhone y Android. Si esos cortes superan el umbral o el bloqueo interrumpe la captura, habrá que rediseñar la captura con esos resultados. Capturar PCM tampoco garantiza por sí mismo que el sistema operativo deje correr una página bloqueada.', '');
lines.push('## Incidencias del banco de pruebas conservadas', '',
  '- El puente PulseServer de WSLg dejó de avanzar el reloj de la fuente alrededor de los 15 s, aunque el estado del AudioContext seguía siendo `running`. Se observaron archivos de sólo 110 bytes que no decodificaban. Retener los nodos y añadir una salida de escucha no corrigió ese entorno; el servidor PulseAudio privado sí. Las corridas originales se guardan como [fuente interrumpida](evidencia/preliminar-fuente-interrumpida.json), [control de 25 s](evidencia/chromium-continua-control-25.json), [control con salida audible](evidencia/chromium-continua-control-salida-25.json) y [control con PulseAudio privado](evidencia/chromium-continua-control-pulse-25.json). No se usan para el veredicto del codificador.',
  '- La primera pausa suspendía el AudioContext. Su reanudación introdujo aproximadamente dos segundos sin avance de la fuente: 58 pitidos emitidos frente a 60 esperados por reloj. La versión final mantiene activo ese reloj, calla la envolvente y conserva su fase. Se repitió la matriz con ese ajuste; los cuatro JSON `preliminar-antes-ajuste-pausa-*` conservan la corrida anterior.',
  '- Playwright con sus opciones habituales mantuvo la visibilidad emulada aunque se abriera otra ventana. Por eso la matriz final usa la conexión sin esas opciones y exige el evento `hidden`. No se falsificaron propiedades del documento.',
  '- En la primera corrida, el archivo ZIP se descargó, pero el arnés esperaba un evento administrado por Playwright que no llegaba con `noDefaults`. La versión final escucha el evento de descarga del propio Chromium y verifica el ZIP con Python. La matriz final repite también esa comprobación.', '',
  '## Publicación y prueba en teléfono pendiente', '',
  `Se verificó sin credenciales la respuesta HTTP **${publication.status}**, sin redirección; el HTML servido coincide byte por byte con el local. Contexto seguro: **${publication.browser.secureContext}**; API de micrófono presente; ancho de página ${publication.browser.bodyWidth} px en viewport ${publication.browser.viewportWidth} px; errores JavaScript ${publication.pageErrors.length}. [Evidencia](evidencia/publicacion.json).`, '',
  'La página pública ofrece la prueba con micrófono a 60 s y el modo sintético; archivos y diagnóstico quedan en IndexedDB. La descarga conjunta es ZIP con archivos completos, no la concatenación binaria de archivos comprimidos. El HTML no envía audio a la red.', '',
  'Falta probar un iPhone real y un Android real durante tres minutos, con pausa y bloqueo de pantalla, y escuchar los archivos. Faltan también la modalidad PWA instalada, sesiones de 150 minutos, llamadas entrantes, presión de memoria/almacenamiento y pérdida de energía. No se sostiene todavía la promesa de perder como máximo un minuto: si el navegador demora el temporizador, el archivo en curso puede durar más. MDN documenta que los eventos de MediaRecorder se pueden retrasar, incluso por bloqueo de pantalla en Android o suspensión de captura en Safari. [MediaRecorder y sus eventos](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).', '',
  '## Fuentes y reproducción', '',
  'Los fragmentos entregados con `timeslice` no tienen obligación de ser reproducibles por separado; la especificación garantiza el conjunto de una grabación completada. Por eso el experimento reinicia la instancia y decodifica cada archivo completo. [MediaStream Recording, W3C](https://www.w3.org/TR/mediastream-recording/).', '',
  '`strict` pide que la transacción se confirme tras la persistencia en el medio de almacenamiento; no equivale a haber ensayado una falla eléctrica. [IndexedDB: transaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction).', '',
  'Para repetir: [README](README.md), [arnés](pruebas.mjs), [página autocontenida](index.html). Los datos crudos están en `evidencia/`; las grabaciones sintéticas y las capturas descargadas quedan localmente en `artefactos/`, fuera de Git. La página estática publica únicamente el HTML y su configuración de alojamiento.', ''
);
await writeFile(new URL('RESULTADOS.md',import.meta.url),lines.join('\n'));
console.log(JSON.stringify({outliers:outliers.length,maxDeviation,main:main.map(r => ({case:r.scenario,status:r.status,analysis:r.diagnostic?.analysis && {expected:r.diagnostic.analysis.expectedBeeps,found:r.diagnostic.analysis.foundBeeps,decoded:r.diagnostic.analysis.decodedDurationSec}})),variants:variants.map(r => ({label:r.label,status:r.status}))},null,2));
