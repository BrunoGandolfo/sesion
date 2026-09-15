# Audio — reconstrucción

Base `34187da`, rama `audio`, worktree propio `sesion-audio`.

## Resultado

Captura comprimida, cifrado antes de persistir, recuperación por identidad,
subida reconciliada y ensamblado por fronteras medidas. La prueba final en teléfonos
físicos y la configuración del bucket real siguen pendientes: no se habilitó producción.

### Único cambio de esquema

`audio_segmentos.inicio_ms`, `DOUBLE PRECISION NULL`, **sin default**. La migración
solo contiene `ALTER TABLE ... ADD COLUMN`; no actualiza, elimina ni reescribe datos.
Se reemplazó la propuesta no publicada de `solape_ms`; esa columna no se entrega.
La base de pruebas anterior se conservó; la migración final se aplicó a otra base
local de Postgres 17. No se ejecutó contra Neon ni producción.

`inicioMs` es el inicio acumulado en el reloj monotónico de captura. El primero
es cero; una rotación conserva su inicio real, aunque se retrase el cierre anterior.
Las pausas no avanzan el reloj de captura: reanudar continúa desde la duración
acumulada y deja la pausa en la sesión. Recargar recupera ese acumulado durable.
No se usa hora de pared ni cantidad de segmentos para medir la captura.

### Ensamblado y pruebas obligatorias

El worker decodifica cada archivo completo con ffmpeg y cuenta sus muestras.
Para AAC usa además el fin válido del MP4, evitando acumular padding del codec.
Normaliza los timestamps antes de recortar. Calcula la cobertura con inicio más
duración decodificada; recorta el solape del siguiente con precisión de una
muestra (0,0625 ms a 16 kHz). Si hay un hueco, conserva completo el siguiente,
lo marca como interrupción y no rellena con silencio. La salida se valida contra
la suma exacta de muestras conservadas. Se eliminó la tolerancia de 0,55 s
contra `duracionAudioSeg` redondeada.

Pruebas con AAC y Opus reales, cifrado real y ffmpeg real:

- Primer archivo de 59,8 s, segundo iniciado en 59 s, tono en 59,9 s:
  se recortan 800 ms, sobrevive el tono y la salida dura 118 s.
- Primer archivo de 59,8 s, segundo iniciado en 60 s: hueco marcado de 200 ms,
  segundo completo incluido su tono inicial, salida de 117,8 s sin silencio añadido.
- Una pérdida artificial de 200 ms durante la unión final se rechaza por diferencia
  de muestras; ya no pasa por redondeo.
- Secuencias de 125 s y 472,3 s, con rotaciones cada 59 y 58,9 s: duración,
  posición e identidad de pulsos, sin pérdidas ni repeticiones en las fronteras.

Los huecos se avisan en el log al detectarlos y se guardan antes de enviar al ASR
como interrupciones en `sesiones_clinicas.pausas`, mediante el endpoint existente
de renovación del lease. La pantalla muestra «Audio posiblemente incompleto».
Las pausas originales se conservan; repetir el envío no duplica marcas, y un intento
viejo no puede modificarlas. Si la app no guarda el aviso, el worker reintenta sin
transcribir todavía. El aviso sobrevive a fallos del ASR y reintentos con checkpoint.

## Lo construido

- MediaRecorder produce segmentos independientes de ~60 s, Opus/WebM o AAC/MP4
  según soporte. Dos grabadores comparten pista durante el segundo previsto de solape.
  El worker decide el recorte a partir del contenido, no de ese segundo previsto.
- AES-GCM con clave por sesión, IV aleatorio de 12 bytes por segmento y AAD que
  autentica organización, sesión e índice. Ciphertext y tag son el único contenido
  binario guardado; descriptor separado con IV, bytes, SHA-256 e inicio.
- Clave custodiada por `cifrarSesion` en servidor; en el teléfono vive solo en RAM,
  importada como no extraíble. Ninguna escritura de audio nuevo controlada por la
  app va en claro a IndexedDB.
- Identidad creada y persistida antes de capturar. IndexedDB separado por cuenta y
  sesión, índice único por turno y Web Locks por organización y turno para impedir
  dos escritores, incluso si son cuentas diferentes de la misma organización.
- Una grabación pendiente se recupera con su identificador y nunca se reemplaza
  al tocar Grabar. La base vieja de pruebas sin cifrar se retira y se informa;
  no hay migración de esas copias. No se inspeccionaron teléfonos físicos.
- Subida durante captura: reserva inmutable, PUT condicional, HEAD y reconciliación
  antes de reenviar si se perdió la respuesta. La incertidumbre conserva la copia
  y ofrece comprobar; no afirma que el audio no se guardó.
- Cierre transaccional por `empezar_subida` y `audio_listo`, inventario consecutivo
  y confirmado, turno realizado y recordatorios pendientes cancelados. Solo
  `audio_listo` habilita la primera entrada a procesamiento.
- Límite de 150 minutos de captura, aviso a 135, pausas y solape contados una vez.
  En el límite se pausa; la profesional decide terminar.
- Bloqueo/ocultación de página y señales del micrófono pausan y marcan incertidumbre.
  No se inventa sonido perdido. Un fallo de almacenamiento conserva los segmentos
  pendientes en memoria y permite reintentar sin duplicarlos ni perder la pausa.
- Al pausar durante un solape se conservan ambos archivos, incluso si el reloj dice
  que el segundo está cubierto entero: el primero podría estar truncado.
- Antes de empezar, vuelve a comprobar la visibilidad y que el micrófono no haya
  quedado mudo o terminado durante la escritura asíncrona de arranque. Una
  interrupción automática no espera a que termine una acción de pantalla.
- Reintentar primero guarda los segmentos o la pausa retenidos en memoria y luego
  sincroniza. No se limita a repetir la subida de lo que ya era durable.
- Terminar espera la subida iniciada antes del cierre y luego envía el cierre.
  La lectura clínica conserva tanto pausas medidas como las fechas históricas.
- Si la sesión desapareció del servidor, una acción explícita con segundo 404
  archiva la copia local sin borrar identidad ni segmentos y libera el turno.
- Worker con un segmento de audio en RAM y archivo temporal privado en disco;
  ffmpeg decodifica y une, ASR recibe un archivo abierto desde disco. La imagen
  Docker incluye ffmpeg/ffprobe y comprueba ambos antes de reclamar sesiones.
- Firmador R2 sin checksum del cuerpo vacío: la prueba usa el SDK real y
  credenciales ficticias, sin llamar a R2.

## Contratos

Rutas de audio autenticadas, aisladas por organización, respuestas no-store.
Formato habitual `{data}` o `{error}`.

| Ruta | Contrato |
|---|---|
| POST `/api/audio` | `{turnoId}` → `{id}`, idempotente por turno |
| GET `/api/audio/[id]` | Estado e inventario; nunca clave |
| POST `/api/audio/[id]/clave` | Captura autorizada y abierta → `{clave}` |
| POST `/api/audio/[id]/segmentos` | `{indice,iv,bytes,sha256,inicioMs}` → URL y cabeceras o recibo existente |
| POST `/api/audio/[id]/confirmar` | `{indice}` → `{confirmado}` |
| POST `/api/audio/[id]/finalizar` | `{cantidad,duracionAudioSeg,pausas}` → estado reconciliado |
| POST `/api/sesion-clinica/[id]/lease` | Renovación con ticket e intento; admite `pausasAudio` con pausas e interrupciones medidas |

El servidor calcula R2 `<organización>/<sesión>/<índice>`, no guarda ni recibe una
key del cliente. PUT: `Content-Type: application/octet-stream`, `If-None-Match: *`,
huella en metadata firmada. `inicioMs` forma parte del descriptor inmutable y llega
al worker; `null` significa desconocido y se conserva para revisión, nunca se inventa.

## Retirado

GrabadorSesion, cinco utilidades `grabacion-*`, captura/subida monolítica de los hooks,
medidor sin consumidores, concatenación de bytes y base64 de toda la sesión en Python.
`useGrabacionSesion` queda como lectura para la ficha; `crypto.ts` conserva SHA-256
para acceso y tokens. `/grabar/nuevo` dirige a Agenda para crear un turno.
No quedan llamadas a `upload-url` ni `upload-confirmar`.

## Textos para integrar

- «Hay una grabación de este turno. Podés recuperar y enviar lo guardado o reanudarla.»
- «La captura se interrumpió. Este tramo puede estar incompleto; revisá el micrófono antes de reanudar.»
- «Se recuperó lo guardado. El tramo que estaba en captura al cerrarse la app puede estar incompleto.»
- «No pudimos confirmar el envío. La copia cifrada se conserva y se reintentará.»
- «Se retiraron las grabaciones de prueba anteriores, que estaban sin cifrar.»
- «La captura se detuvo porque no se pudo guardar un segmento. Mantené esta página abierta y reintentá.»
- «El micrófono interrumpió la captura. El último tramo puede estar incompleto.»
- «El micrófono no entregó audio para este tramo. No se pudo recuperar; lo guardado anteriormente se conserva.»
- «Esta copia no tiene la medida del inicio. Se conserva para revisar.»
- «Hay otro contenido o inicio para este segmento. Se conservan ambas copias.»
- «Llevás 135 minutos. La captura se pausará al llegar a 150.»
- «Llegaste al límite. Elegí Terminar para procesar lo guardado.»
- «Mantené la pantalla encendida. Si se bloquea o se interrumpe el micrófono, el tramo puede quedar incompleto y habrá que reanudar.»
- «Audio posiblemente incompleto» / «Se detectó una interrupción en la grabación. Revisá la nota teniendo en cuenta que puede faltar parte de lo conversado.»
- Acciones: «Reanudar grabación», «Terminar y enviar», «Enviar grabación pendiente»,
  «Comprobar y reintentar envío», «Conservar copia y habilitar otra grabación».

## Consentimiento, dependencias y desacuerdos

1. `RESPALDO_LOCAL_CIFRADO` ya estaba **true** en `34187da`, contrario a la consigna.
   No se cambió. El cifrado por segmentos tiene pruebas; el dueño debe revisar
   ese valor con esta evidencia y la prueba final del teléfono.
2. El consentimiento dice que el worker descifra «solo en memoria»; la decisión
   vigente exige archivo temporal en disco. El dueño debe ajustar esa frase.
3. Borrar R2/ASR se rinde a los veinte intentos: la promesa «hasta lograrlo» **no
   queda cumplida**. No se cambió la política. Además, sigue la ventana anterior
   entre crear un transcript externo y registrar durablemente su id en la app.
4. Ningún grabador web recupera sonido que el sistema operativo no capturó ni
   bytes del segmento abierto si mata la página antes de persistir. Se recuperan
   los segmentos cifrados durables y se advierte sobre el tramo incierto.
5. Audio claro existe transitoriamente en RAM antes de AES. La garantía implementada
   es no persistir audio claro mediante la app, no auditar memoria o cachés del SO.
6. Faltan iPhone/Android físicos: solape real, pantalla bloqueada, llamadas entrantes,
   cierre forzado, batería/cuota y medición de RAM. WebKit automatizado no acredita iPhone.
7. El dueño debe aplicar la migración y desplegar app y worker compatibles antes
   de habilitar la captura; el worker usa la imagen Docker que incluye ffmpeg.
8. Falta CORS y PUT real en R2 con las cabeceras indicadas. No se llamaron proveedores
   reales ni se probaron sus borrados. Las pruebas de red usan respuestas simuladas.

No se hicieron formatos propios, manifiestos, migración de audio viejo, captura PCM,
streaming al ASR ni otra columna. No se tocaron Recorrido, hilo, consentimiento,
glosario, ayuda, `release` ni `publicar.yml`. No se ejecutaron workflows ni se abrieron PRs.

## Evidencia

| Criterio | Prueba | Alcance |
|---|---|---|
| 150 minutos, pausa y decisión al límite | `audio-captura.test.ts`, `audio-ui.test.tsx`, `pruebas/audio/navegadores.mjs` | Reloj y grabador simulados |
| Recuperación con id y sin reemplazar | `audio-grabadora.test.ts`, navegador con IndexedDB real | No recupera el segmento todavía abierto al matar el proceso |
| Cifrado y aislamiento | Web Crypto real, descifrado Python, IndexedDB y Web Locks en ambos motores | No audita cachés internos del SO |
| Pérdida de respuestas | `audio-sincronizar.test.ts`, Postgres local | Cortes antes/después de reserva, PUT, confirmación y cierre; R2 simulado |
| Escrituras e interrupciones | Rollback IndexedDB, fallos en segmento/pausa/inicio, error MediaRecorder | No es una matriz de cierre forzado en cada instrucción del navegador |
| Memoria acotada | Dos recorders, un cifrado pendiente; lectura por segmento; archivo temporal worker | Sin benchmark de RAM físico |
| Duración y continuidad | `test_audio_entrada.py`, AAC/Opus/ffmpeg reales | 125 s, 472,3 s, truncado recuperable, hueco real y pérdida al unir |
| Aviso durable | `test_processor.py`, `test_app_client.py`, `audio-integracion.test.ts`, vista de sesión | Pausas conservadas, aviso repetido, intento viejo rechazado, relectura y aviso |
| Migración aditiva | `audio-integracion.test.ts`, diff de Prisma | Fila anterior conserva contenido, xmin y ctid; columna nullable sin default |
| Contratos y código viejo | Tipos, lint, suite y guardias | Sin llamadas a rutas eliminadas |

Las pruebas usan Postgres 17 en Docker, `127.0.0.1:60530/sesion_inicio_test`.
El descifrado, ffmpeg y los mecanismos de almacenamiento del navegador son reales;
R2, ASR, LLM, micrófono y tiempo largo son simulados según cada prueba.

Revisión `codex review --uncommitted` ejecutada antes del commit. Sus dos P2
(arranque interrumpido y reintento de persistencia local) se corrigieron con cinco
pruebas de regresión. El caso anterior de recorte que perdía el tono queda resuelto
por las pruebas reales de ambas familias de codec. No quedan hallazgos conocidos
P1/P2 sin resolver en esa revisión.

Resultados finales del 15 de septiembre de 2026:

- Python: **183 pruebas en verde**.
- Chromium y WebKit: cada uno completó **150 minutos simulados, 153 segmentos**,
  cifrado y recarga, aislamiento, exclusión entre pestañas y rollback. Máximos:
  dos recorders y un cifrado pendiente. Primer inicio persistido 0, segundo 59.000 ms.
- Tipos: cero errores. Lint: cero errores y cero advertencias.
- Guardias: aprobados; se mantiene el aviso previo del ensayo de restauración
  pendiente y se ejecutaron sin comprobar drift contra producción.
- Prisma: el diff contra la base produce únicamente ADD COLUMN inicio_ms.
- Imagen Docker: construida; imports y presencia de ffmpeg/ffprobe comprobados sin red.
- Suite completa de la app: **1.725 pruebas, 147 archivos, todos en verde** (181 s).

