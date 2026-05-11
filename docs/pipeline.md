# Pipeline de audio — arquitectura y decisiones

Este documento describe el pipeline completo de procesamiento de audio clínico: desde que la profesional aprieta "grabar" en el navegador hasta que la nota SOAP queda persistida y cifrada en la DB. Incluye la decisión de motor de ASR (WhisperX), la infraestructura en Atlas, tiempos esperados y límites conocidos.

Pensado para un dev nuevo que necesita entender el flujo en 5 minutos antes de tocar `processor/` o el flujo de upload del navegador.

---

## 1. Vista general del pipeline

```
[Browser]                                       [App Next.js / Vercel]      [Atlas — GPU box]
                                                                            ┌─ WhisperX  (GPU 1, :8090)
MediaRecorder (WebM/Opus)  ──► cifrado AES-256-GCM ──► PUT R2 ──► DB ──► Worker Python ─┤
                                                                            └─ Ollama    (GPU 0, :11434)
                                                            ▲                       │
                                                            └── callback ◄──────────┘
```

**Pasos:**

1. **Captura** — `MediaRecorder` graba audio en `audio/webm;codecs=opus` directamente desde `getUserMedia`. La sesión se mantiene en memoria del browser hasta que la profesional la cierra.
2. **Cifrado en cliente** — el blob WebM se cifra con AES-256-GCM antes de salir del browser. La clave (random 256-bit) y el IV se generan por sesión. Ver `docs/operations/encryption.md` para el detalle del esquema; **importante**: la clave que cifra el audio en R2 es distinta de `NOTES_ENCRYPTION_KEY` (esa cifra los campos de DB).
3. **Upload a R2** — el ciphertext sube a Cloudflare R2 con un `audioR2Key` único. La app persiste en `SesionClinica` el `audioR2Key`, `claveCifrado` y `iv` para que el worker pueda descifrar después.
4. **Worker Python poll** — `processor/worker.py` hace polling cada 30s a `/api/sesion-clinica/pendientes`. La app devuelve las sesiones con estado `pendiente` junto con sus credenciales de descifrado.
5. **Descifrado** — el worker baja el blob de R2 y lo descifra a un `.wav` temporal en `AUDIO_TEMP_DIR` (default `/tmp/sesion-audio`).
6. **Hot words** — opcional: GET `/api/hot-words/paciente/:id`. **Actualmente no se usan** (WhisperX no soporta hot-words por endpoint; ver §5).
7. **Transcripción + diarización** — POST multipart al servicio WhisperX en Atlas (`ASR_URL`, default `http://100.71.155.25:8090/transcribe`). Devuelve JSON con `segments: [{speaker: "S0"|"S1", start, end, text}]`.
8. **Speech analytics** — `processor/speech_analytics.py` calcula ratios de habla por speaker, cantidad de silencios > 3s y duración total a partir de los segments.
9. **Nota SOAP** — `clinical_analyzer.py` formatea la transcripción con timestamps y la manda al LLM (Ollama `qwen3.6:27b` por defecto) con el prompt de SOAP.
10. **Callback** — POST a `/api/sesion-clinica/callback` con `{transcripcion, nota, datosEstructurados, modelo_asr, modelo_llm}`. La app cifra los campos sensibles vía la extensión de Prisma y persiste.
11. **Cleanup** — si el callback fue OK, el worker borra el audio de R2 y el `.wav` temporal. Si falla, el audio queda en R2 para reintentos.

---

## 2. Decisión: VibeVoice → WhisperX

### 2.1 Por qué se cambió

VibeVoice-ASR era la primera implementación y funcionaba para sesiones cortas. Dos problemas obligaron al cambio:

- **Límite duro de ~60 minutos por archivo**. El modelo cortaba o degradaba severamente en sesiones largas. Las sesiones de la práctica reales son frecuentemente de 50–60min, y aparecieron casos de 90min (sesiones de pareja, primeras consultas extendidas).
- **Parsing frágil del output**. VibeVoice devolvía la transcripción como string crudo embebido detrás de un marker `"assistant\n"` que había que parsear con `rfind`. Sensible a cambios del prompt o de la versión del modelo.

### 2.2 Opciones evaluadas

| Opción | Resultado |
| --- | --- |
| **WhisperX** (Whisper large-v3 + pyannote Community-1) | Elegido. |
| Canary-1B-v2 (NVIDIA NeMo) | Excelente WER pero corpus de entrenamiento sesgado al inglés/europeo; rioplatense sin validar. |
| Parakeet-TDT | Rápido pero soporte de español débil al momento de la evaluación. |
| Qwen3-ASR | Inmaduro; documentación escasa, sin diarización integrada estable. |
| Sortformer (diarización standalone) | Solo diarización — habría requerido pipeline a dos cabezas (ASR + diarización separadas) con sincronización manual de timestamps. |
| Híbrido Whisper + diarización ad-hoc | Más piezas móviles que WhisperX, sin ventaja medible. |

### 2.3 Por qué WhisperX

- **Corpus diverso en español**, incluyendo material rioplatense — WER aceptable en pruebas con audio real de 30 y 60 min.
- **Sin límite de duración** por archivo. WhisperX usa VAD + batched inference; lo único que crece es el tiempo de procesamiento.
- **Madurez del stack**: Whisper es referencia de la industria, pyannote es referencia de diarización open-source, y la integración WhisperX está estable hace tiempo.
- **VRAM mínima**: ~7–9 GB en una GPU, permite compartir el box con Ollama.
- **Output limpio**: JSON estructurado con `segments`, sin parsing de strings crudos.

---

## 3. Infraestructura Atlas

Box GPU dedicado, dos GPUs separadas para evitar contención de VRAM:

| Servicio | GPU | Puerto | Modelo | VRAM aprox |
| --- | --- | --- | --- | --- |
| WhisperX (FastAPI wrapper) | GPU 1 | 8090 | Whisper large-v3 + pyannote Community-1 | 7–9 GB |
| Ollama | GPU 0 | 11434 | `qwen3.6:27b` | ~17 GB |

**Endpoints:**

- `POST http://100.71.155.25:8090/transcribe` — multipart `file=<audio>`. Devuelve `{duration_seconds, language, segments}`.
- `GET  http://100.71.155.25:8090/health` — readiness probe (no se invoca aún desde el worker; ver §5).
- `POST http://100.71.155.25:11434/api/generate` — endpoint estándar Ollama.

El wrapper FastAPI de WhisperX normaliza los IDs de speaker antes de responder: `SPEAKER_00 → S0`, `SPEAKER_01 → S1`, etc. El `processor/transcriber.py` confía en esa normalización y no la repite.

---

## 4. Tiempos esperados

Medidos con audio real de sesión clínica en español rioplatense, GPU compartida sin otra carga:

| Duración audio | ASR (WhisperX) | SOAP (Ollama) | Total end-to-end |
| --- | --- | --- | --- |
| 30 min | ~1 min | ~1.5 min | ~2.5 min |
| 60 min | ~2 min | ~2 min | ~4 min |
| 90 min | ~3 min | ~2 min | ~5 min |

El timeout del cliente HTTP del worker está en **600s** (`ASR_TIMEOUT_SECONDS`). Cubre con margen sesiones de 90min; si aparece audio de 120min+ revisar este límite antes que cualquier otra cosa.

---

## 5. Límites conocidos

- **WER en rioplatense**. Los benchmarks públicos de Whisper large-v3 reportan WER bajo en español peninsular. El rioplatense (voseo, fonética, léxico clínico local: "psicofármaco", apellidos italianos/criollos, etc.) puede tener WER notoriamente más alto que esos benchmarks. El LLM downstream compensa errores de transcripción al armar la SOAP, pero no es una garantía: si una palabra crítica sale mal escrita, la nota puede arrastrar el error.
- **Hot-words no soportadas nativamente**. El endpoint POST no acepta vocabulario sesgo. El worker hace GET a `/api/hot-words/paciente/:id` pero **descarta** la respuesta con un warning. La mitigación actual es que el LLM, al generar la nota, interpreta y corrige términos clínicos por contexto. Mejora pendiente: extender el wrapper FastAPI para aceptar `initial_prompt` y pasarle hot-words como prompt sesgo de Whisper.
- **`S0 = Terapeuta` es heurística, no garantía**. `formatear_para_llm()` mapea `S0 → Terapeuta` y `S1+ → Paciente`. Pyannote asigna IDs por orden de aparición, no por rol. En la mayoría de las sesiones el terapeuta habla primero (saludo, encuadre), pero si la paciente arranca hablando antes que el terapeuta los roles quedan invertidos. No hay detección automática; mitigación futura: chequear quién habla más o usar embeddings de voz registrados por profesional.
- **Single-tenant en Atlas**. Si dos sesiones llegan al worker al mismo tiempo, se procesan en serie (el worker es single-threaded por diseño). El throughput máximo actual ronda 12 sesiones/hora asumiendo 50 min promedio.
- **Health check no se invoca**. `ASR_HEALTH_URL` está en config pero ningún componente lo consulta antes de procesar. Si WhisperX está caído, recién falla en el paso 7, después de descargar y descifrar el audio. Mejora barata pendiente.

---

## 6. Variables de entorno

### 6.1 Processor (`processor/.env`)

| Variable | Default | Notas |
| --- | --- | --- |
| `APP_BASE_URL` | `http://localhost:3001` | URL de la app Next.js (Vercel en prod). |
| `PROCESSING_SECRET` | — (requerida) | Bearer M2M para los endpoints `/api/sesion-clinica/*`. |
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | — | Credenciales R2. |
| `ASR_URL` | `http://100.71.155.25:8090/transcribe` | Endpoint WhisperX. |
| `ASR_HEALTH_URL` | `http://100.71.155.25:8090/health` | Reservado (ver §5). |
| `ASR_MODEL_ID` | `whisperx-large-v3` | Reportado en el callback como `modelo_asr`. |
| `ASR_TIMEOUT_SECONDS` | `600` | Timeout HTTP del POST a WhisperX. |
| `OLLAMA_BASE_URL` | `http://100.71.155.25:11434` | Endpoint Ollama. |
| `LLM_MODEL_ID` | `qwen3.6:27b` | Modelo SOAP. |
| `LLM_BACKEND` | `ollama` | `ollama` o `vllm`. |
| `POLL_INTERVAL_SECONDS` | `30` | Frecuencia de polling de pendientes. |
| `AUDIO_TEMP_DIR` | `/tmp/sesion-audio` | Directorio para los `.wav` desencriptados. Se vacía después de cada sesión. |

### 6.2 Atlas (server-side, fuera de este repo)

- WhisperX se levanta como servicio systemd con la GPU 1 pinneada vía `CUDA_VISIBLE_DEVICES=1` y el wrapper FastAPI escuchando en `0.0.0.0:8090`. Los pesos de Whisper large-v3 y pyannote Community-1 se cachean localmente; pyannote requiere `HF_TOKEN` con licencia aceptada para la community-1.
- Ollama se levanta con `CUDA_VISIBLE_DEVICES=0` y el modelo `qwen3.6:27b` precargado (`ollama pull qwen3.6:27b`).
- Acceso al box via Tailscale; la IP `100.71.155.25` es la IP Tailscale interna del nodo Atlas, no es ruteable desde Internet.

### 6.3 App Next.js (no listadas exhaustivamente aquí)

Las variables del lado app que tocan el pipeline son `NOTES_ENCRYPTION_KEY` (cifrado de campos clínicos en DB, ver `docs/operations/encryption.md`) y `PROCESSING_SECRET` (mismo valor que en el processor, para autenticar los endpoints M2M).

---

## 7. Archivos clave del repo

| Path | Rol |
| --- | --- |
| `processor/worker.py` | Loop de polling y modo manual. |
| `processor/processor.py` | Orquesta el pipeline end-to-end por sesión. |
| `processor/transcriber.py` | Cliente HTTP de WhisperX. |
| `processor/clinical_analyzer.py` | Cliente del LLM, armado del prompt SOAP. |
| `processor/speech_analytics.py` | Métricas de ratios y silencios desde los segments. |
| `processor/r2_client.py` | Descarga y borrado en R2. |
| `processor/crypto.py` | AES-256-GCM para el audio (no para los campos de DB). |
| `processor/callback.py` | POST al endpoint `/api/sesion-clinica/callback`. |
| `processor/config.py` | Configuración leída de env vars. |
| `processor/.env.example` | Plantilla de variables. |
