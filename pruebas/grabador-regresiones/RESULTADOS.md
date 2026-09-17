# Regresiones del grabador — 17 de septiembre de 2026

Base: origin/main 2d59c68e6ec4b12e4d6d869e80d99a6a430b28bf.
Rama: grabador-regresiones. Worktree propio: ~/proyectos/sesion-grabador-regresiones.

## Procedencia y cambios

- Grabador anterior a ea5ce74: src/components/grabacion/GrabadorSesion.tsx. Se recuperaron la política de visibilidad, wake lock, gracia de mute de tres segundos cancelable con unmute, entrega solicitada cada segundo y análisis RMS.
- Medidor anterior a ea5ce74: src/app/(dashboard)/grabar/[turnoId]/_components/medidor-audio.tsx. Catorce barras, escala RMS × 6, umbral RMS 0,012 y aviso tras dos minutos de silencio. Respeta las duraciones CSS actuales. Si el análisis no está disponible no afirma que entra sonido.
- Equivalente nuevo de grabador-interrupciones.test.tsx: src/lib/__tests__/grabador-interrupciones.test.tsx. También cubre cierres tardíos, stop que lanza y reanudación tras pagehide.
- sesion-clinica-response.test.ts recupera la intención de la versión anterior a 85df385, adaptada al contrato actual. Commit separado b7aaedadb1bdbc9c25b6e426c0ff98dec4d52afe. No cambia la respuesta de producción.
- La demora tolerada del hilo pasa de 1,5 a 5 segundos. Se agrega un cierre preventivo a los 63 segundos de un recorder para no comenzar un solape que exceda los 65 admitidos por el worker. Ver limitación abierta abajo.
- stop tiene un límite de cinco segundos. Al vencer se conserva el prefijo recibido, se informa una interrupción y se liberan los controles. Los eventos tardíos no duplican segmentos. Terminar no oculta ese aviso ni cierra automáticamente la sesión tras el fallo.

## Respaldo por segundo

start(1000) por sí solo no escribe en disco. Cada entrega produce un prefijo acumulado, cifrado con cifrarSegmento existente (AES-GCM, IV nuevo, mismo AAD), almacenado en IndexedDB con durability strict. No se guarda texto claro ni una clave en IndexedDB.

La base local pasa aditivamente de v1 a v2, con un almacén separado de respaldos. Los segmentos definitivos siguen siendo archivos independientes de 60 segundos con el solape de 1000 ms. La subida solo ve segmentos consolidados. Durante el solape se respalda el recorder anterior, que todavía cubre ese audio; al consolidarlo toma su lugar el nuevo.

La escritura del segmento, el avance del reloj y la retirada de su respaldo son una sola transacción. Al reabrir, un prefijo durable se incorpora una sola vez, sin red ni clave local, y la grabación queda interrumpida. No se elimina ningún segmento definitivo. El guardián de consentimiento distingue esta consolidación del borrado de una copia de audio; su texto no cambió.

Costo: reescribir prefijos acumulados cifra y escribe aproximadamente treinta veces los bytes de un segmento durante su minuto, aunque en disco solo conserva un respaldo por grabación. Es un costo de CPU/IO, no de red. Falta medir batería y latencia en teléfonos. Se eligió para mantener intactos el formato cifrado y el contrato del worker, y permitir recuperación sin conexión.

## Rojo antes del arreglo

- Sobre la implementación base, los nueve casos iniciales de grabador-interrupciones.test.tsx fallaron: ocultar/volver; wake lock; mute/unmute; gracia de mute; demora de dos segundos; start(1000) y respaldo; Pausar sin stop; Terminar sin stop; pagehide sin stop y reanudación. Fuente todavía intacta al ejecutar.
- El caso de UI del medidor falló antes de conectarlo: siete casos anteriores pasaban y el nuevo no encontraba el indicador.
- Respuesta clínica: nueve casos pasaron en la base, porque la protección ya existía. Dos mutaciones temporales independientes hicieron fallar la guardia: incluir transcripción/clave en SESION_SELECT y propagar la fila completa en la respuesta. Se restauró exactamente el archivo original después de cada ensayo. No se inventó un rojo del código correcto.

Comando enfocado: npx vitest run src/lib/__tests__/grabador-interrupciones.test.tsx src/lib/__tests__/audio-captura.test.ts src/lib/__tests__/audio-entorno.test.ts src/lib/__tests__/audio-grabadora.test.ts src/lib/__tests__/audio-ui.test.tsx src/lib/__tests__/sesion-clinica-response.test.ts src/lib/__tests__/consentimiento.test.ts

## Navegador real

Ejecutar desde la raíz: node pruebas/grabador-regresiones/verificar.mjs

Requiere Chromium de Playwright: npx playwright install chromium. No agrega dependencias. Usa getUserMedia, MediaRecorder, Web Crypto e IndexedDB reales con un micrófono sintético nativo de Chromium. Solo simula la API local para no enviar datos a R2 ni a proveedores. No es el recorrido de la app contra producción.

Se mata con SIGKILL el renderer del navegador aislado; no se llama a stop ni se despacha pagehide. Se vuelve a abrir una pestaña con el mismo almacenamiento. La evidencia completa está en resultado-chromium.json.

| Medición | Resultado |
| --- | --- |
| Chromium de escritorio | 145.0.7632.6 |
| Reloj antes de matar el renderer | 62,509 s |
| Reloj persistido recuperado | 62,060 s |
| Diferencia de relojes | 449 ms |
| Segmento 0 decodificado | 60,060 s; inicio 0 |
| Segmento 1 recuperado del respaldo | 3,000 s; inicio 59,000 s |
| Fin del audio decodificado sobre la línea temporal | 62,000 s; aproximadamente 509 ms antes de la caída |
| Reapertura y recuperación repetida | Sin duplicar el índice ni el reloj |
| Transacción definitiva abortada | Conserva el respaldo y el reloj anterior |
| Actualización desde IndexedDB v1 | Conserva la grabación previa |
| Lectura desde otra cuenta | No ve esta grabación |

## Validación local

- npx tsc --noEmit: sin errores.
- npm run lint: sin errores ni avisos.
- npm test, TZ=UTC: 170 archivos en verde, 2004 tests en verde; 1 medición optativa ya omitida en pruebas/vida/interacciones.test.tsx (se habilita con MEDIR_UI=1). Duración 269,44 segundos.
- Integración: Postgres 17 exclusivo en Docker, contenedor pg-sesion-grabador-regresiones, puerto local 61647, base sesion_test. Migraciones únicamente allí.
- codex review --uncommitted: detectó el borde de rotación demorada a 64,5 segundos; corregido con test. Identificó también la suspensión larga descrita abajo, pendiente de decisión del dueño.
- contrato.ts, cifrado.ts, processor/** y publicar.yml sin cambios. No se toca release ni se abre PR.

## Limitación abierta y prueba física

**Suspensión larga de JavaScript:** si el sistema congela la página más allá de una frontera y MediaRecorder sigue capturando, ningún timer de la página puede reiniciar el recorder en ese intervalo. Al volver puede existir un archivo mayor a 65 segundos, que el worker actual rechaza. La parada preventiva no puede ejecutarse durante el congelamiento. No se recorta ni descarta audio para ocultarlo. Este hallazgo P1 sigue abierto: el verde de la suite no prueba que ese archivo vaya a procesarse. Se consultó al dueño si mantener la barrera de no tocar el worker o autorizar un ajuste acotado; no se lo modificó.

**Un segundo no es una garantía absoluta:** timeslice es una solicitud. El navegador puede demorar dataavailable y el almacenamiento. La especificación solo garantiza reproducibilidad del conjunto de blobs de una grabación completa; el prefijo recuperado fue comprobado en Chromium/WebM, no en Safari/AAC. Referencias: [MediaRecorder dataavailable](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event) y [MediaStream Recording](https://w3c.github.io/mediacapture-record/).

Falta en Android e iPhone físicos: bloqueo manual, volver de otra aplicación, llamadas/mute transitorio y persistente, permiso/revocación de wake lock, muerte real de la PWA, recuperación del prefijo AAC de Safari y costo de los respaldos. La app ya no interrumpe por visibilitychange; eso no obliga al sistema operativo a mantener el micrófono.
