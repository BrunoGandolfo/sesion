# Forense 2 — Panel 2: rutas de API

**Fecha:** 2026-09-28 · **Repo:** `~/proyectos/sesion-arreglos`, `main` en `8f2047b` (solo lectura, sin suite, nada instalado).
**Zona:** `src/app/api/**/route.ts` (66 archivos, 3083 líneas). `_lib/**` es del panel 1: acá solo se cita cuando una propuesta de rutas cae ahí.
**Método:** leí las 66 rutas enteras; los clientes con `grep -rF` del path en `src/`, `processor/`, `vercel.json` y `.github/` (fuera de `src/app/api` y de `__tests__`); los tests con `grep` de imports de cada `route` y de cada caso de uso en `__tests__`. Todos los números de línea son del commit de arriba.

Leyenda de la columna **Test**: `ruta` = algún test importa y ejecuta la ruta · `MT` = solo la barre `multi-tenant.test.ts` (propia ≠ 404, ajena = 404) · `CU` = sin test de ruta, pero el caso de uso tiene test · `no` = nada.
Auth: `S` = `getSessionActor`/`getOrganizationId` · `S?` = `buscarActor` (no lanza) · `C` = `requireCron` · `M` = `requireM2M` · `T` = ticket del worker · `H` = `autorizarEdicionHilo` (origen + sesión) · `F` = firma de Twilio · `—` = pública.

---

## (a) Inventario

| # | Método | Path `/api/…` | Caso de uso / delega en | Auth | maxD | Líneas | Test |
|---|---|---|---|---|---|---|---|
| 1 | POST | `ayuda` | `responderAyudaStreaming`, `reservarCupo`/`devolverCupo`, `consultarAgenda` + auditoría y stream en la ruta | S | 60 | 138 | ruta (`ayuda-stream`, `panel-ayuda`) |
| 2 | GET, PATCH | `config` | `obtenerConfiguracion`, `actualizarConfiguracion` | S | 30 | 46 | ruta (`config-contrato`) |
| 3 | GET | `cron/mantenimiento` | `mantenimiento` | C | 60 | 38 | CU |
| 4 | GET | `cron/recordatorios` | `despacharEnvios`, `textoDeCobro` | C | 60 | 60 | CU |
| 5 | GET | `cron/salud` | `revisarSalud` | C | 60 | 56 | ruta (`salud-trabajos`) |
| 6 | GET | `cron/trabajos` | `correrTrabajosApp`, `ejecutarBorradoR2` (+ `conTimeout` en la ruta) | C | 60 | 66 | CU (+ estático `rutas-area2`) |
| 7 | POST | `csp-report` | `@/lib/csp-reportes` | — | 15 | 76 | CU |
| 8 | POST | `cuenta/entrar` | `iniciarSesion` | — | 30 | 51 | ruta (`login-atomico`) |
| 9 | GET, POST | `cuenta/invitaciones` | `consultarInvitaciones`, `crearInvitacion` (+ auditoría en la ruta) | S | 30 | 55 | ruta (`registro-atomico`) |
| 10 | POST | `cuenta/limpiar` | — (`buscarActor` + cookie) | S? | 15 | 28 | ruta (`password-atomico`) |
| 11 | POST | `cuenta/password` | **ninguno**: `procesarCambioPassword` + `db.$transaction` + CAS en la ruta | S | 30 | 105 | ruta (`password-atomico`) |
| 12 | POST | `cuenta/recuperar` | `solicitarRecuperacion` (en `after()`) | — | 30 | 37 | ruta (`recuperar-ruta`) |
| 13 | POST | `cuenta/registro` | `registrarCuenta` | — | 30 | 49 | ruta (`registro-atomico`) |
| 14 | POST | `cuenta/restablecer` | `restablecerCuenta` (+ auditoría en la ruta) | — | 30 | 37 | ruta (`recuperacion-atomica`) |
| 15 | POST | `cuenta/salir-todas` | `cerrarTodas` (lib) + auditoría en la ruta | S | 15 | 35 | ruta (`password-atomico`) |
| 16 | POST | `cuenta/salir` | `cerrarSesion` (lib) | S? | 15 | 28 | ruta (`password-atomico`) |
| 17 | GET | `cuenta/sesiones` | `listarSesionesVivas` (lib) | S | 15 | 32 | ruta (`password-atomico`) — **sin cliente** |
| 18 | GET | `dashboard` | `obtenerDashboard` | S | 15 | 26 | ruta (`pendientes-terapeuta`) |
| 19 | GET | `deudores` | `buscarTurnosConDeuda`, `calcularDeudores` (domain), `ultimoAvisoPorPaciente` + **mapeo y orden en la ruta** | S | 15 | 62 | CU |
| 20 | GET | `estado-worker` | `leerEstadoWorker` | — | 15 | 40 | no |
| 21 | GET | `finanzas/resumen` | `resumenFinanzas`, `parsearMes` | S | 30 | 60 | ruta (`finanzas`) |
| 22 | GET | `health` | `verificarBase`, `validarEnvOperacion` | — | 15 | 58 | no (solo existencia en `documentacion-vigente`) |
| 23 | PATCH, DELETE | `hot-words/[id]` | `actualizarHotWord`, `borrarHotWord` | S | 30 | 51 | MT |
| 24 | GET, POST | `hot-words` | `listarHotWords`, `crearHotWord(s)` | S | 30 | 83 | **no** (ni el caso de uso) |
| 25 | GET | `pacientes/[id]/brief` | `leerBrief` | S | 15 | 15 | MT + CU |
| 26 | GET, POST, DELETE | `pacientes/[id]/consentimiento` | `obtener/firmar/revocarConsentimiento` | S | 30 | 109 | ruta (`consentimiento`) |
| 27 | GET | `pacientes/[id]/documentacion` | **ninguno**: `count`+`findMany`+mapeo+`auditar` en la ruta | S | 15 | 173 | ruta (`historial-filtros`, `auditoria-transaccional`) |
| 28 | POST | `pacientes/[id]/hilo/exportar` | `exportarRecorrido` | H | 15 | 19 | ruta (`hilo-rutas`) |
| 29 | POST | `pacientes/[id]/hilo/propuestas/[propuestaId]/aceptar` | `aceptarPropuesta` | H | 15 | 18 | MT + CU |
| 30 | POST | `…/propuestas/[propuestaId]/rechazar` | `rechazarPropuesta` | H | 15 | 18 | MT + CU |
| 31 | POST | `pacientes/[id]/hilo/regenerar` | `regenerarHilo` | H | 15 | 16 | MT + CU |
| 32 | GET | `pacientes/[id]/hilo` | `leerRecorrido` / `leerHiloParaWorker` (`?format=llm`) | S / T | 15 | 26 | ruta (`hilo-rutas`) |
| 33 | GET | `pacientes/[id]/hilo/versiones/[version]` | `leerVersion` | S | 15 | 18 | MT |
| 34 | GET, POST | `pacientes/[id]/hilo/versiones` | `historialHilo`, `editarHilo` | S / H | 15 | 32 | ruta (`hilo-rutas`, `consentimiento`) |
| 35 | GET | `pacientes/[id]/progreso` | `leerProgreso`, `parseRangoProgreso` | S | 15 | 18 | MT + CU |
| 36 | POST | `pacientes/[id]/recordar-cobro` | `recordarCobro` | S | 30 | 38 | MT + CU |
| 37 | GET, PATCH | `pacientes/[id]` | `obtenerPaciente`, `actualizarPaciente` | S | 30 | 55 | ruta (`consentimiento`) + MT |
| 38 | GET, POST | `pacientes` | `listarPacientes`, `crearPaciente` | S | 30 | 71 | CU parcial (`crearPaciente`) |
| 39 | POST | `sesion-clinica/[id]/abandonar` | `descartarSesion` (llama a R2 `existe`) | S | 15 | 37 | ruta (`grabacion-sin-terminar`) |
| 40 | POST | `sesion-clinica/[id]/aprobar` | `aprobarSesion` | S | 30 | 44 | ruta (`rutas-area2`) + MT |
| 41 | POST | `sesion-clinica/[id]/asr` | `registrarAsr` | T | 15 | 33 | CU (`worker-escrituras`) |
| 42 | POST | `sesion-clinica/[id]/eliminar` | `eliminarSesion` | S | 15 | 27 | MT + CU |
| 43 | POST | `sesion-clinica/[id]/feedback/reintentar` | `reintentarFeedback` | S | 15 | 28 | MT + CU |
| 44 | POST | `sesion-clinica/[id]/lease` | `renovarLease` | T | 15 | 33 | CU |
| 45 | POST | `sesion-clinica/[id]/reintentar` | `reintentarSesion` | S | 15 | 28 | MT + CU |
| 46 | POST | `sesion-clinica/[id]/reprocesar` | `reprocesarSesion` | S | 15 | 28 | MT + CU |
| 47 | POST | `sesion-clinica/[id]/resultado` | `aplicarResultadoSesion` | T | 15 | 37 | CU |
| 48 | GET | `sesion-clinica/[id]` | `leerSesion` + auditoría `sesion.ver` en la ruta | S | 15 | 42 | ruta (`avisos-notas-integracion`, `consentimiento`) + MT |
| 49 | GET, POST | `sesion-clinica/[id]/transcripcion` | `verTranscripcion` (S) / `registrarTranscripcion` (T) | S / T | 15 | 57 | ruta (`consentimiento`) + MT(GET) |
| 50 | POST | `sesion-clinica/[id]/upload-confirmar` | `confirmarSubida` + auditoría en la ruta | S | 30 | 51 | ruta (`grabacion-diagnostico-integracion`) + MT |
| 51 | POST | `sesion-clinica/[id]/upload-url` | `pedirUrlSubida` + auditoría en la ruta | S | 30 | 54 | ruta (ídem) + MT |
| 52 | POST | `sesion-clinica/[id]/volver-a-grabar` | `volverAGrabar` + auditoría en la ruta | S | 15 | 39 | MT (caso de uso sin test) |
| 53 | GET | `sesion-clinica/avisos` | `avisosNotas` | S | 15 | 25 | ruta (`avisos-notas-integracion`) |
| 54 | GET | `sesion-clinica/pendientes` | `reclamarSesiones`, `terminosAsr` | M | 60 | 37 | CU |
| 55 | GET, POST | `sesion-clinica` | `leerSesionPorTurno`, `prepararAudio` + auditoría en la ruta | S | 30 | 26 | ruta (`grabar-el-dia`, `limites-prueba-integracion`) |
| 56 | POST | `sms/callback` | `aplicarCallbackTwilio` | F | 15 | 57 | ruta (`sms-callback`) |
| 57 | POST | `sms/entrante` | `esPedidoDeBaja`, `registrarBajaPorRespuesta` | F | 15 | 56 | ruta (`sms-callback`) |
| 58 | GET | `sms/envios` | `enviosDelTurno` | S | 15 | 31 | CU (`envios-del-turno`) |
| 59 | POST | `trabajos/[id]/resultado` | `aplicarResultadoTrabajo` | T | 15 | 32 | CU |
| 60 | GET | `trabajos/pendientes` | `entregarTrabajos` | M | 30 | 54 | CU |
| 61 | POST | `turnos/[id]/cancelar-serie` | `cancelarRestoDeSerie` | S | 30 | 32 | MT + CU |
| 62 | POST, DELETE | `turnos/[id]/cobrar` | `cobrarTurno`, `descobrarTurno` | S | 30 | 66 | MT + CU |
| 63 | PATCH | `turnos/[id]` | `actualizarTurno` | S | 30 | 51 | ruta (`solapamiento-turnos`) + MT |
| 64 | GET | `turnos/cobros` | `cobrosDelMes` | S | 15 | 38 | ruta (`cobros-mes`) |
| 65 | GET, POST | `turnos` | `listarTurnos`, `crearTurno` | S | 30 | 85 | ruta (`pendientes-terapeuta`, `solapamiento-turnos`) |
| 66 | GET | `version` | `VERSION_APP` | — | 15 | 12 | ruta (`version-app`) |

Todas declaran `runtime = "nodejs"` y `dynamic = "force-dynamic"` salvo `version` (sin `runtime`; no usa Node, está bien).

---

## (b) Hallazgos

Cada uno: dónde, qué pasa, riesgo, propuesta mínima, esfuerzo (S ≤ 1 h · M ≤ medio día · L más).

### H1. `documentacion` sigue haciendo la consulta en la ruta, bajo una excepción que ya no tiene dueño
- `src/app/api/pacientes/[id]/documentacion/route.ts:84-113` (`db.sesionClinica.count` + `findMany`), `:118-135` (mapeo), `:144-161` (`auditar`). La ruta tiene 173 líneas.
- `src/lib/__tests__/rutas-sin-prisma.test.ts:33` la exceptúa con dueño "Ola 2 (sesión clínica)". Esa ola terminó (el resto de `sesion-clinica/**` ya delega).
- **Riesgo:** es la única lectura de notas clínicas en lote. Tiene la regla de exportación (auditoría estricta antes de responder) escrita en una ruta que ningún guardián vigila. Cualquier cambio de estados, de cifrado o de auditoría hay que acordarse de hacerlo acá también.
- **Propuesta:** mover `:67-169` a `_lib/casos-uso/sesion/documentacion.ts` (`historialDocumentacion({prisma, organizationId, userId, pacienteId, filtros})`). La ruta queda en validar la query, llamar y `ok(...)`. Sacarla de `EXCEPCIONES_TEMPORALES`. `historial-filtros` y `auditoria-transaccional` ya la cubren. **M.** VERIFICADO.

### H2. `cuenta/password` hace la transacción en la ruta, bajo una excepción del área 3 ya cerrada
- `src/app/api/cuenta/password/route.ts:49-85`: `procesarCambioPassword`, `validarPasswordNueva`, `bcrypt.hash`, `db.$transaction` con locks, compare-and-set sobre el hash, invalidación de recuperaciones y `cerrarTodas`. Exceptuada en `rutas-sin-prisma.test.ts:30`.
- **Riesgo:** la regla de seguridad más fina de la cuenta (CAS contra un restablecimiento concurrente) vive en transporte. `restablecer` y `registro` ya delegan en `casos-uso/recuperar-cuenta.ts` y `registrar-cuenta.ts`: `password` es la única de las tres que no lo hace.
- **Propuesta:** `_lib/casos-uso/cambiar-password.ts` con la misma inyección que `restablecerCuenta` (`hashear`, `comparar`). La ruta mapea `estado` → `ApiError` y pone la cookie. Sacar la excepción; con eso la lista queda vacía, que es lo que el test pide. `password-atomico.test.ts` la cubre. **M.** VERIFICADO.

### H3. JSON malformado devuelve 500 "Error interno" (y un `console.error`) en 23 rutas
- `request.json()` sin `.catch` lanza `SyntaxError`. `errorResponse` (`_lib/responses.ts:29-42`) solo reconoce `ZodError` y `ApiError`, así que el resto termina en **500**.
- Sin catch: `ayuda:57`, `config:29`, `turnos:61`, `turnos/[id]:23`, `turnos/[id]/cobrar:25`, `pacientes:47`, `pacientes/[id]:35`, `hot-words:50`, `hot-words/[id]:20`, `sesion-clinica:21`, `sesion-clinica/[id]/aprobar:30`, `asr:19`, `lease:19`, `resultado:23`, `transcripcion:43`, `trabajos/[id]/resultado:19`, `hilo/versiones:29`, `hilo/regenerar:13`, `aceptar:15`, `rechazar:15`, `cuenta/password:43`, `cuenta/entrar:27`, `cuenta/restablecer:20`, `cuenta/registro:33` (estas dos últimas lo convierten en su 500 propio).
- Con 400: `consentimiento:31-37` (helper local `parseJsonBody`), `upload-url:31`, `upload-confirmar:24`, `turnos/[id]/cobrar:53` (DELETE) y `cuenta/recuperar:19` (`.catch(() => null)` y después zod).
- **Riesgo:** un error del cliente queda como error del servidor. Ensucia Sentry y el log, y el cliente recibe un mensaje falso. En las rutas del worker el contrato es "5xx → el lease decide" (`resultado/route.ts:2-3`), así que un cuerpo roto se reintenta cuando debería ser terminal.
- **Propuesta mínima (cae en `_lib`, coordinar con el panel 1):** en `errorResponse`, `if (error instanceof SyntaxError) return Response.json({ error: "JSON inválido" }, { status: 400 })`. Eso arregla las 23 sin tocarlas. Después se borra `parseJsonBody` de `consentimiento`. **S.** VERIFICADO por lectura; no lo ejecuté.

### H4. El barrido multi-tenant no mira las rutas que reciben el id por query o por body
- `src/lib/__tests__/multi-tenant.test.ts:27-31` dice "LAS RUTAS SIN ID NO SE BARREN. No reciben id de recurso". Para estas es falso:
  - `sesion-clinica` GET `?turnoId` (`route.ts:13`) y POST `{turnoId}` (`:21`);
  - `sms/envios` GET `?turnoId` (`route.ts:23`);
  - `hot-words` GET `?pacienteId` (`route.ts:27`) y POST `pacienteId` en cada ítem;
  - `turnos` GET `?pacienteId` (`route.ts:32`) y POST `pacienteId`;
  - `pacientes/[id]/hilo` GET `?format=llm&sesionId` (ticket).
- El código filtra bien. Lo verifiqué leyendo: `casos-uso/audio.ts:66,86` (`turnoId + organizationId`), `hot-words.ts:166,197` (`assertPacientesExisten` por org), y `crear-serie-turno.test.ts:291` prueba el paciente ajeno en `crearTurno`. **Lo que falta es el test:** no encontré prueba de org ajena para `leerSesionPorTurno`, `prepararAudio`, `listarHotWords`, `crearHotWord(s)` ni `listarTurnos` (`grep` de "ajena|otra org|orgB" en sus tests da 0).
- **Riesgo:** la próxima regresión en `sesion-clinica?turnoId` le devuelve a otra org la nota completa (`toSesionClinicaResponse` trae `notaIa`, `notaFinal`, `datos`: `_lib/sesion-clinica.ts:44-47`), y el guardián del aislamiento no la ve.
- **Propuesta:** en `multi-tenant.test.ts`, una tabla `IDS_EN_QUERY_O_BODY` (ruta, método, cómo se inyecta el id de la org dueña) que se barra con el mismo criterio propio ≠ 404 / ajena ∈ {404, lista vacía}. Corregir el comentario `:27-31`. **M.** VERIFICADO (el hueco del test); lo del código también, por lectura.

### H5. La auditoría de lectura clínica sigue dos criterios, y 10 rutas auditan desde la ruta
- `GET sesion-clinica/[id]` (`route.ts:25-35`) devuelve la nota entera y audita `sesion.ver` con `registrarAuditoria` (best-effort: si falla, la nota sale igual). `GET pacientes/[id]/documentacion` (`route.ts:137-161`) devuelve lo mismo en lote y usa `auditar` (estricta: sin rastro no hay datos). `verTranscripcion` audita best-effort dentro del caso de uso.
- Auditan en la **ruta**, después del acto y fuera de su transacción: `ayuda`, `sesion-clinica` (POST), `sesion-clinica/[id]` (GET), `upload-url`, `upload-confirmar`, `volver-a-grabar`, `cuenta/invitaciones`, `cuenta/password`, `cuenta/restablecer`, `cuenta/salir-todas`. El resto de las transiciones (`aprobar`, `eliminar`, `reintentar`, `hilo/*`, `consentimiento`) audita dentro del caso de uso.
- **Riesgo:** que se pueda leer una nota sin dejar rastro depende de por dónde se lea. Y con dos lugares posibles para la auditoría, una ruta nueva puede quedarse sin ninguna.
- **Propuesta:** (1) **decisión del dueño:** ¿`sesion.ver` es un acto legal (va `auditar`) o informativo? (2) Sea cual sea, mover el `registrarAuditoria` de esas 10 rutas a su caso de uso. Así la regla "la ruta no decide qué se audita" se sostiene sola. **M.** Los hechos, VERIFICADOS. Cuál de los dos criterios es el correcto lo decide el dueño.

### H6. `deudores` arma la lista y la ordena en la ruta, con un orden distinto al de Hoy y al de Cobros
- `src/app/api/deudores/route.ts:25-56`: busca, arma el mapa de teléfonos, agrupa, trae el último aviso, mapea y ordena por días de atraso y después por monto (`:52-56`). `calcularDeudores` (`_lib/domain.ts:~278`) ordena por monto; `orden-deuda.ts` lo usa Hoy; `cobros-view.tsx:231` ordena por monto sin desempate.
- El guardián no lo ve porque no hay `db.` en la ruta: la lógica de negocio pasa por funciones de `domain`.
- **Riesgo:** la misma lista con órdenes distintos según la pantalla. Es el hallazgo §2 de `01-app.md`, **sigue vivo**.
- **Propuesta:** `casos-uso/deudores.ts` `listarDeudores({prisma, organizationId, ahora})` que ordene con `orden-deuda.ts`, y la ruta queda en 10 líneas. El orden que valga lo elige el dueño; lo mínimo es que sea uno solo. **S.** VERIFICADO.

### H7. `maxDuration` no sigue la convención de `scripts/ci/max-duration.mjs:13-20`
El script comprueba que el valor exista, no que corresponda a la familia de la ruta (lo dice en `:22-24`). Las divergencias:
- **Habla con R2 y tiene 15 s:** `sesion-clinica/[id]/abandonar:14` (`descartarSesion` → `almacen.existe`, `casos-uso/sesion/abandonar.ts:114`). La convención dice 30. Es la única ruta de UI que toca R2 con 15.
- **Escrituras de UI con 15 s (la convención dice 30):** `eliminar:9`, `reintentar:10`, `reprocesar:10`, `feedback/reintentar:10`, `volver-a-grabar:14`, `hilo/exportar:8`, `hilo/regenerar:8`, `aceptar:9`, `rechazar:9`, `hilo/versiones:12` (POST), `cuenta/salir:13`, `cuenta/salir-todas:11`, `cuenta/limpiar:16`.
- **M2M del worker (la convención dice 60):** `asr`, `lease`, `resultado`, `transcripcion`, `trabajos/[id]/resultado` tienen 15; `trabajos/pendientes:15` tiene 30; `sesion-clinica/pendientes` tiene 60.
- **Lectura con 30:** `finanzas/resumen:26`, que es agregado pesado (justificable).
- **Riesgo:** real solo en `abandonar` (un HeadObject lento contra R2 corta la función a los 15 s). El resto son transacciones cortas, y 15 alcanza.
- **Propuesta:** `abandonar` a 30. Para el resto hay dos caminos: reescribir la tabla de la convención para que diga lo que el código hace (escrituras sin red externa: 15; M2M por ítem: 15; M2M por lote: 30-60), o subir los valores. Recomiendo reescribir la tabla. **S.** VERIFICADO.

### H8. `GET /api/cuenta/sesiones` no tiene cliente
- `src/app/api/cuenta/sesiones/route.ts` (32 líneas). Ningún `fetch`/`apiGet` en `src/`; solo lo llama `password-atomico.test.ts`. Config tiene "Salir de todas" (`config-view.tsx:785`) pero no lista las sesiones.
- **Propuesta:** decisión: cablear la lista en Config (era el propósito, "quién está entrada y desde dónde") o borrar la ruta y su parte del test. **S.** VERIFICADO (grep).

### H9. Parámetros que la ruta acepta y ningún cliente manda
- `pacientes/[id]/documentacion`: `desde`, `hasta`, `incluirFallidas` (`route.ts:44-46`). El único cliente, `sesiones-tab.tsx:137`, manda `page` y `limit`. Los filtros los usa solo `historial-filtros.test.ts`. Están en `docs/contrato-pendientes-historial-cobros.md` (commit `f254467`): es contrato sin pantalla. **Decidir** si se cablea o se borra.
- `cron/mantenimiento?recifrar=todo` (`route.ts:21`): manual y documentado. **CONSERVAR.**
- Los tests mandan cosas que las rutas ignoran: `multi-tenant.test.ts` manda `{desde}` a `turnos/[id]/cancelar-serie` (la ruta no lee body) y `fecha` a `turnos/[id]/cobrar` POST (`cobrarSchema` solo tiene `metodo`, y `z.object` descarta el resto). No rompe nada, pero sugiere un contrato que no existe. **BORRAR** esos campos del test.
- Los demás parámetros sí tienen emisor: `limite` y `tipos` (`processor/app_client.py:54,166`), `granularidad` (`finanzas/_components/periodo.ts:62`), `antes` (`HiloView.tsx:81`), `mes` (`sheet-periodo.tsx:120`), `includeCancelados` (`agenda-view.tsx:190`), `activo`/`q` (`pacientes-view.tsx:70-77`), `scope`/`pacienteId` (`HotWordsManager.tsx:121-123`).
- **S.** VERIFICADO.

### H10. Bloques repetidos que ya pasan el umbral de 3 usos idénticos
| Bloque | Usos | Dónde | Helper mínimo |
|---|---|---|---|
| `const r = ok(x); r.headers.set("Cache-Control", "no-store")` | 8 + los 7 de `responderHilo` | `cuenta/{entrar:46, invitaciones:25,50, limpiar:23, password:100, registro:42, salir:23, sesiones:27}`; `responderHilo` (`_lib/hilo-http.ts:14-18`) hace exactamente lo mismo | Renombrar `responderHilo` a `okSinCache` y moverlo a `responses.ts` (panel 1). `version` usa `no-store, max-age=0` y queda aparte |
| `if (!r2Configurado()) throw new ApiError("El almacenamiento de audio (R2) no está configurado en este entorno", 503)` | 3 idénticos | `abandonar:23-25`, `upload-url:34-36`, `upload-confirmar:27-29` | `exigirR2(): AlmacenAudio` en `_lib` (o en `@/lib/r2`), que devuelve `almacenAudio` |
| `type RouteParams = { params: Promise<{ id: string }> }` (o `Contexto`, o inline) | 32 archivos | todas las rutas `[id]` | Next 16 trae el tipo global `RouteContext<'/api/…/[id]'>` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:112`). Es mecánico. HIPÓTESIS: que `tsc` del CI vea los tipos generados por `next typegen` sin un paso extra |
| `registrarLatido({ prisma: db, ...identidadWorker(request), ahora: new Date(), tipo: "trabajo" })` después de un ticket + zod + caso de uso | 5 | `asr:28`, `lease:28`, `resultado:32`, `transcripcion:52`, `trabajos/[id]/resultado:27` | No lo propongo: es una línea, y un wrapper de ruta de worker escondería el orden (autorizar → validar → escribir → latido), que hoy se lee de un vistazo |
| `reintentar` / `reprocesar` / `feedback/reintentar` | 3 casi idénticos (28 líneas) | ídem | No lo propongo: la duplicación es el nombre de la transición, y cada archivo es trivial |
| Preámbulo de Twilio (token, `text()`, tope, `parametrosDeFormulario`, `firmaValida`) | 2 | `sms/callback:25-33`, `sms/entrante:33-41` | Bajo el umbral: no |

Los dos helpers que valen la pena (`okSinCache`, `exigirR2`): **S.** VERIFICADO (conteo con grep).

### H11. Tres crons y tres maneras de fallar
- `cron/recordatorios/route.ts:40-45`: **sin try/catch**. Si `despacharEnvios` lanza (base caída), Next contesta un 500 genérico y **no sale alerta**. `cron/salud:26-38` sí alerta en ese caso.
- `cron/mantenimiento:34-37`: `{error}` propio con 500 y log. `cron/trabajos:63-65`: `errorResponse`.
- **Riesgo:** los recordatorios de SMS dejan de salir y nadie se entera hasta el próximo cron de salud, si es que ese mide los pendientes. HIPÓTESIS: no verifiqué qué métrica de salud lo cubre.
- **Propuesta:** envolver `recordatorios` como `salud` (`alertar("critico", …)` + 503). Las otras formas son aceptables: solo las lee Vercel. **S.** VERIFICADO (el código).

### H12. Los 400 salen con dos formas según quién valida
- Zod (`validationError`): `{ error: "Datos inválidos", details: {...} }`. Validación a mano (`ApiError(…, 400)`): `{ error: "<texto>" }`.
- A mano: `sesion-clinica:14` (turnoId), `sms/envios:24-26` (turnoId), `finanzas/resumen:28-37` (granularidad), `trabajos/pendientes:25-35` (tipos), `hilo:18,22` (format/sesionId), `limiteReclamo`, `parseRangoProgreso`, `bordeMvd`, `parsearMes`.
- Mismo resultado, dos estilos: `safeParse` + `return validationError` (20 rutas) y `.parse()` dejando que `errorResponse` convierta el `ZodError` (9 rutas: `entrar`, `registro`, `restablecer`, `sesion-clinica` POST, 4 de `hilo`, `versiones?antes`).
- Detalle: `finanzas/resumen/route.ts:52-53` llama dos veces a `granularidadDe(query.get("granularidad"))`.
- **Propuesta:** no unificar a la fuerza. El cliente (`api-client`) lee `error`, que existe en las dos formas. Lo mínimo es arreglar la doble llamada de `finanzas`. Si se quiere un estilo, que sea `.parse()`: es más corto y `errorResponse` ya lo cubre. **S.** VERIFICADO.

### H13. El comentario de `sms/envios` dice que pasa por el proxy, y no pasa
- `src/app/api/sms/envios/route.ts:3-4`: "queda dentro del matcher del proxy: sólo /api/sms/callback y /api/sms/entrante son públicos". El matcher (`src/proxy.ts:97`) excluye `api/sms` entero, así que `envios` está **fuera** del proxy.
- **Riesgo:** bajo. Es GET, la ruta exige sesión (`getOrganizationId`) y no hay mutación que necesite el control de origen. Pero alguien que agregue un POST ahí va a creer que el proxy lo protege.
- **Propuesta:** corregir el comentario, o angostar el matcher a `api/sms/(?:callback|entrante)`. Lo segundo es zona proxy. **S.** VERIFICADO.

### H14. `ayuda` tiene cupo, auditoría y stream en la ruta (138 líneas)
- `src/app/api/ayuda/route.ts:64-125`: reserva y devuelve el cupo, arma el stream, limpia markdown y audita al cerrar.
- El stream es transporte y está bien que esté ahí. La política "cuándo se devuelve el cupo" (`:74,115`) y la auditoría no lo son.
- **Propuesta:** opcional. Que `responderAyudaStreaming` reciba `alTerminar` y `alFallarSinFragmentos` y la ruta quede en el `ReadableStream`. Tiene tests de ruta (`ayuda-stream`), así que se puede mover sin miedo. **M.** HIPÓTESIS sobre si vale el esfuerzo.

### H15. `cron/trabajos` define el adaptador de timeout de R2 en la ruta
- `src/app/api/cron/trabajos/route.ts:22-44` (`conTimeout`, `TIMEOUT_R2_MS`, el adaptador `r2`). Es infraestructura, no transporte: si mañana `abandonar` o `upload-confirmar` necesitan timeout contra R2 (H7), no lo tienen a mano.
- **Propuesta:** mover `conTimeout` y el adaptador a `@/lib/r2`. **S.** VERIFICADO.

### H16. Guardianes de forma que se pisan
- `rutas-area2.test.ts` exige `runtime`, `dynamic` y `maxDuration` solo en `sesion-clinica/**`, `trabajos/**` y `cron/trabajos`. `max-duration.mjs` exige `maxDuration` en todas. Nadie exige `runtime`/`dynamic` fuera del área 2 (hoy los tienen todas menos `version`, que no lo necesita).
- **Propuesta:** extender `rutas-area2` a todo `src/app/api` (con `version` exceptuada por nombre) y renombrarlo, o sumar `runtime`/`dynamic` a `max-duration.mjs` y borrar `rutas-area2`. **S.** VERIFICADO.

### H17. Rutas sin test de ruta y con el caso de uso sin cubrir
- `hot-words` GET/POST: `listarHotWords` y `crearHotWords` no aparecen en ningún test. `hot-words/[id]` solo en MT.
- `sesion-clinica/[id]/volver-a-grabar`: solo MT; `volverAGrabar` sin test. Es un paso del flujo de grabación.
- `pacientes/[id]/hilo/versiones/[version]`: solo MT; `leerVersion` sin test directo.
- `pacientes` GET: `listarPacientes` sin test.
- `estado-worker` y `health`: sin test de comportamiento (el `503` que ve el monitor no está probado).
- **Propuesta:** priorizar `volver-a-grabar` (flujo de grabar → subir, que ya estaba marcado "Parcial" en `01-app.md` §5.5) y `hot-words` POST masivo. **S-M.** VERIFICADO (grep de nombres de funciones en `__tests__`).

---

## (c) VERIFICADO vs HIPÓTESIS

| Hallazgo | Estado | Cómo |
|---|---|---|
| H1, H2 | VERIFICADO | Leí las rutas y la lista de excepciones |
| H3 | VERIFICADO por lectura | `errorResponse` no conoce `SyntaxError`; no mandé JSON roto |
| H4 | VERIFICADO | El comentario del test contra las rutas; filtros leídos en los casos de uso; grep de tests de org ajena |
| H5 | VERIFICADO (hechos) / decisión (criterio) | — |
| H6 | VERIFICADO | Mismo hallazgo que `01-app.md` §2, releído en el código actual |
| H7 | VERIFICADO | Riesgo real solo en `abandonar`, por el HeadObject. El timeout propio del cliente R2 no lo miré (HIPÓTESIS) |
| H8, H9 | VERIFICADO | grep de paths y parámetros en `src/`, `processor/`, `.github/`, `vercel.json` |
| H10 | VERIFICADO (conteos) | Lo de `RouteContext` en el CI es HIPÓTESIS |
| H11 | VERIFICADO (código) | HIPÓTESIS: si el cron de salud mide los SMS atascados |
| H12, H13, H15, H16, H17 | VERIFICADO | — |
| H14 | HIPÓTESIS | Sobre el valor del cambio |

No corrí ningún test ni el build.

---

## (d) Top 10

1. **H4** El barrido multi-tenant no mira los ids que llegan por query o body (`sesion-clinica?turnoId` devuelve la nota entera). El código filtra; falta el guardián. **M.**
2. **H1** `documentacion`: lectura de notas en lote y auditoría de exportación escritas en la ruta, con una excepción vencida. **M.**
3. **H5** La auditoría de lectura clínica tiene dos criterios (`sesion.ver` best-effort, exportación estricta) y 10 rutas auditan desde la ruta. Pide una decisión. **M.**
4. **H3** JSON malformado → 500 en 23 rutas. Un `if` en `errorResponse` lo arregla. **S.**
5. **H2** `cuenta/password`: transacción y CAS en la ruta; es la última excepción del guardián. **M.**
6. **H11** `cron/recordatorios` sin try/catch: si se cae la base, no sale ni alerta. **S.**
7. **H6** `deudores`: composición y orden en la ruta, con un orden distinto al de Hoy y Cobros (sigue vivo desde `01-app`). **S.**
8. **H7** `abandonar` habla con R2 con 15 s. Además, la tabla de la convención no describe lo que el código hace. **S.**
9. **H8 + H9** Ruta sin cliente (`cuenta/sesiones`) y filtros de `documentacion` que ninguna pantalla manda. Hay que decidir si se cablean o se borran. **S.**
10. **H10** Dos helpers que pasan el umbral: `okSinCache` (15 usos contando `responderHilo`) y `exigirR2` (3). **S.**

---

## (e) Cruce con `~/forense-sesion/01-app.md` (lo que toca rutas)

| `01-app.md` | Qué decía | Hoy |
|---|---|---|
| §Resumen y §2, fila "Orden de deudores" (`deudores/route.ts:52`) | Tres órdenes distintos | **VIVO**: `deudores/route.ts:52-56`, `cobros-view.tsx:231`, `domain.ts` por monto. Ver H6 |
| §3, fila `csp-report/route.ts:3,21` y `sms/envios/route.ts:3` ("middleware", "edge") | Comentarios con nombres viejos | **RESUELTO**: ahora dicen "proxy". Pero `sms/envios:3` afirma algo falso sobre el matcher (H13) |
| §3, fila `rutas-sin-prisma.test.ts:10` ("módulos de Node en el edge") | Comentario viejo | **RESUELTO**: ahora cita `proxy-liviano.test.ts` |
| §3, fila `_lib/tickets.ts:19-20` ("ninguna ruta del edge") | — | Es zona del panel 1; no lo miré |
| §5.2, fila `rutas-area2.test.ts:6` (lista a mano) | Reescribir recorriendo el disco | **RESUELTO**: recorre el disco. Queda el solapamiento con `max-duration.mjs` (H16) |
| §5.2, fila `limites-prueba-integracion.test.ts:47` (mira el texto de `route.ts`) | CABLEAR a la ruta real | **VIVO**: `:48-55` sigue con `readFileSync` + regex sobre `sesion-clinica/route.ts` |
| §5.2, fila `multi-tenant.test.ts` (CONSERVAR) | Recorre el disco | Sigue bien para `[id]`. Nuevo: no cubre ids en query o body (H4) y le manda cuerpos inútiles a dos rutas (H9) |
| §5.5, "Grabar → subir → confirmar: Parcial" | Nada encadena hook, ruta y caso de uso | **VIVO**: `upload-url` y `upload-confirmar` tienen test de ruta; `volver-a-grabar` no (H17) |
| §7, `cobros-view.tsx` pide todo `/api/dashboard` solo por los KPI | — | **VIVO**: `cobros-view.tsx:146`. Es zona cliente; lo anoto porque obliga a `dashboard` a servir de endpoint de KPI |
| §3, fila `useGrabacionSesion.ts:47-48` (ruta `[id]/clave`) | La ruta no existe | La ruta sigue sin existir: `ayuda-vigente.test.ts:148` lo exige. El comentario del hook es zona cliente |

Nuevo, fuera de mi zona pero pegado a las rutas: el matcher de `src/proxy.ts:97` sigue excluyendo `api/seed`, que ya no existe. Entrada muerta (y `:95` la documenta).

---

## (f) Mapa de archivos por propuesta

| Propuesta | Archivos que cambian | Archivo nuevo | Tests que tocan |
|---|---|---|---|
| H1 documentación a caso de uso | `src/app/api/pacientes/[id]/documentacion/route.ts` | `src/app/api/_lib/casos-uso/sesion/documentacion.ts` | `rutas-sin-prisma.test.ts:33` (sacar la excepción); `historial-filtros`, `auditoria-transaccional` sin cambios |
| H2 cambiar contraseña a caso de uso | `src/app/api/cuenta/password/route.ts` | `src/app/api/_lib/casos-uso/cambiar-password.ts` | `rutas-sin-prisma.test.ts:30`; `password-atomico` sin cambios |
| H3 JSON inválido → 400 | `src/app/api/_lib/responses.ts` (panel 1), `pacientes/[id]/consentimiento/route.ts:31-37` (borrar el helper local) | — | Un caso en un test de ruta cualquiera (p. ej. `config-contrato`) |
| H4 barrido de ids en query/body | — | — | `src/lib/__tests__/multi-tenant.test.ts` (tabla nueva + comentario `:27-31`) |
| H5 auditoría en los casos de uso | `ayuda`, `sesion-clinica`, `sesion-clinica/[id]`, `upload-url`, `upload-confirmar`, `volver-a-grabar`, `cuenta/{invitaciones,password,restablecer,salir-todas}` + sus casos de uso en `_lib/casos-uso/{audio,sesion/leer,registrar-cuenta,recuperar-cuenta}.ts` | — | `auditoria-transaccional` si `sesion.ver` pasa a estricta |
| H6 deudores | `src/app/api/deudores/route.ts` | `src/app/api/_lib/casos-uso/deudores.ts` | Nuevo, unitario del orden (o reusar el de `orden-deuda`) |
| H7 maxDuration | `sesion-clinica/[id]/abandonar/route.ts:14`; `scripts/ci/max-duration.mjs:13-20` (tabla) | — | — |
| H8 `cuenta/sesiones` | Borrar `src/app/api/cuenta/sesiones/route.ts`, o cablearla en `(dashboard)/config/_components/config-view.tsx` | — | `password-atomico.test.ts` |
| H9 parámetros sin emisor | `pacientes/[id]/documentacion/route.ts:44-46` (si se borran) o `sesiones-tab.tsx` (si se cablean) | — | `historial-filtros.test.ts`; `multi-tenant.test.ts` (`CUERPOS` de `cancelar-serie` y `cobrar`) |
| H10 `okSinCache` y `exigirR2` | `_lib/responses.ts`, `_lib/hilo-http.ts` (panel 1); 8 rutas de `cuenta/*`; 7 de `hilo/*` y `brief` (solo el import); `abandonar`, `upload-url`, `upload-confirmar` | — | — |
| H10 `RouteContext` | Las 32 rutas con `[id]` | — | — |
| H11 recordatorios | `src/app/api/cron/recordatorios/route.ts` | — | Nuevo, estilo `salud-trabajos` |
| H12 doble llamada | `src/app/api/finanzas/resumen/route.ts:52-53` | — | — |
| H13 comentario o matcher | `src/app/api/sms/envios/route.ts:3-4` (o `src/proxy.ts:97`, zona proxy) | — | `proxy-liviano` si se toca el matcher |
| H14 ayuda | `src/app/api/ayuda/route.ts`, `_lib/casos-uso/responder-ayuda.ts` | — | `ayuda-stream` |
| H15 timeout R2 | `src/app/api/cron/trabajos/route.ts:22-44`, `src/lib/r2.ts` | — | — |
| H16 guardián de forma | `src/lib/__tests__/rutas-area2.test.ts` o `scripts/ci/max-duration.mjs` | — | — |
| H17 tests que faltan | — | Tests de `volverAGrabar`, `crearHotWords`/`listarHotWords`, `listarPacientes`, `estado-worker` 503 | — |
