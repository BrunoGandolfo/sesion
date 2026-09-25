# Pipeline clínico: implementación y límites de main

## Captura y subida

La pantalla `src/app/(dashboard)/grabar/[turnoId]/page.tsx` usa
`src/components/grabacion/GrabadorSesion.tsx` y `src/hooks/useGrabacionSesion.ts`
para la subida. Una grabación es **un solo MediaRecorder** desde Grabar hasta
Terminar, con `start(1000)`:

- la pausa manual y el tope de 150 minutos usan `pause()`/`resume()` del mismo
  recorder; un micrófono silenciado o un rato sin chunks no cambian nada (se
  avisa en pantalla, con horas); sólo `ended` de la pista o `onerror` del
  recorder terminan la grabación, y ahí sólo se ofrece guardar lo grabado.
  Nunca se abre un segundo recorder ni se pega su salida;
- cuánto se grabó lo miden los chunks recibidos (`src/lib/grabacion-captura.ts`:
  `contarChunk`), no el reloj de pared. El tope se aplica sobre eso. El RMS del
  analizador sólo alimenta el medidor y el aviso visible de silencio;
- el wake lock lo lleva `src/hooks/usePantallaEncendida.ts`, desde que se abre
  la pantalla hasta que la subida está confirmada.

**La app no cifra el audio.** Cada chunk se escribe en IndexedDB como `Blob`
(`src/lib/grabacion-storage.ts`) y el archivo final es un `Blob` de esos
`Blob`s, que se sube con el PUT prefirmado tal cual, sin `arrayBuffer()` ni
copias en memoria. El audio viaja por TLS, R2 lo cifra en reposo y se borra al
aprobar la nota (`borrar_audio_r2`). Las columnas `audio_clave_encrypted` y
`audio_iv` siguen en el esquema, sin usarse.

La subida son tres pasos: `POST [id]/upload-url` (grabando → subiendo, devuelve
la URL prefirmada), PUT directo a R2 y `POST [id]/upload-confirmar` (HeadObject;
subiendo → procesando sólo si el objeto está, si no vuelve a grabando y
responde 409). Con la confirmación viaja un **diagnóstico** sin contenido
clínico (`diagnosticoGrabacionSchema` en `src/lib/sesion-clinica/schema.ts`:
pausas, tope, mute, pista terminada, visibilidad, wake lock
concedido/rechazado/soltado, huecos entre latidos y entre chunks mayores a 5 s,
cantidad de chunks y bytes) que la ruta guarda en
`eventos_auditoria.detalle` de `sesion.subir_audio_fin`.
`POST [id]/volver-a-grabar` (subiendo → grabando) es la que pide el cliente
para repetir una subida que falló. El turno pasa a realizado por
`PATCH /api/turnos/[id]` desde la pantalla, con la subida confirmada.

`duracion_audio_seg` es lo que midió el teléfono. La duración que informa el
ASR no la pisa: queda en el detalle de `sesion.transcripcion_guardada`
(`duracionAsrSeg`). Cuando difieren, esa diferencia es el dato. Si la del ASR
supera a la del teléfono en más de 10 % y en más de 60 s, el mismo detalle trae además
`avisoDuracion: "asr_inflada"`, `duracionTelefonoSeg` y `excesoPct` (ver
"Qué se manda al ASR").

La key de R2 se calcula como organización/sesión/0, sin persistir una key
enviada por el cliente: `src/lib/sesion-clinica/estados.ts`.

## Estados y operaciones existentes

La tabla única es `src/lib/sesion-clinica/estados.ts`; el contrato de datos
está en `src/lib/sesion-clinica/schema.ts`.

Flujo previsto: grabando → subiendo → procesando → revision → aprobada.
fallida permite reintentar o eliminar. aprobada es terminal para la nota.

| HTTP | Precondición y efecto |
| --- | --- |
| `GET /api/sesion-clinica/[id]` | Lectura de la sesión de la organización. |
| `POST /api/sesion-clinica/[id]/aprobar` | revision → aprobada; nota final, clave destruida y trabajos creados en una transacción. |
| `POST /api/sesion-clinica/[id]/reprocesar` | revision → procesando; conserva la generación previa mientras espera otra. |
| `POST /api/sesion-clinica/[id]/reintentar` | fallida → procesando; exige transcripción o audio utilizable. |
| `POST /api/sesion-clinica/[id]/eliminar` | Sólo fallida; elimina la sesión y deja un trabajo de borrado de audio cuando corresponde. |
| `GET /api/sesion-clinica/[id]/transcripcion` | Lectura autorizada de la transcripción. |
| `POST /api/sesion-clinica/[id]/feedback/reintentar` | revision o aprobada; pide Para vos de nuevo sin alterar la nota. |

Cada transición condiciona organización, estado y, para el worker, intento.
Una escritura de un intento viejo se rechaza. La existencia de un endpoint
no implica que su control esté cableado en la pantalla: confirmación de
menciones, enlace de transcripción y reintento de Para vos siguen pendientes
de integración de UI en esta base.

## Reclamo del procesamiento

`GET /api/sesion-clinica/pendientes` usa `PROCESSING_SECRET` para
reclamar sesiones. `src/app/api/_lib/casos-uso/sesion/reclamar.ts` entrega
una por defecto, hasta cinco si se solicita el límite. El claim es atómico;
incrementa intento, genera un ticket y da un lease de cinco minutos.

El payload incluye sesión, paciente, intento, ticket, orientación, vocabulario
ASR, duración y uno de estos recursos:

- audio: organización, key calculada y pausas (sin clave ni IV: la app no
  cifra el audio);
- checkpoint: transcripción ya guardada, métricas y modelo ASR.

Con checkpoint no se vuelve a descargar ni a transcribir. El vocabulario es
best-effort: si falla su consulta se entrega una lista vacía y se registra el
tipo de error, sin publicar los términos.

El worker renueva el lease cada 60 segundos. Las escrituras llevan el ticket
del reclamo y el intento, no el secreto general:

| HTTP | Uso |
| --- | --- |
| `POST /api/sesion-clinica/[id]/lease` | Renovar el reclamo vigente. |
| `POST /api/sesion-clinica/[id]/asr` | Registrar el id del transcript y su trabajo de borrado. |
| `POST /api/sesion-clinica/[id]/transcripcion` | Persistir el checkpoint antes del modelo. |
| `POST /api/sesion-clinica/[id]/resultado` | Entregar nota o fallo. |

Cliente: `processor/app_client.py`. Un 401/409 invalida el intento;
otros 4xx son terminales para ese envío, y 5xx o falta de respuesta dejan
que el lease permita recuperación. Hay cinco fallos transitorios seguidos
antes de agotar la sesión; el backoff está en la tabla de estados, no en
las antiguas variables de entorno de lease.

## Worker, ASR y nota

`processor/worker.py` ejecuta `processor/processor.py`.
`descargar_audio` baja el archivo por su key (`processor/r2_client.py`) y
comprueba que sea UNA grabación: cuenta cabeceras EBML (el id `1A 45 DF A3`
seguido de su tamaño y del elemento `EBMLVersion`, para no confundirlo con esos
cuatro bytes dentro del audio). Con más de una falla antes del ASR con el
código definitivo `audio_varias_cabeceras`: son grabaciones pegadas y
transcribirlas daría una nota de una parte de la sesión sin avisar.
Después, `preparar_para_asr` normaliza el archivo (abajo) y `transcribir`
lo manda al ASR desde memoria. No se escribe audio en disco.

### Qué se manda al ASR, y por qué

No el archivo del teléfono tal cual: `processor/audio_asr.py` lo pasa por
ffmpeg, en pipes, y lo que va a AssemblyAI es **Ogg/Opus, mono, 16 kHz,
32 kbit/s, con cada sello de tiempo reescrito desde la cuenta de muestras**
(`asetpts=N/SR/TB`).

Por qué: AssemblyAI mide (y factura) la duración por los sellos de tiempo del
contenedor, no por las muestras. Con el teléfono bloqueado, el sistema
suspende el proceso de Chrome y los sellos del WebM saltan hacia adelante
mientras las muestras no. El 24-09-2026 una sesión de 54 minutos (3.232 s
medidos) se facturó como 16.269 s; el 19-09, 1.590 s como 4.143 s. Las dos
fueron las únicas con el teléfono bloqueado durante la grabación. Reproducido
con ffmpeg: 60 s de muestras con la segunda mitad corrida declaran 10.800 s
según ffprobe; normalizado, 60,0 s. El salto se descarta, no se rellena con
silencio: esas horas nunca tuvieron audio.

Por qué Ogg/Opus: Ogg escribe la duración de corrido (posiciones de gránulo)
y sale entera por un pipe; FLAC por pipe queda sin duración en la cabecera y
WAV pesa 230 MB en dos horas. Opus a 32 kbit/s en banda ancha es transparente
para voz. Dos horas tardan ~65 s y ~55 MB de memoria (medido con ffmpeg
6.1.1).

Si ffmpeg falla (no está en la imagen, el archivo no se puede leer, pasan
10 minutos) se manda el original, como antes, y queda `normalizacion_fallida`
en el log con el motivo. La sesión no falla por esto.

**Guardia.** Al volver el ASR, `aviso_duracion` compara su duración con
`duracionAudioSeg` (la del teléfono). Si la supera en más de 10 % y en más de
60 s (el piso evita avisos por uno o dos segundos en grabaciones cortas), el worker
lo escribe en el log (`duracion_asr_inflada`) y lo manda en el checkpoint;
la app lo deja en el detalle de `sesion.transcripcion_guardada`. La sesión
sigue. Que aparezca es la señal de que la normalización dejó de funcionar,
o de que algo nuevo infla la duración.

La imagen del worker (`processor/Dockerfile`) instala ffmpeg por apt, y el
job `worker-tests` de CI también: los tests generan y miden archivos reales.

`processor/asr_assemblyai.py` usa la API REST de AssemblyAI. Los defaults
de `processor/config.py` son universal-3-5-pro con fallback universal-2,
español y diarización. Normaliza los roles y calcula métricas con
`processor/speech_analytics.py`.

**Límite del borrado ASR:** el módulo intenta borrar en finally. El registro
durable del id en la app sucede al volver del ASR, en registrar_checkpoint;
todavía existe una ventana si el proceso muere antes de ese registro.
El código no garantiza persistir el id en cuanto el proveedor lo crea.

Después del checkpoint, `processor/clinical_analyzer.py` pide la nota SOAP
con el prompt `processor/prompts/clinical_note_v3.1.1.md`.
El default es claude-sonnet-5; las opciones efectivas viven en
`processor/config.py`. Los enums compartidos salen de
`processor/contrato/enums-clinicos.json`.

`src/app/api/_lib/casos-uso/sesion/resultado.ts` acepta la nota sólo tras
el checkpoint, incrementa la generación, pasa a revision y crea
generar_feedback en la misma transacción. Para vos se procesa por separado;
no bloquea la nota. Los tipos de trabajo que este worker ejecuta hoy son
borrar_transcript_asr, generar_feedback e integrar_contexto.

## Revisión, aprobación y limpieza

`src/app/api/_lib/casos-uso/sesion/aprobar.ts` exige confirmar un riesgo
moderado/alto o las menciones léxicas que correspondan. Dentro de una
transacción guarda la nota final, anula audioClave (sólo tiene valor en sesiones
grabadas antes de que la app dejara de cifrar el audio), pasa a aprobada y crea
los trabajos borrar_audio_r2 (si hay audio) e integrar_contexto.
No llama a R2 antes de confirmar la base. El evento de auditoría se registra
después de esa transacción, con hash de nota y sin texto clínico.

El cron `GET /api/cron/trabajos` ejecuta los borrados de R2 en la app;
el worker reclama sus trabajos mediante `GET /api/trabajos/pendientes`
y responde por `POST /api/trabajos/[id]/resultado`.
La política en `src/app/api/_lib/casos-uso/trabajos/politica.ts` tiene
topes: 20 intentos para borrados, cinco para feedback y seis para contexto.
Un trabajo fallido necesita seguimiento; no se promete reintento infinito.

Destruir la clave de la fila activa no elimina una clave cifrada que ya haya
entrado en un backup. Su alcance está en `docs/encryption.md`.

## Recorrido y propuestas

El contenido clínico del Recorrido vive sólo en `hilo_versiones.contenido_encrypted`
(`cifrarHiloVersion`). Cada edición inserta una fila: nada se sobrescribe. Las
resoluciones sólo cambian estado, autora y fecha. El puntero vigente y la
numeración se actualizan bajo el bloqueo de la fila de la paciente en `hilos`;
el orden de locks es siempre hilo y después trabajo.

Aprobar una nota crea `integrar_contexto` en la misma transacción
(`src/app/api/_lib/casos-uso/hilo/trabajo.ts`). La IA sólo **propone**: la
propuesta no cambia la vigente. Si la vigente cambió mientras la IA trabajaba,
la propuesta entra como desactualizada; si la profesional edita mientras hay
una propuesta abierta, la desactualiza en la misma transacción. Aceptar con
ediciones crea una versión profesional con `propuestaOrigenId`. Rechazar
termina el asunto: regenerar y reintentar son pedidos explícitos.

Las intervenciones referencian sesiones por UUID (`sesiones`), nunca por un
número calculado al contar aprobaciones; toda referencia tiene que ser una
nota aprobada de esa paciente.

### Qué recibe y qué devuelve `integrar_contexto`

El reclamo (`trabajos/reclamar.ts`) toma el lock del hilo y fija
`basadaEnVersion` en el payload con la versión vigente. **Concurrencia:** no
se entrega un `integrar_contexto` si la paciente tiene una propuesta abierta
o un trabajo anterior del mismo tipo sin terminar; la cola se pagina para
que una paciente bloqueada no oculte los trabajos de otras.

El adjunto que recibe el worker tiene exactamente estos campos:

| Campo | Qué es |
| --- | --- |
| `tipo` | `"integrar_contexto"` |
| `pacienteId`, `sesionId` | Tienen que coincidir con los del payload |
| `version` | La vigente al reclamar (= `payload.basadaEnVersion`); 0 si no hay Recorrido |
| `contextoVigente` | El contenido de esa versión, o `null` con versión 0 |
| `notaFinal` | La nota aprobada: `subjetivo`, `objetivo`, `analisis`, `plan` |
| `datos` | `datosEstructurados` de la sesión, sin `riesgoLexico` |
| `fechaSesion` | Día del turno en Montevideo (`AAAA-MM-DD`, `src/lib/fechas-montevideo.ts`) |

`processor.integrar_contexto` valida identidad, versión, forma del contexto
vigente, nota y fecha **antes** de llamar al modelo (si no, devuelve
`{ok: false, error: "adjunto_invalido: …"}`), usa
`processor/prompts/update_context_v2.1.md` y devuelve
`{ok: true, propuesta, promptVersion, modeloLlm, uso}`. El servidor vuelve a
validar la propuesta con `contenidoHiloSchema`; resolver el trabajo y guardar
la propuesta son una sola transacción, y repetir un resultado ya resuelto
responde 409.

### La lectura para la nota

La nota de cada sesión nueva lleva el Recorrido vigente como
`<contexto_previo>`. El worker lo lee con
`GET /api/pacientes/[id]/hilo?format=llm&sesionId=…`, autenticado con el ticket
de esa sesión en procesamiento (sólo esa paciente y esa organización):

```json
{"data":{"tipo":"hilo_vigente","pacienteId":"...","version":0,"contenido":null}}
```

`version: 0, contenido: null` es la única forma del hilo vacío. Con versión
positiva el contenido tiene que validar completo. `processor/app_client.py`
no sigue redirecciones, exige 200 y `application/json` y valida identidad,
envoltura, tipos, enums, fechas y límites. HTML, 404, JSON inválido o una
estructura distinta son errores (`contexto_no_disponible`, transitorio):
nunca se genera una nota sin historia porque falló la lectura.

### Endpoints de la pantalla

Respuestas `{ data }` / `{ error }`; lecturas con `Cache-Control: no-store`.
`/hilo` está fuera del proxy, así que sesión y origen propio los controla la
ruta (`src/app/api/_lib/hilo-http.ts`).

| Ruta | Contrato |
| --- | --- |
| `GET /api/pacientes/[id]/hilo` | Vigente, propuesta, desactualizadas, historial paginado, cantidad de aprobadas y trabajos pendientes/fallidos |
| `GET /api/pacientes/[id]/hilo/versiones?antes=N` | Hasta 30 metadatos de versiones y `hayMas` |
| `GET /api/pacientes/[id]/hilo/versiones/[version]` | Contenido y metadatos de una versión |
| `POST /api/pacientes/[id]/hilo/versiones` | `{ basadaEnVersion, contenido }`: inserta una versión profesional |
| `POST /api/pacientes/[id]/hilo/propuestas/[propuestaId]/aceptar` | `{ basadaEnVersion, contenido? }`; con contenido inserta la edición propia |
| `POST /api/pacientes/[id]/hilo/propuestas/[propuestaId]/rechazar` | `{ basadaEnVersion }` |
| `POST /api/pacientes/[id]/hilo/regenerar` | `{ basadaEnVersion, propuestaId }` o `{ basadaEnVersion, trabajoId }` para un fallo; devuelve `trabajoId` |
| `POST /api/pacientes/[id]/hilo/exportar` | Exporta el Recorrido y lo audita (POST para que un enlace o un prefetch no lo dispare) |
| `GET /api/pacientes/[id]/brief` | Última nota aprobada, sólo hilo vigente, próximo turno y avisos de nota/propuesta pendientes |

`basadaEnVersion` es **la vigente**, no el contador que también cuenta
propuestas. Una pantalla que guardó sobre otra versión recibe 409, conserva
su borrador y tiene que leer la vigente nueva antes de seguir.

## Consumo y diagnóstico: `uso`

Cada resultado de sesión (`nota` y `fallo`) y cada resultado de trabajo lleva
`uso` (`processor/uso.py`), con la forma de `usoSchema`
(`src/lib/sesion-clinica/schema.ts`). La app lo guarda tal cual en la columna
`uso` de la sesión o del trabajo, **sin cifrar**: sólo lleva números, códigos
e ids, nunca texto de la sesión. Ejemplo (una nota que se truncó en la primera
pasada):

```json
{
  "worker": "1a2b3c4",
  "asrSegundos": 3232,
  "pasosMs": {"descarga": 812, "normalizacion": 61234, "asr": 245000},
  "llamadas": [
    {"nombre": "nota#1", "entrada": 21000, "salida": 16384, "techo": 16384,
     "ms": 212000, "cacheLectura": 0, "cacheEscritura": 0, "razonamiento": 15900,
     "stop": "max_tokens", "requestId": "req_01", "error": "llm_truncado"},
    {"nombre": "nota#2", "entrada": 21000, "salida": 9000, "techo": 20480,
     "ms": 131000, "cacheLectura": 0, "cacheEscritura": 0, "razonamiento": 6500,
     "stop": "end_turn", "requestId": "req_02"}
  ],
  "reintentos": 1,
  "advertencias": ["intensidadEmocional=0 fuera de rango 1..10, anulado"]
}
```

- `worker`: la versión del worker (WORKER_VERSION en
  `processor/.env.example`), que por defecto son los 7 primeros caracteres
  del commit que desplegó Railway (RAILWAY_GIT_COMMIT_SHA, que Railway
  inyecta en los deploys disparados desde GitHub). Es también el
  `X-Worker-Version` de cada latido.
- `asrSegundos`: la duración que informó (y factura) AssemblyAI. No está
  cuando la corrida vino con checkpoint o el ASR falló.
- `pasosMs`: descarga, normalización y ASR en la sesión; en un trabajo, el
  nombre del tipo. Medido con `time.monotonic()`.
- `llamadas[]`: una por pedido a Anthropic, `nota#1`/`nota#2`,
  `feedback#1`/`feedback#2`, `contexto#1`/`contexto#2`. `entrada` y `salida`
  son tokens facturados; `razonamiento` es la parte de la salida que se fue en
  pensar. `error` aparece si esa pasada falló (un truncado o un timeout se
  pagan igual). Un timeout tiene `entrada` y `salida` en 0: no hay `usage`.
- `reintentos`: segundas pasadas por forma. `advertencias`: escalas fuera de
  rango que `schemas_llm` anuló.

Un fallo lleva el `uso` de lo que se alcanzó a hacer. Hoy cada resultado
**reemplaza** el `uso` de la sesión: el de un intento anterior se pierde.
Nada en la app lo lee todavía.

Tiempo de cada llamada: sin streaming la respuesta llega entera al final, así
que el timeout de cada pedido (LLM_TIMEOUT_SECONDS en
`processor/config.py`, 600 s) es el techo de la generación; alcanza para la
segunda pasada de 20.480 tokens a 35 tok/s. El SDK reintenta una vez
(429, 5xx, conexión, timeout). No hay `cache_control`: con este tráfico la
caché de prompt no se lee y cada escritura cobra 1,25×.

## Verificación y operación

Los tests de estados, transiciones, reclamos, checkpoint, resultado y trabajos
viven en `src/lib/__tests__/`; los del worker en `processor/tests/`.
Cubren contratos y persistencia, no captura real en un teléfono ni entrega
real de los proveedores. Operación y variables: `docs/operaciones.md`,
`.env.example` y `processor/.env.example`.
