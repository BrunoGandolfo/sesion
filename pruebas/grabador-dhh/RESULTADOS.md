# Grabador DHH en Chromium — 18 de septiembre de 2026

`node pruebas/grabador-dhh/verificar.mjs` (requiere `npx playwright install
chromium` y ffmpeg). Corre el hook REAL (`useGrabador`) y la subida REAL
(`subirAudio`) en Chromium 145 con micrófono sintético, contra una API local
que recibe el PUT en disco. No habla con R2, Neon, Railway ni proveedores.
La salida completa está en `resultado-chromium.json`.

Guion: grabar 20 s → Pausar 5 s → **doble toque** en Reanudar → 12 s → el hilo
de la página trabado 10 s → 8 s → Terminar → subida por upload-url / PUT /
upload-confirmar. Después, subida de un Blob de 118 MB (dos horas).

| Qué se midió | Resultado |
| --- | --- |
| MediaRecorder creados | **1** |
| `pause()` / `resume()` / `stop()` | 1 / **1** (con doble toque) / 1 |
| Cabeceras EBML del archivo subido (el contador del worker) | **1** |
| Errores de ffmpeg al decodificarlo | ninguno |
| Audio decodificado (muestras PCM) | 50,04 s |
| Duración que informó el teléfono, contando chunks | 49 s |
| Reloj de pared de toda la prueba | 60,2 s (la pausa y los clics no cuentan) |
| Mayor salto entre marcas de tiempo del WebM | 0,063 s: la pausa no deja hueco en el archivo |
| Hilo trabado 10 s | sigue `grabando`, **no inventa un hueco** (el audio llegó después, en un chunk de 216 KB) y queda `hueco-latido` de 10.061 ms en el diagnóstico |
| `upload-url` | sólo `tamanoBytes` y `mime`: sin IV ni clave |
| Dos horas (117.964.800 bytes) subidas tal cual | llegaron completas; mayor traba del hilo **4 ms**; heap de JS 37 MB antes y 37 MB de pico |

Con el cifrado anterior ese mismo archivo pasaba por `arrayBuffer()` y base64:
congelaba la pantalla ~7 s con 23 MB.

## Lo que esta prueba encontró y cambió el código

1. **Chromium no entrega los chunks atrasados como se supone.** Tras trabarse
   el hilo llega primero un chunk chico y, un segundo después, uno enorme con
   todo el audio. La primera versión de `contarChunk` declaraba un hueco falso
   ahí. Ahora acredita por tamaño antes de decidir.
2. **El reloj de pared retrocede.** En esta máquina (WSL2) `Date.now()`
   retrocedía 2,4 s cada 30 s y el teléfono informaba 47 s de un audio de 52.
   La medición usa ahora un reloj que no retrocede (`crearReloj`).
3. `Page.setWebLifecycleState: frozen` **no congela** una página que captura
   micrófono en Chromium: los chunks siguieron llegando cada segundo. Un hueco
   real de audio no se puede fabricar con el micrófono sintético; lo cubren las
   pruebas del hook con reloj falso.
