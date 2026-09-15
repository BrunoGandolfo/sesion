# Pipeline clínico: implementación y límites de main

Base verificada: main e247d8b, 15 de septiembre de 2026. Hay código del
grabador anterior y un backend nuevo. El recorrido desde una grabación nueva
hasta la nota **todavía no está conectado de punta a punta**.

## Captura y subida pendientes

La pantalla `src/app/(dashboard)/grabar/[turnoId]/page.tsx` y el hook
`src/hooks/useGrabacionSesion.ts` siguen en el repositorio. El respaldo de
`src/lib/grabacion-storage.ts` conserva fragmentos sin cifrar mientras se
graba; `src/lib/grabacion-cifrado.ts` cifra el blob al terminar.

La creación actual es `POST /api/sesion-clinica`, con turnoId UUID y
consentimiento vigente; crea la sesión en grabando. La consulta por turno es
`GET /api/sesion-clinica`. La ruta
`src/app/api/sesion-clinica/route.ts` sigue como excepción pendiente de
migrar a casos de uso.

Los endpoints antiguos de URL de subida y confirmación fueron eliminados.
Los consumidores existentes siguen llamándolos y no son una implementación
vigente de subida. Tampoco hay una operación HTTP genérica para cambiar el
estado de la sesión. El contrato nuevo de audio exige segmentos, pero todavía
falta reconstruir su captura/subida. No simular éxito ni recomendar esos
endpoints como procedimiento de operación.

El esquema guarda una clave por sesión y un IV por segmento. Las keys de R2 se
calculan como organización/sesión/índice, sin persistir una key enviada por el
cliente: `src/lib/sesion-clinica/estados.ts`. Que el esquema lo prevea no
demuestra que la captura lo cumpla. El consentimiento 2.0 sí lo promete:
diferencia pendiente en `src/lib/consentimiento-hechos.ts`.

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

- audio: clave descifrada y segmentos ordenados con índice, key, IV y bytes;
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

`processor/worker.py` ejecuta `processor/processor.py`. Descarga R2 y
descifra en memoria. El código actual une los bytes descifrados en orden
con join: no realiza una unión de contenedores multimedia ni recorta solapes.
La viabilidad de ese pegado con segmentos independientes sigue pendiente de
integración; este documento no la da por resuelta.

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
borrar_transcript_asr y generar_feedback.

## Revisión, aprobación y limpieza

`src/app/api/_lib/casos-uso/sesion/aprobar.ts` exige confirmar un riesgo
moderado/alto o las menciones léxicas que correspondan. Dentro de una
transacción guarda la nota final, anula audioClave, pasa a aprobada y crea
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

## Recorrido pendiente

Aprobar encola integrar_contexto, pero `processor/processor.py` todavía no
lo ejecuta. La lectura longitudinal de `processor/app_client.py` sigue
apuntando a una ruta anterior ausente y tolera el 404 sin contexto.
`processor/contexto_worker.py` conserva código previo; no constituye la
implementación nueva. No está garantizada la actualización del hilo ni su
inyección en la nota. Ver `docs/pendientes/cierre-ola-1.md`.

## Verificación y operación

Los tests de estados, transiciones, reclamos, checkpoint, resultado y trabajos
viven en `src/lib/__tests__/`; los del worker en `processor/tests/`.
Cubren contratos y persistencia, no captura real en un teléfono ni entrega
real de los proveedores. Operación y variables: `docs/operaciones.md`,
`.env.example` y `processor/.env.example`.
