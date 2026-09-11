import { readFile,writeFile } from 'node:fs/promises';
const root = new URL('.',import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(`evidencia/${name}.json`,root)));
const cases = await Promise.all(['chromium-continua-solape-0','chromium-continua-solape-1000'].map(read));
const edges = await Promise.all(['chromium-continua-fin-en-solape-completo','chromium-pausa-pausa-en-solape','chromium-recarga-recarga-solape'].map(read));
const webkit = await read('descarga-webkit-solape'), verification = await read('verificacion-solape');
const publication = await read('publicacion-solape');
if (publication.status !== 200 || publication.sourceSha256 !== verification.sourceSha256 || !publication.htmlMatchesLocal) throw new Error('Publicación distinta del HTML medido');
if (!verification.passed) throw new Error('Falta validar la evidencia.');
const f = n => n === null || n === undefined ? '—' : Number(n).toFixed(3);
let report = `# Segunda vuelta: solape al reiniciar el grabador

Fecha: 11 de septiembre de 2026. Rama: \`prueba-audio\`. Sólo cambia \`pruebas/audio-segmentos/\`.

Página publicada: **https://prueba-audio.vercel.app/**, proyecto Vercel independiente de la aplicación.

Publicación verificada: HTTP ${publication.status}, HTTPS, HTML idéntico al medido, solape inicial 1000 ms, interfaz a 390 px sin desborde ni errores de página. [Verificación de la URL pública](evidencia/publicacion-solape.json).

## Resultado de esta vuelta

Chromium ${cases[0].browserVersion}, WebM/Opus: **dos recorders simultáneos sobre el mismo stream funcionaron en esta muestra**. Ambos ensayos de 125 s produjeron tres archivos, todos decodificables. Con solape, se encontraron 127 pitidos brutos: los 125 originales y dos repeticiones dentro de los solapes. El recorte nominal conservó 125/125; no se detectaron IDs faltantes, inesperados ni repetidos fuera del solape. Esto verifica esta señal sintética de escritorio; no demuestra la corrección del reinicio AAC en un iPhone.

**WebKit de escritorio no tiene MediaRecorder en el binario instalado (${webkit.browserVersion}); no se midió captura AAC. WebKit de escritorio NO es un iPhone. La prueba física de iPhone la hace el dueño con la página publicada.**

## Configuración y medición

- Página autocontenida: duración 60 s, solape predeterminado 1000 ms; 0 ms conserva detener y arrancar en el mismo turno. Máximo configurable 5000 ms, menor que la mitad del segmento.
- Con 1000 ms, los inicios nominales son 0, 59, 118 s; el viejo termina a los 60, 119 s. Se mantienen como máximo dos instancias activas sobre los mismos IDs de pistas. Pausar o terminar cierra ambas y espera las escrituras.
- MediaRecorder real, sin timeslice, bitrate solicitado 64 kbps, almacenamiento IndexedDB strict. No se agregó cifrado, subida, backend ni dependencias.
- Playwright ${cases[0].playwrightVersion}, Chromium con ventana bajo Xvfb/Openbox y CDP noDefaults; PulseAudio privado a 48 kHz. Relojes sin acelerar. El oscilador genera pitidos de 80 ms, uno por segundo, en el hilo de audio.
- Detector calibrado con huecos/repeticiones de −80, −40, 0, +40 y +80 ms. Intervalos calculados sobre muestras; ventanas de detección de aproximadamente 1 ms. Los decimales impresos no implican exactitud acústica de microsegundos.
- SHA-256 del HTML medido: \`${verification.sourceSha256}\`. Evidencia íntegra en los JSON enlazados; audios y ZIP descargados permanecen en \`artefactos/\`, excluidos de Git.

## Ensayos de 60 segundos por archivo

| Solape pedido | Archivos / decodificables | Pitidos esperados | Encontrados brutos | Después del recorte | Reloj activo (s) | Audio bruto (s) | Audio recortado (s) |
|---|---|---:|---:|---:|---:|---:|---:|
`;
for (const r of cases) {
  const a = r.diagnostic.analysis;
  report += `| ${r.overlapMs} ms | ${a.segments.length} / ${a.segments.filter(s => s.decodable).length} | ${a.expectedBeeps} | ${a.foundBeeps} | ${a.trimmed.foundBeeps} | ${f(a.wallRecordedMs/1000)} | ${f(a.decodedDurationSec)} | ${f(a.trimmed.decodedDurationSec)} |\n`;
}
report += `
| Solape pedido | Frontera | Solape real entre llamadas (ms) | Inicio nuevo (ms) | Fin viejo (ms) | Intervalo bruto (ms) | Intervalo recortado (ms) | Desvío recortado (ms) |
|---|---|---:|---:|---:|---:|---:|---:|
`;
for (const r of cases) for (const [i,b] of r.diagnostic.timing.boundaries.entries()) {
  const a = r.diagnostic.analysis;
  report += `| ${r.overlapMs} | ${b.from}→${b.to} | ${f(b.actualOverlapMs)} | ${f(b.newStartCallMs)} | ${f(b.oldStopCallMs)} | ${f(a.boundaries[i].intervalMs)} | ${f(a.trimmed.boundaries[i].intervalMs)} | ${f(a.trimmed.boundaries[i].deviationMs)}${a.trimmed.boundaries[i].exceeds40ms?' **supera 40 ms**':''} |\n`;
}
report += '\nUn solape negativo significa una separación entre las llamadas de las dos instancias. El umbral de audio se evalúa en las muestras decodificadas, no en esa separación. El solape positivo se recorta del **principio del archivo nuevo**, conservando el viejo completo. Los archivos descargados son siempre los originales.\n';
for (const r of cases) {
  const a = r.diagnostic.analysis;
  report += `
### Chromium, solape ${r.overlapMs} ms

[Evidencia completa](evidencia/chromium-continua-solape-${r.overlapMs}.json).

| Archivo | Bytes | Decodificable | Duración decodificada (s) | Recorte inicial nominal (s) |
|---:|---:|---|---:|---:|
`;
  for (const [i,s] of a.segments.entries()) report += `| ${s.index} | ${s.bytes} | ${s.decodable?'Sí':'No'} | ${f(s.durationSec)} | ${f(a.trimmed.segments[i].trimSec)} |\n`;
  report += `
Máximo de instancias activas: ${r.overlapChecks.maxSimultaneous}. Mismas pistas: ${r.overlapChecks.sameStreamTracks?'sí':'no'}. Repeticiones de pitidos: ${a.identityCheck.duplicates.length}; fuera del solape: ${a.identityCheck.duplicatesOutsideOverlap.length}; IDs faltantes: ${a.identityCheck.missingIds.length}; inesperados: ${a.identityCheck.unexpectedIds.length}. Diferencia audio recortado − reloj: ${f(a.trimmed.decodedMinusWallMs)} ms.

ZIP descargado con ${r.zipVerification.entries.length} entradas, CRC correcto; incluye diagnostico.json. Descarga individual verificada por tamaño. Errores de página: ${r.errors.length}.
`;
}
report += `
Los IDs son una proyección de cada pitido sobre el reloj conocido de Web Audio; cada error de alineación está guardado en \`identityCheck.perSegment\`. La señal periódica sola no demuestra identidad absoluta: se contrastan reloj de fuente, conteo, duración y posición. Esta comprobación no es un método de alineación para voz. Un solape de exactamente un segundo puede repetir un pitido y aun así dejar intervalos de 1000 ms en el audio bruto; por eso no alcanza con mirar una única columna.

## Controles de pausa, fin y recuperación

Controles breves con segmentos de 4 s y solape 1000 ms para interrumpir cuando hay dos instancias. Son comprobaciones de ciclo de vida; no reemplazan la medición a 60 s.

| Caso | Archivos guardados / decodificables | Reloj guardado (s) | Pitidos esperados / brutos / recortados | Observación |
|---|---|---:|---|---|
`;
for (const r of edges) {
  const a = r.diagnostic.analysis;
  report += `| ${r.scenario} | ${a.segments.length} / ${a.segments.filter(s => s.decodable).length} | ${f(a.wallRecordedMs/1000)} | ${a.expectedBeeps} / ${a.foundBeeps} / ${a.trimmed.foundBeeps} | ${r.scenario==='recarga'?'Se preservaron los archivos ya confirmados; no se reinició captura. El conteo esperado del último checkpoint es una cota inferior.':r.scenario==='pausa'?'Pausa de 5 s al segundo 3,7; ambas instancias se cerraron y se reanudó con una nueva.':'Fin al segundo 3,7; el último archivo está cubierto casi enteramente por el anterior.'} |\n`;
}
report += `
[Fin durante el solape](evidencia/chromium-continua-fin-en-solape-completo.json), [pausa durante el solape](evidencia/chromium-pausa-pausa-en-solape.json), [recarga](evidencia/chromium-recarga-recarga-solape.json), [verificación conjunta](evidencia/verificacion-solape.json).

Control adicional al terminar en 3,5 s, justo al empezar el cuarto pitido: el reloj marcó 3,5197 s y el audio recortado 3,480 s; se encontraron 3/4 pitidos. Se conserva [esa observación](evidencia/chromium-continua-fin-en-solape.json), sin ocultarla ni atribuirla a la rotación: el fin de captura no garantizó conservar el pitido que recién empezaba. Al terminar en 3,7 s se conservaron 4/4. Las dos pruebas principales a 60 s conservaron 125/125. Una frontera cuyo último archivo se recorta entero queda sin intervalo medible.

## Diagnóstico para quien pegue los archivos

ZIP: \`diagnostico.json\`, versión 2. \`timing.timeOriginMs\` identifica el origen del reloj de esa grabación y se conserva al recargar. \`timing.segments\` conserva, sin redondear, llamadas y retornos de start/stop, instantes de recepción de sus eventos, marcas temporales de eventos y reloj de la fuente sintética.

Cada entrada de \`timing.boundaries\` contiene \`from\`, \`to\`, \`newStartCallMs\`, \`oldStopCallMs\`, \`actualOverlapMs\`, eventos y si ambos archivos quedaron guardados. Solape real = fin del viejo − inicio del nuevo. \`analysis.trimmed.segments\` registra el recorte nominal convertido a muestras.

**Límite de precisión:** MediaRecorder no expone el instante del primer/último sample capturado. Estos son los tiempos de alta resolución observables de la API, con la resolución que permita el navegador. El arranque, padding y retardo de AAC/Opus requieren verificar el audio decodificado; no se presentan estos números como una garantía de unión exacta de voz. El recorte de 1 s está orientado a cubrir los ~900 ms de silencio de arranque informados en iPhone; ese margen de ~100 ms debe probarse en el dispositivo.

## Descargas y teléfono

Se retiró el reproductor que no se escuchaba en ambos teléfonos. El ZIP se prepara al terminar o recuperar, **antes** de tocar Descargar. Hay enlace Blob persistente y botón Compartir / guardar en Archivos, que llama a la API de compartir con un File ya construido y el gesto activo. Los audios originales siguen disponibles por separado.

En WebKit ${webkit.browserVersion} de escritorio, con un perfil persistente, se descargaron realmente el ZIP, el enlace directo y el primer audio; los bytes de todos los audios y los tiempos del diagnóstico se conservaron tras la recarga. El control de compartir verificó File + activación de usuario mediante una sustitución explícita de esa API; no abrió una hoja nativa de iOS. El contexto efímero inicial de WebKit falló al persistir Blob con UnknownError; el perfil persistente permitió guardar y recuperar los mismos archivos sin cambiar el HTML. [Evidencia de descarga](evidencia/descarga-webkit-solape.json).

**Pendiente de prueba física:** Safari iOS 18.7, captura con dos recorders, silencio al inicio del nuevo, unión del audio, pausa, bloqueo y Guardar en Archivos. Abrir la URL, dejar 60 s / solape 1000 ms, hablar tres minutos con pausa y bloqueo, terminar, descargar ZIP o usar Compartir → Guardar en Archivos. Comparar las fronteras con los originales de la primera vuelta. No se afirma que esta descarga haya sido validada en un iPhone real.

## Observaciones del dueño y costos

Estos resultados de teléfono fueron informados por el dueño, no medidos otra vez aquí:

- Xiaomi/Chrome: cuatro archivos válidos, 197,0 s decodificados contra 198,2 s de reloj, fronteras limpias; 18 s de silencio digital al bloquear el teléfono. El solape no corrige un micrófono suspendido por Android.
- iPhone/Safari iOS 18.7: cuatro AAC/MP4 válidos, 224,0 s de audio y reloj; mantuvo audio durante 49 s bloqueado, pero agregó ~900 ms de silencio al inicio de cada archivo nuevo. Esta segunda vuelta pretende cubrir ese reinicio.
- Decisión vigente: segmentos de 60 s comprimidos; PCM descartado. No se investigó ni incorporó otra variante de captura.

**Costo del solape:** aproximadamente 1,7 % más segundos codificados/almacenados en régimen continuo (60/59), dos codificadores y más memoria durante el segundo compartido, y recorte obligatorio antes de concatenar. CPU, batería y variación de bytes por códec no se midieron en teléfonos. Si se recarga durante el solape, ambos archivos en curso pueden perderse; sobreviven los ya guardados. Los timers suspendidos por el sistema pueden acortar el solape real, por eso se registra y no se promete 1000 ms exactos.

## Primera vuelta conservada

Lo siguiente corresponde al HTML del 10 de septiembre, commit \`13bd64ce4048fdbc583512146853485a3f71b4f3\`. Sus referencias a reproducción y variantes son históricas. No describen la página publicada tras esta segunda vuelta.

<!-- PRIMERA_VUELTA_ARCHIVADA -->
`;
const previous = await readFile(new URL('RESULTADOS.md',root),'utf8');
const marker = '<!-- PRIMERA_VUELTA_ARCHIVADA -->\n';
const historical = previous.includes(marker) ? previous.split(marker).slice(1).join(marker) : previous;
await writeFile(new URL('RESULTADOS.md',root),report+historical);
console.log('RESULTADOS.md actualizado con la segunda vuelta y la primera conservada.');
