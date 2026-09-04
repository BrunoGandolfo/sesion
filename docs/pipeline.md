# Pipeline de una sesión — de la grabación al contexto longitudinal

Cómo viaja una sesión hoy, con los nombres reales de rutas, casos de uso y
módulos. Verificado contra el código el 2026-09-04. La versión anterior
(WhisperX + Ollama en Atlas) está en `docs/historico/pipeline-whisperx-atlas.md`.

## 1. Piezas

| Pieza | Dónde corre | Qué hace |
| --- | --- | --- |
| App Next.js 16 | Vercel | UI, API, cifrado en reposo, crons. |
| Postgres 17 | Neon | Base. Ramas `production` y `test`. |
| Audio cifrado | Cloudflare R2, bucket `sesion-audio` | Objetos `audio/{org}/{sesion}/{turno}.enc`. |
| Worker Python (`processor/`) | Railway (`python worker.py`) | Descarga, descifra, transcribe, genera nota y feedback, devuelve por callback. Integra el contexto longitudinal. |
| ASR | AssemblyAI | `universal-3-5-pro` con fallback `universal-2`, diarización con roles. |
| LLM | Anthropic | `claude-sonnet-5`, structured outputs. |

## 2. Estados de `SesionClinica`

`pendiente → grabando → subiendo → procesando → revision → aprobado`, más
`error`. La tabla de transiciones válidas es única y vive en
`src/lib/sesion-clinica-utils.ts` (`TRANSICIONES_PERMITIDAS`). El navegador
solo puede pedir por PATCH `pendiente→grabando`, `grabando→error`,
`subiendo→grabando` y `error→procesando` (`TRANSICIONES_CLIENTE`); el resto
lo hacen rutas con efectos propios.

## 3. Flujo paso a paso

### 3.1 Grabación en el navegador

- Pantalla: ficha del paciente, pestaña Historia (`historia-tab.tsx`) o el
  botón flotante de grabación (`paciente-detail-view.tsx`, hook
  `useGrabacionSesion`). Hace falta un turno de hoy y consentimiento vigente.
- `POST /api/sesion-clinica { turnoId }` crea la fila en `pendiente` (exige
  turno programado o realizado y consentimiento sin revocar). Después
  `PATCH /api/sesion-clinica/[id] { estado: "grabando" }`.
- `GrabadorSesion` graba con `MediaRecorder`. Los chunks se respaldan en
  IndexedDB (`src/lib/grabacion-storage.ts`) hasta que la subida confirma.

### 3.2 Cifrado en el cliente

- Al terminar, el navegador genera una clave AES-256-GCM y un IV por sesión y
  cifra el blob (`src/lib/crypto.ts`). El audio en claro nunca sale del
  dispositivo.
- Esta clave es distinta de `NOTES_ENCRYPTION_KEY` (que cifra columnas en la
  base, ver `docs/encryption.md`).

### 3.3 Subida directa a R2 (tres pasos, `subirAudioCifrado` en `useGrabacionSesion.ts`)

1. `POST /api/sesion-clinica/[id]/upload-url` con `claveCifrado`, `iv`,
   `tamanoBytes`, `mime`. La ruta guarda clave e IV en
   `datosEstructurados._audioCifradoTemporal` (cifrado en reposo por la
   extensión Prisma), emite una URL prefirmada PUT de R2 válida 60 minutos
   con `Content-Type` y `Content-Length` firmados, y pasa la sesión a
   `subiendo`. La key es determinística (`keyAudioEsperada`).
2. El navegador hace `PUT` directo a R2 (XHR con progreso). El audio no pasa
   por Vercel.
3. `POST /api/sesion-clinica/[id]/upload-confirmar { key, duracionAudioSeg }`.
   La ruta recalcula la key, verifica con `HeadObject` que el objeto existe y
   pasa a `procesando` con `intentos = 0`. Si el objeto no está, vuelve a
   `grabando` y responde 409.

Si fallan el PUT o la confirmación, el cliente vuelve la sesión a `grabando`
y repite desde el paso 1 con el mismo blob.

### 3.4 Entrega al worker con lease

- El worker hace `GET /api/sesion-clinica/pendientes` cada
  `POLL_INTERVAL_SECONDS` (30 s) con `Authorization: Bearer PROCESSING_SECRET`
  (`requireM2M`).
- Caso de uso `reclamarPendientes` (`src/app/api/_lib/casos-uso/reclamar-pendientes.ts`):
  toma hasta 5 sesiones en `procesando` con `intentos = 0` o `updatedAt`
  anterior a `LEASE_MINUTES` (45). Cada entrega incrementa `intentos` con un
  `updateMany` condicionado (claim atómico). Al superar
  `MAX_INTENTOS_PROCESAMIENTO` (3) la sesión pasa a `error`.
- Payload por sesión: `sesionClinicaId`, `turnoId`, `audioR2Key`,
  `duracionAudioSeg`, `pacienteId`, `claveCifrado`, `iv`, `createdAt`,
  `orientacionTeorica` (de `Configuracion`, default `cbt_mi`), `intento`.

### 3.5 Worker: descarga, descifrado, ASR (`processor/processor.py`)

1. `r2_client.descargar_audio` baja el objeto.
2. `crypto.descifrar` lo descifra en memoria (AES-256-GCM, tag de 16 bytes al
   final). Nada se escribe a disco.
3. `asr_assemblyai.transcribir` (`processor/asr_assemblyai.py`, REST sin SDK):
   - `POST /v2/upload` con el audio crudo.
   - `POST /v2/transcript` con `speech_models: [ASR_MODEL_ID, ASR_MODEL_FALLBACK]`
     (`universal-3-5-pro`, `universal-2`), `language_code: "es"`,
     `speaker_labels: true`, `speaker_options` min=max=2, identificación de
     hablantes por rol (`Terapeuta` / `Paciente`) y `prompt` de escenario
     (`ASR_PROMPT_ESCENARIO`).
   - Polling cada `ASR_POLL_SECONDS` (10 s) hasta `ASR_TIMEOUT_SECONDS` (1800 s).
   - `DELETE /v2/transcript/{id}` siempre, en `finally`: el transcript y el
     archivo subido no quedan en AssemblyAI.
   - Normaliza a segmentos `S0` (terapeuta) / `S1` (paciente). Si AssemblyAI
     devolvió roles, `roles_origen = "asr_role"`; si no, `posicional` (el
     primer hablante se asume terapeuta). `speech_model` es el modelo que
     efectivamente procesó el audio y se reporta como `modeloASR`.
4. `speech_analytics.compute`: ratios de habla, silencios > 3 s, duración.

### 3.6 Worker: nota y feedback (`processor/clinical_analyzer.py`)

- Contexto longitudinal: `GET /api/pacientes/{id}/contexto-clinico?format=llm`
  (Bearer M2M) devuelve Markdown con hipótesis, objetivos, temas, riesgos y
  análisis + plan de las últimas 3 sesiones aprobadas. Best-effort.
- Llamada A (nota SOAP): prompt `prompts/clinical_note_v3.1.md`, schema
  `SCHEMA_NOTA`, modelo `LLM_MODEL_ID` (`claude-sonnet-5`), `max_tokens`
  8192, `effort` `medium`, timeout 300 s, 3 reintentos del SDK. Cabecera
  `anthropic-workspace-id` si `ANTHROPIC_WORKSPACE_ID` está seteada. Se validan
  rangos (`intensidadEmocional` 1..10, `duracionRealMin` >= 0).
- Llamada C (feedback de auto-supervisión): prompt según `orientacionTeorica`
  (ver `docs/contrato-multi-orientacion.md`). Best-effort: si falla, la nota
  sale sin feedback.
- `datosEstructurados` se completa con `speechAnalytics` (incluye
  `rolesOrigen`), `feedbackTerapeuta` y `_pipeline` (prompts, modelos,
  `asrId`, `intento`, `workerVersion`).

### 3.7 Callback

- `POST /api/sesion-clinica/callback` (Bearer M2M) con `sesionClinicaId`,
  `estado` (`revision` | `error`), `transcripcion`, `nota`,
  `datosEstructurados`, `modeloASR`, `modeloLLM`, `promptVersion`, `error`.
  La ruta valida con `notaSoapSchema` y `datosEstructuradosSchema`
  (`src/lib/sesion-clinica/schema.ts`, única definición del contrato).
- Caso de uso `procesarCallback`: escribe solo si la sesión sigue en
  `procesando` (409 si no). Guarda `notaSoapOriginal` una sola vez (la primera
  nota que llega), re-adjunta `_audioCifradoTemporal` desde la fila previa,
  fija `hablanteTerapeuta = "S0"`. Un callback de error incrementa `intentos`.
- Semántica para el worker (`processor/callback.py`): 2xx ok; 409 y otros
  4xx terminan el ciclo sin reintento; 5xx o sin respuesta dejan que el lease
  reintente.

### 3.8 Revisión

- La nota queda en `revision`. La UI (`NotaClinicaView`) muestra la nota,
  los flags de riesgo, la señal graduada `riesgoDetectado`
  (`docs/contrato-riesgo-clinico.md`) y el feedback. La terapeuta puede
  editar el texto.
- Descartar: `DELETE /api/sesion-clinica/[id]` → caso de uso `eliminarSesion`,
  rama `descartarNotaEnRevision`: borra nota y datos generados, conserva
  transcripción, audio y clave temporal, deja la sesión en `error`
  (reprocesable).
- Reintentar: `PATCH { estado: "procesando" }` → caso de uso
  `reintentarSesion`: exige audio en R2, limpia `error`, `intentos = 0`.

### 3.9 Aprobación

- `POST /api/sesion-clinica/[id]/aprobar` → caso de uso `aprobarSesion`
  (`src/app/api/_lib/casos-uso/aprobar-sesion.ts`):
  1. Solo desde `revision`.
  2. Si `riesgoDetectado.nivel` es `alto` o `moderado`, exige
     `confirmoRiesgo: true`.
  3. Borra el audio de R2 (`borrarAudioBestEffort`). Si el borrado funciona,
     `audioR2Key = null` y `audioBorradoEn = ahora`. Si falla, la key se
     conserva para reintentar el borrado.
  4. Elimina `_audioCifradoTemporal` de `datosEstructurados` **siempre**: sin
     la clave, un blob remanente es inaccesible (crypto-shredding).
  5. Guarda la nota editada y `notasEdicion`, pasa a `aprobado`, audita con
     el hash de la nota final (sin texto clínico).
- Después de aprobar, la transcripción y la nota siguen en la base, cifradas.

### 3.10 Contexto longitudinal (Golden Thread, Llamada B)

- En cada ciclo del worker, `processor/contexto_worker.py` hace
  `GET /api/sesion-clinica/aprobadas-sin-contexto` (Bearer M2M). Caso de uso
  `sesionesSinContexto`: sesiones aprobadas desde `CONTEXTO_DESDE` (si falta,
  desde hoy), máximo 5, una por paciente, que el contexto todavía no integró
  (`ultimaSesionId`).
- Prompt `prompts/update_context_v2.0.md`, schema `SCHEMA_CONTEXTO`. El
  resultado va por `PATCH /api/pacientes/{id}/contexto-clinico`. Como el
  caller es M2M, la fila queda con `aprobadoPorTerapeutaEn = null`: es una
  sugerencia hasta que la terapeuta la revisa en la pestaña Progreso.
- Backoff en memoria del worker: 5 min, 30 min, y al tercer fallo no
  reintenta hasta reiniciar el proceso.

## 4. Vigilancia

- `GET /api/cron/salud` (cada hora, `vercel.json`, Bearer `CRON_SECRET`):
  cuenta sesiones en `procesando` con más de 2 h sin cambios y recordatorios
  fallidos en 24 h; avisa por `ALERTA_WEBHOOK_URL` o `console.warn`.
- Sesión huérfana (`esSesionHuerfana`): en `error`, o en `grabando` más de 4 h
  sin cambios. La UI ofrece descartar o reintentar.

## 5. Variables que tocan el pipeline

App (Vercel): `PROCESSING_SECRET`, `NOTES_ENCRYPTION_KEY`, `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, opcionales
`LEASE_MINUTES`, `MAX_INTENTOS_PROCESAMIENTO`, `CONTEXTO_DESDE`.

Worker (Railway, ver `processor/.env.example`): `APP_BASE_URL`,
`PROCESSING_SECRET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`, `ASSEMBLYAI_API_KEY`, `ASR_MODEL_ID`, `ASR_MODEL_FALLBACK`,
`ASR_PROMPT_ESCENARIO`, `ASR_POLL_SECONDS`, `ASR_TIMEOUT_SECONDS`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `LLM_BACKEND`, `LLM_MODEL_ID`,
`LLM_EFFORT`, `LLM_MAX_TOKENS`, `LLM_TIMEOUT_SECONDS`, `POLL_INTERVAL_SECONDS`,
`WORKER_VERSION`.

## 6. Archivos clave

| Path | Rol |
| --- | --- |
| `src/hooks/useGrabacionSesion.ts` | Subida en tres pasos y estado de la sesión de hoy. |
| `src/app/api/sesion-clinica/**/route.ts` | Rutas: auth, validación, respuesta. |
| `src/app/api/_lib/casos-uso/*.ts` | Reglas: reclamar-pendientes, procesar-callback, aprobar-sesion, eliminar-sesion, reintentar-sesion, sesiones-sin-contexto. |
| `src/lib/sesion-clinica/schema.ts` | Contrato Zod de sesión y datos estructurados. |
| `src/lib/sesion-clinica-utils.ts` | Máquina de estados, key de audio, sesión huérfana. |
| `processor/worker.py` | Loop de polling y modo manual. |
| `processor/processor.py` | Orquestación por sesión. |
| `processor/asr_assemblyai.py` | Cliente AssemblyAI y normalización de hablantes. |
| `processor/clinical_analyzer.py` | Llamadas A, B y C a Anthropic. |
| `processor/contexto_worker.py` | Integración del contexto longitudinal. |
| `processor/prompts/*.md` | Prompts versionados. |
