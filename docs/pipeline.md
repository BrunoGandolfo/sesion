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
(`duracionAsrSeg`). Cuando difieren, esa diferencia es el dato.

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
`transcribir` manda los bytes al ASR desde memoria. No se escribe audio en disco y
no hace falta ffmpeg (la imagen `processor/Dockerfile` todavía lo instala; no
se usa).

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

Aprobar encola integrar_contexto. `processor/processor.py` lo ejecuta con la
versión vigente y la nota aprobada adjuntas al trabajo; el aplicador guarda
una propuesta cifrada sin cambiar la vigente. La profesional acepta, edita
o rechaza. Las escrituras insertan versiones y preservan las anteriores.
La lectura de `processor/app_client.py` exige un ticket de sesión, JSON
validado y ausencia de redirecciones. Una lectura fallida es un error, no
un contexto vacío. Contratos y verificación: `docs/pendientes/04-recorrido.md`.

## Verificación y operación

Los tests de estados, transiciones, reclamos, checkpoint, resultado y trabajos
viven en `src/lib/__tests__/`; los del worker en `processor/tests/`.
Cubren contratos y persistencia, no captura real en un teléfono ni entrega
real de los proveedores. Operación y variables: `docs/operaciones.md`,
`.env.example` y `processor/.env.example`.
