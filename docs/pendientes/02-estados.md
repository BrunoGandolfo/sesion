# Área 2 — Estados de la sesión clínica: pendientes, textos y contratos

Rama `f3-estados`, 14 de septiembre de 2026. Lo que este documento junta es lo
que el área NO cerró sola: textos de pantalla y ayuda para quien los integre,
costuras con las otras áreas (con la firma exacta), y lo que quedó obsoleto en
archivos que no eran de esta área.

## 1. Textos de pantalla (para quien integre la UI y `glosario.ts`)

La máquina de estados cambió de nombres y de acciones. Los textos vigentes
hablan de "Descartar" y de un estado "error" que ya no existen.

| Dónde | Texto propuesto |
|---|---|
| Botón en `revision` (antes "Descartar la nota") | **Volver a escribirla** — "La nota se manda de nuevo a escribir. No se borra nada: la nota actual queda a la vista hasta que llegue la nueva. No se vuelve a transcribir." |
| Mientras vuelve a escribirse (`procesando` con `generacion ≥ 1`) | "Se está escribiendo de nuevo. La versión anterior queda visible pero no se puede editar." |
| Botones en `fallida` | **Reintentar** — "Vuelve a intentar con lo que ya hay: si la transcripción está hecha, no se paga de nuevo." **Eliminar** — "Borra la grabación, la transcripción y todo lo generado. El turno queda libre para volver a grabar." |
| Estado `fallida` con `falloCodigo` | `intentos_agotados`: "Se intentó cinco veces seguidas y no salió." `grabacion_abandonada`: "La grabación quedó a medias." Otros códigos: "No se pudo procesar." + `falloDetalle` si existe. |
| "Para vos" (`feedbackEstado`) | `no_pedido`: "Todavía no se pidió." `pendiente`: "Se está generando…" `listo`: el reporte. `fallido`: "No se pudo generar." + `feedbackError`, con botón **Pedir de nuevo** (disponible también con la nota aprobada). |
| Enlace en `revision` y `aprobada` | **Ver transcripción** — "Cada lectura queda registrada." Llama a `GET /api/sesion-clinica/[id]/transcripcion`. |
| Casilla al aprobar (riesgo moderado/alto) | como hoy: "Revisé la señal de riesgo." (`confirmoRiesgo`) |
| Casilla nueva al aprobar (menciones léxicas sin riesgo graduado) | **Leí las menciones** — "La transcripción tiene frases a revisar y el modelo no graduó riesgo." (`confirmoMenciones`; el servidor responde 400 sin ella) |
| Aprobada | "Nota aprobada. El audio se borra en segundo plano." Sin botones de reproceso ni eliminación: `aprobada` es terminal. |
| `subiendo` vieja (más de 4 h) | "La subida no terminó." con enlace a `/grabar/[turnoId]` (Área 1 decide abandonar). |

Ayuda (`docs/ayuda/08` y `09`): reemplazar "descartar" por "volver a
escribirla" y "eliminar"; explicar que la transcripción se conserva cifrada y
se puede leer; que "Para vos" se pide de nuevo sin rehacer la nota; que el
audio se borra después de aprobar, con reintentos, y que la clave se destruye
en el momento de aprobar.

## 2. Contratos que este área expone

Firmas exactas en `src/app/api/_lib/casos-uso/sesion/transicion.ts`,
`.../trabajos/crear.ts` y `.../tickets.ts`. Resumen:

```ts
// Toda transición de estado (Área 1 incluida). count = 0 ⇒ ApiError 409.
transicionar({ prisma, operacion, sesionId, organizationId, intento?, condiciones?, data?, conflicto? }): Promise<void>
//   operacion: keyof OPERACIONES (src/lib/sesion-clinica/estados.ts)
//   intento: obligatorio si la operación es del worker

// Un trabajo durable, SIEMPRE dentro de la transacción que lo motiva.
crearTrabajo({ prisma, tipo, payload, organizationId, sesionId?, pacienteId?, proximoIntentoEn? }): Promise<{ id }>
//   payload por tipo (PayloadTrabajo): borrar_audio_r2 { prefijo, indices } ·
//   borrar_transcript_asr { transcriptId } · generar_feedback e
//   integrar_contexto { sesionId, pacienteId }

// Ticket del worker (credencial para escribir sobre UNA sesión o UN trabajo).
emitirTicket(): { ticket, ticketHash }
autorizarTicketSesion(request, prisma, sesionId): Promise<{ sesionId, organizationId, intento }>   // 401
autorizarTicketTrabajo(request, prisma, trabajoId): Promise<TrabajoAutorizado>                       // 401
```

Rutas (todas `runtime = "nodejs"`, `force-dynamic`, `maxDuration`):

| Ruta | Quién | Cuerpo | Responde |
|---|---|---|---|
| `POST /api/sesion-clinica/[id]/aprobar` | usuaria | `{ notaEditada?, notasEdicion?, confirmoRiesgo?, confirmoMenciones? }` | sesión · 400 casillas · 404 · 409 |
| `POST …/reprocesar`, `…/reintentar` | usuaria | `{}` | sesión · 404 · 409 |
| `POST …/eliminar` | usuaria | `{}` | `{ eliminada: true, audioPorBorrar }` · 404 · 409 |
| `POST …/feedback/reintentar` | usuaria | `{}` | sesión · 404 · 409 |
| `GET …/transcripcion` | usuaria | — | `{ transcripcion, hablanteTerapeuta: "S0" }` · 404 · 409 |
| `GET /api/sesion-clinica/pendientes` | worker (PROCESSING_SECRET) | — | `SesionReclamada[]` (reclamar.ts) |
| `POST …/lease` | worker (ticket) | `{ intento, paso? }` | `{ leaseVenceEn }` · 401 · 409 |
| `POST …/asr` | worker (ticket) | `{ intento, transcriptId }` | `{ trabajoId }` |
| `POST …/transcripcion` | worker (ticket) | `registrarTranscripcionSchema` | `{ registrada: true }` |
| `POST …/resultado` | worker (ticket) | `resultadoSesionSchema` | `{ estado }` |
| `GET /api/trabajos/pendientes?tipos=a,b` | worker (PROCESSING_SECRET) | — | `TrabajoEntregado[]` (entregar.ts) |
| `POST /api/trabajos/[id]/resultado` | worker (ticket) | `resultadoTrabajoSchema` | `EstadoResuelto` · 501 sin aplicador |
| `GET /api/cron/trabajos` | cron (CRON_SECRET) | — | resumen |

Los schemas Zod viven en `src/lib/sesion-clinica/schema.ts`.

## 3. Costuras con otras áreas

- **Área 1 (grabación y subida).** Sus operaciones (`crear`, `empezar_subida`,
  `volver_a_grabar`, `audio_listo`, `abandonar`, `abandonar_sin_audio`) ya
  están en la tabla de `estados.ts`; se ejecutan con `transicionar`.
  `audio_listo` tiene que dejar `intento = 0`, `fallosSeguidos = 0`,
  `proximoIntentoEn = now`, `audioEstado = en_r2`, la clave cifrada
  (`cifrarSesion(id, { audioClave })`) y los segmentos con su `iv`. La key de
  cada segmento es `keyAudio(org, sesion, indice)`; ningún payload la trae.
  Se borró `src/lib/sesion-clinica-utils.ts` (importado por `upload-url`,
  `upload-confirmar`, `SesionHuerfanaBanner`, `useSesionClinicaPolling`,
  `documentacion/route.ts`, `sesiones-sin-contexto.ts`): `esHuerfana`,
  `keyAudio`, `prefijoAudio` y `ESTADOS_EN_PIPELINE` están en `estados.ts`.
  `POST /api/sesion-clinica` (crear) sigue con el código viejo (estado
  `pendiente`, cuid): es de esta costura.
  Supuesto del worker: los segmentos son tramos consecutivos del mismo
  stream (`MediaRecorder` con `timeslice`), así que concatenarlos en orden da
  un archivo válido. Si el teléfono produce archivos independientes, hay que
  cambiar `descargar_y_descifrar` en `processor.py`.
- **Área 3 (cifrado y auth).** Fusionado: las escrituras usan
  `cifrarSesion(id, campos)` de `src/lib/prisma-encryption.ts` y las lecturas
  piden el campo lógico en el `select` (`notaIa`, `datos`, `feedback`,
  `notaFinal`, `notasEdicion`, `transcripcion`, `audioClave`). Los tests fijan
  `CLAVES_CIFRADO` y llaman `__resetLlaveroForTests` de `@/lib/llavero`.
  `tickets.ts` duplica `nuevoTicket`/`hashTicket`/`ticketDe` de `auth.ts`
  (síncrono con node:crypto; el de auth es Web Crypto y async): unificar
  cuando convenga, no cambia el hash. El proxy exime
  `api/sesion-clinica/[id]/{lease,asr,resultado,transcripcion}`,
  `api/trabajos/**` y `api/sesion-clinica/pendientes`; `rutas-area2.test.ts`
  lo verifica contra el matcher real y exige que ninguna ruta excluida
  acepte sesión de usuaria con método no seguro sin `esOrigenPropio` (hoy la
  única con sesión fuera del proxy es el GET de la transcripción).
  Se dejó `src/lib/sesion-clinica-utils.ts` como módulo de compatibilidad
  con SOLO `ensamblarNotaSOAP` (marcado deprecated) para que los hooks del
  grabador y sus tests unitarios sigan cargando; se borra con ellos.
- **Área 4 (hilo y worker).** `integrar_contexto` nace en la transacción de
  aprobar con `{ sesionId, pacienteId }` y `pacienteId` en la fila. Para
  entregarlo y aplicarlo hay dos ganchos sin tocar archivos del área 2:
  `ADJUNTOS.integrar_contexto: (prisma, trabajo) => Promise<unknown>` en
  `trabajos/entregar.ts` y `APLICADORES.integrar_contexto: (tx, trabajo,
  resultado, resolucion, ahora) => Promise<void>` en
  `trabajos/resultado-worker.ts`. Sin aplicador la app responde 501 y el
  trabajo queda `en_curso` hasta que venza el lease. El worker sólo pide
  `?tipos=borrar_transcript_asr,generar_feedback` (`TIPOS_TRABAJO` en
  `processor.py`): sumar `integrar_contexto` ahí. `contexto_worker.py` y
  `callback.py` quedaron sin importadores (y `app_client` ya no tiene
  `obtener_aprobadas_sin_contexto`, `actualizar_contexto` ni
  `enviar_callback`). `obtener_contexto_clinico_llm` sigue apuntando a
  `/api/pacientes/[id]/contexto-clinico?format=llm`: repuntar a `/hilo`.
  `asr_assemblyai.transcribir` no expone el id del transcript hasta que
  termina de esperar: para registrarlo ANTES de `_esperar` (H-11 completo)
  hay que llamar `app_client.registrar_asr(sesion_id, ticket, intento,
  transcript_id)` desde `_crear_transcript`; hoy se registra apenas
  `transcribir` devuelve. `uso` (tokens) no viaja: `clinical_analyzer` sólo lo
  loguea.
- **Área 5 (operación).** `vercel.json` necesita `{ "path":
  "/api/cron/trabajos", "schedule": "*/10 * * * *" }` (no se tocó).
  `metricasTrabajos(prisma, ahora)` en `trabajos/metricas.ts` devuelve
  `{ fallidos, atrasados }` para el cron de salud. `worker_estado` lo escribe
  `registrarLatido` con los headers `X-Worker-Id` / `X-Worker-Version` que
  manda `app_client.py`. `db-test.ts` sigue truncando tablas que ya no
  existen (`paciente_contexto_clinico`, `recordatorios`): los tests de esta
  área no lo usan (crean su organización y borran lo suyo) y aceptan una
  `DATABASE_URL_TEST` de localhost sin pasar por su guarda de Neon. Corrieron
  contra `docker run postgres:17` propio (`pg-sesion-f3-estados`) con
  `prisma migrate deploy`; en CI hace falta el mismo Postgres efímero.
- **Frontend.** Consumidores de lo que se borró: `PATCH /api/sesion-clinica/[id]`
  (`grabar-view.tsx:233`, `useGrabacionSesion.ts`, `sesion-detail-view.tsx:268`)
  y `DELETE …?accion=` (`sesion-detail-view.tsx:254`). La respuesta de sesión
  cambió de forma (`sesionClinicaResponseSchema`): `notaIa`, `notaFinal`,
  `datos`, `feedback`, `feedbackEstado`, `feedbackError`, `audioEstado`,
  `intento`, `generacion`, `falloCodigo`, `falloDetalle`,
  `transcripcionDisponible`, `creadaEn`, `actualizadaEn`.

## 4. Obsoleto en archivos que no son de esta área

- `src/lib/__tests__/multi-tenant.test.ts` bloques "PATCH /api/sesion-clinica/[id]"
  y "DELETE /api/sesion-clinica/[id]" (líneas 314-460): reemplazados por los
  casos de otra organización en `aprobar.test.ts`, `worker-escrituras.test.ts`
  y `feedback-trabajos.test.ts`.
- `src/lib/__tests__/sesion-clinica-response.test.ts`,
  `casos-uso-sesion.test.ts`, `casos-uso-worker.test.ts`,
  `sesion-clinica.test.ts`: borrados (fijaban el comportamiento viejo:
  `notaSoapOriginal`, borrado inline, token en `error`, lease por
  `updatedAt`).

## 5. Lo que no hice y por qué

- UI de estados (`sesion-detail-view`, `barra-acciones`, `para-vos-view`,
  `sesiones-tab`, `card-ahora`, `useSesionClinicaPolling`): fuera de la
  barrera (formularios/grabador) y los textos van en §1.
- `src/lib/r2.ts` con `NodeHttpHandler` y timeouts: obligaba a declarar una
  dependencia nueva; el cron de trabajos pone su propio presupuesto de 13 s
  por llamada con `Promise.race`.
- `salud.ts` (métrica de trabajos): el Área 5 lo reescribió como agregador;
  se le deja `metricasTrabajos`.
- `POST /api/sesion-clinica` (crear): Área 1.
