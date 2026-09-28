# Forense 2 — Panel 5: worker, tests e infraestructura

**Fecha:** 2026-09-28 · **Repo:** `~/proyectos/sesion-arreglos`, `main` en `8f2047b` (solo lectura: no se tocó ni se instaló nada en el repo).
**Zona:** `processor/**`, `pruebas/**`, `scripts/**`, `.github/workflows/**`, `prisma/**`, `package.json`, `vitest.config.ts`, `eslint.config.mjs`, `tsconfig.json`.
**Método:**
- Suite completa de vitest, corrida dos veces contra un Postgres 17 propio en Docker (`pg-sesion-forense-5`, puerto aleatorio en loopback, tmpfs). El contenedor **ya está borrado**.
- pytest completo del worker.
- Lectura con `grep -n`/`sed -n`, más scripts `ast` y de uso de campos, que quedaron en el scratchpad de la sesión.
- Tres subagentes de solo lectura (worker, esquema y dependencias, workflows y tests). Todo archivo:línea que sube a hallazgo principal lo **reverifiqué a mano** sobre este SHA.
- Nota: en esta máquina `grep` es ugrep, así que se usó `/usr/bin/grep`.

**Qué quedó fuera del repo:** los guiones de cobertura y los volcados crudos están en el scratchpad. Los únicos rastros que dejaron las corridas son los que ya ignora git: caché de vite dentro de `node_modules/` y ningún `.pyc` nuevo (`PYTHONDONTWRITEBYTECODE=1`, `-p no:cacheprovider`).

---

## (a) Inventario

| Pieza | Tamaño | Estado |
|---|---|---|
| Worker `processor/*.py` | 14 módulos, 3258 líneas | Vivo. Todos los módulos tienen llamador (ver 2.3 del anexo worker) |
| Tests del worker `processor/tests` | 18 archivos, 3590 líneas, **322 tests, 322 verdes, 0 skip**, 28 s | Dos de los archivos no prueban el worker: `test_backup_mensual.py` y `test_ensayo_listado.py` (ver H14) |
| Contrato worker↔app | `processor/contrato/enums-clinicos.json` | Atado con tests en los dos lados (`test_contrato_enums.py`, `enums-clinicos.test.ts`). Los límites del Recorrido y la regex de transcripción están copiados a mano (H16) |
| Imagen y arranque | `Dockerfile`, `railway.json`, `Procfile` | El `Procfile` está muerto con el builder DOCKERFILE. El arranque está escrito dos veces (H17) |
| vitest | **223 archivos (221 verdes, 2 saltados), 2444 tests (2441 verdes, 3 saltados)**, 438 s | "import" se lleva 256 s de los 438 |
| Lista `INTEGRACION` (`vitest.config.ts:40-97`) | 40 entradas | Todas existen y todas usan base. Coincide con los 41 archivos que importan `db-test` o fixtures; `db-test.test.ts` es puro y está bien afuera |
| `pruebas/**` | e2e (Playwright manual), `grabador-ajustes`, `grabador-dhh`, `vida` | Solo `nombres-vigentes.test.mjs` corre de verdad en CI. El resto es manual o huérfano (H20) |
| `scripts/**` | 10 archivos: `ci/` 4, `ensayo/` 4, `mantenimiento/` 2 | Los 4 guardianes están vivos. El ensayo compara el esquema exacto (H2) |
| Workflows | 6 archivos, 1205 líneas: ci, publicar, avisar-ci, backup, ensayo-restauracion, latido | Todos en `ubuntu-24.04`, acciones `@v7` y `timeout-minutes` en cada job |
| Prisma | `schema.prisma` 986 líneas, 9 migraciones | 2 columnas muertas con `@ignore`, ~20 columnas que solo se escriben, 3 índices sin consulta en la app, 3 valores de enum sin productor |
| `package.json` | 16 deps y 13 devDeps | Ninguna sobra. Falta declarar `js-yaml` (H9), que se usa por transitividad |
| `requirements*.txt` | 3 de runtime y 2 de dev | Ninguno sobra. Falta declarar `jmespath` (H14). Sin lockfile |

---

## (b) Hallazgos

Riesgo: **A** alto, **M** medio, **B** bajo. Esfuerzo: **S**, **M**, **L**.

### Worker

**H1. El transcript de AssemblyAI se registra para borrado recién después de que ya se borró.** Riesgo M (privacidad). Esfuerzo M. VERIFICADO.
- `processor/processor.py:17-18` promete que el transcript "se registra apenas se conoce su id, para que la app lo borre con reintentos aunque este proceso muera".
- Pero `asr_assemblyai.transcribir` (`asr_assemblyai.py:446-471`) crea el transcript en `:461`, espera hasta `ASR_TIMEOUT_SECONDS=1800` (`:468`) y lo borra en el `finally` (`:471`). Recién **después** devuelve el id, y recién ahí `registrar_checkpoint` llama a `app_client.registrar_asr` (`processor.py:340-342`).
- Qué pasa si el proceso muere durante la espera (redeploy de Railway, OOM, SIGKILL): el transcript con el texto de la sesión queda en AssemblyAI y la app nunca supo su id.
- Propuesta mínima: un callback `al_crear(transcript_id)` en `transcribir`, que `processor` usa para llamar a `registrar_asr` antes del polling.
- HIPÓTESIS aparte: si falla la creación del transcript después del upload, el archivo subido queda sin id para borrarlo.

**H2. Errores del LLM que no se arreglan solos se tratan como transitorios.** Riesgo M (costo). Esfuerzo S. VERIFICADO.
- `errores.py:13-14` dice que "respuesta del modelo con forma invalida dos veces" es definitivo. Pero `CODIGOS_DEFINITIVOS` (`errores.py:18-27`) no incluye:
  - `llm_estructura_invalida` (`clinical_analyzer.py:378`, que sale después de `MAX_REINTENTOS_ESTRUCTURA`);
  - `llm_json_invalido` (`:272`);
  - `llm_rechazo` (`:254`);
  - `llm_sin_texto` (`:258`).
- El que sí está, `llm_invalido`, es inalcanzable: `schemas_llm.py:390-392` ya exige el dict.
- Consecuencia: una nota que falla dos veces por forma vuelve a la cola hasta `MAX_FALLOS_SEGUIDOS = 5` (`src/lib/sesion-clinica/estados.ts:164`). Son hasta 10 llamadas largas por sesión. El ASR no se repite, porque hay checkpoint. El monto exacto es HIPÓTESIS.
- Propuesta: sumar esos cuatro códigos a `CODIGOS_DEFINITIVOS`, o corregir el docstring si la decisión es reintentar.

**H3. `worker.py` y `r2_client.py` casi sin tests.** Riesgo M. Esfuerzo S. VERIFICADO con la cobertura.
- `worker.py` tiene 45 % de cobertura. Sin cubrir: `_signal_handler` (`:43`), `_dormir_interrumpible` (`:53`), `loop_principal` (`:127`), `procesar_modo_manual` (`:150`) y `main` (`:171`).
- `r2_client.py` tiene 24 %: `descargar_audio` (`:29`) nunca se ejecuta en tests. Siempre se mockea desde `processor`.
- `loop_principal` es el que decide backoff y apagado ordenado en Railway.
- Propuesta: un test de `loop_principal` con `_ciclo` doble y la señal simulada, y uno de `descargar_audio` con `botocore.stub.Stubber`.

**H4. Valores y campos muertos en el worker.** Riesgo B. Esfuerzo S. VERIFICADO.
- `Transcripto.modelo_asr` (`processor.py:174`): se arma en `:380` y `:391` y nadie lo lee.
- `DiagnosticoLLM.reintentos` (`clinical_analyzer.py:70`): solo lo leen 6 asserts de tests. `uso.reintentos` se deriva de `llamadas` (`uso.py:59`).
- `descargar_audio` devuelve `metadata` y el único llamador la descarta (`processor.py:255`).
- Revalidación duplicada en `processor.py:578`: si fallara, viajaría como `"ValueError"` a secas.
- Borrado de AssemblyAI implementado dos veces: `asr_assemblyai._borrar` (`:310`) y `processor.borrar_transcript_asr` (`:497-510`), esta última con la cabecera a mano en `:504`.
- Del grabador por segmentos **no queda nada en el worker** (grep de `solape|inicio_ms|continuacion|audio_segmentos`: solo aparecen segmentos del ASR).

**H5. Los 4xx de AssemblyAI se reintentan.** Riesgo B-M. Esfuerzo S. VERIFICADO.
- `asr_assemblyai.py:127-133` convierte todo 4xx en `asr_error` transitorio. Un 400 por payload vuelve a subir el audio en cada vuelta.
- `app_client.py:120-128`, en cambio, trata el 4xx como terminal.
- Propuesta: un código definitivo `asr_rechazado` para 4xx distinto de 429.

**H6. Un log con texto de excepción de terceros.** Riesgo B. Esfuerzo S. VERIFICADO.
- `processor.py:257` loguea `str(e)[:300]`, y esa excepción la arma `r2_client.py:36` con la key y el texto de botocore.
- Es el único lugar que no sigue la regla "solo el tipo" que aplican `_describir` (`:582-591`) y `:219`.

### Tests (vitest y pytest)

**H7. Doce rutas de API que ningún test importa, cuatro de ellas críticas.** Riesgo M. Esfuerzo M. VERIFICADO.
- Según la cobertura V8 y un grep de imports, nunca se cargan:
  - `api/trabajos/pendientes` (reclamo del worker);
  - `api/cron/trabajos`, `api/cron/mantenimiento`, `api/cron/recordatorios`;
  - `api/health`, `api/estado-worker`;
  - `api/hot-words`, `api/pacientes`, `api/deudores`;
  - `api/sesion-clinica/pendientes`, `api/sms/envios`, `api/csp-report`.
- Sus casos de uso sí tienen test (coincide con el panel 2, columna `CU`). Lo que no se prueba es la autenticación (`requireCron`/`requireM2M`), el `conTimeout` y el mapeo de errores de la ruta.
- Las menciones en `rutas-area2.test.ts:24` y `documentacion-vigente.test.ts:14` son strings, no imports.
- Propuesta: un test por ruta cron y M2M que afirme 401 sin credencial y 200 con credencial.

**H8. Unas 45 aserciones buscan strings en el código fuente.** Riesgo M. Esfuerzo M. VERIFICADO en muestra.
- `ayuda-vigente.test.ts`: 16 `expect(codigo(…))`, por ejemplo `:127` `"grabacionesIniciadas: { increment: 1 }"` y `:172` `"366 days ago"`.
- `consentimiento.test.ts`: 18, por ejemplo `:82-90` `'xhr.open("PUT", url, true)'`.
- `limites-prueba-integracion.test.ts:48-61`.
- `esqueletos.test.tsx:112-122`, `portada-movimiento.test.tsx:79-83`, `sheet-formulario.test.tsx:32`, `ayuda-agenda.test.ts:17`, `rutas-area2.test.ts:30-32`.
- Cuatro de ellos duplican un test de comportamiento que ya existe:
  - `limites-prueba-integracion:48` duplica `:63+`;
  - `ayuda-vigente:172` duplica `consentimiento-retencion.test.ts:14-50`;
  - `consentimiento:206` duplica `backup.test.ts:40-51`;
  - `rutas-area2:32` duplica `scripts/ci/max-duration.mjs`.
- No son cosméticos del todo: atan la ayuda al código. Pero frenan refactors inocuos.
- Propuesta: borrar los cuatro duplicados y, en los de ayuda, afirmar contra constantes exportadas.
- Los ~12 guardianes estructurales (`proxy-liviano`, `csp-destinos`, `calendario-unico`, etc.) son legítimos.

**H9. `js-yaml` se usa en 4 tests y no está declarado.** Riesgo M. Esfuerzo S. VERIFICADO.
- Lo usan `backup.test.ts`, `publicacion-manual.test.ts`, `ensayo-restauracion.test.ts` y `consentimiento-retencion.test.ts`. No está en `package.json` y llega por `eslint → @eslint/eslintrc`.
- Lo mismo pasa con `vite` en `pruebas/grabador-dhh/verificar.mjs`.
- Propuesta: `js-yaml` en devDependencies.

**H10. Un test fija la versión de una acción y va a dar rojo con Dependabot.** Riesgo M. Esfuerzo S. VERIFICADO.
- `publicacion-manual.test.ts:72` exige `"actions/checkout@v7"` para avisar-ci. Es la misma trampa que bloqueó el PR #27 con `@v5`.
- Propuesta: `expect.stringMatching(/^actions\/checkout@v\d+$/)`.

**H11. Tests sensibles al tiempo y al entorno.** Riesgo B. Esfuerzo S. VERIFICADO.
- 25 archivos usan el reloj real sin fake timers; casi todos en forma relativa.
- Carreras de medianoche o fin de mes: `format.test.ts:103-104` ("Hoy"/"Ayer") y `cobros-mes.test.ts:118`.
- Aserción de rendimiento de pared: `finanzas.test.ts:690-722` (`< 10_000` ms).
- Esperas con `setTimeout` real de 300 a 900 ms en `login-atomico.test.ts:175,197,226` y `grabacion-diagnostico-integracion.test.tsx:113-128`. Este último es además el test más lento de la suite: 3,9 s.
- Fecha fija con nombre engañoso: `multi-tenant.test.ts:259` `MANANA = 2026-12-01`, inocua hoy.
- Solo `npm test` fija `TZ=UTC` (`package.json:13`); `test:unit` y `test:integration` no. Propuesta: agregar `TZ=UTC` a los dos.
- En pytest: `test_processor.py:260-265` usa un hilo real con `sleep(0.3)`.
- La única bomba de tiempo real no es un test: es el acta (H16).

**H12. Skips.** Riesgo B. Esfuerzo S. VERIFICADO.
- En la corrida saltaron 3 tests y 2 archivos:
  - `pruebas/e2e/capturas.spec.ts:31`: `describe.skipIf(!CAPTURAS_URL)`. Es un spec de Playwright que vitest recolecta por glob.
  - `pruebas/vida/interacciones.test.tsx:20`: `it.runIf(MEDIR_UI==="1")`, una medición manual.
- `prisma-encryption.test.ts:203,415` usa `describe.skipIf(!hayBaseDeTest())`: es el único archivo de integración que se saltea en silencio en vez de fallar.
  - Además es mixto: su parte pura (`:1-200`) nunca corre con `test:unit`.
  - Propuesta: separar la parte pura en su propio archivo y excluir `pruebas/e2e/*.spec.ts` del glob.
- pytest: 0 skip. Pero `test_audio_asr.py` necesita ffmpeg y `test_ensayo_listado.py:22` necesita `node`, y ninguno tiene `skipif`: sin esas herramientas fallan en vez de saltearse.

**H13. Tests cosméticos del worker.** Riesgo B. Esfuerzo S. VERIFICADO.
- Defaults de config fijados: `test_clinical_analyzer.py:360,385,387,407,455` y `test_anthropic.py:31`. Fallan si alguien exporta `LLM_*` en su shell.
- El doble `_truncado` escribe a mano el texto que produce `_llamar_anthropic` (`test_clinical_analyzer.py:499-505`), y las aserciones de `:536-584` prueban ese texto armado por el propio helper.
- Asserts triviales: `test_errores.py:20` (`isinstance(LeasePerdido(), Exception)`).
- Grep de texto sobre el Dockerfile: `test_audio_asr.py:124-127`.
- Duplicados:
  - `test_schemas_llm.py:392-397` repite `test_contrato_enums.py:57-59`;
  - el borrado de ASR se prueba en `test_processor.py:353-369` y en `test_uso.py:474-477`;
  - `_nota` y `RIESGO_SIN_SEÑAL` están copiados en dos archivos;
  - hay tres dobles de la respuesta del SDK.

**H14. Tests de workflows alojados en el worker, con una dependencia sin declarar.** Riesgo B. Esfuerzo S. VERIFICADO.
- `processor/tests/test_backup_mensual.py` prueba `backup.yml`.
- `processor/tests/test_ensayo_listado.py` prueba `ensayo-restauracion.yml` y `verificar-restauracion.mjs`. Importa `jmespath` (`:42`), que llega por boto3 y no está en `requirements-dev.txt`.
- Propuesta: declarar `jmespath` y `skipif(not NODE)`, o moverlos a `scripts/tests/`.

### Infraestructura

**H15. El ensayo de restauración exige el esquema exacto.** Riesgo **A**, con fecha. Esfuerzo M. VERIFICADO el código; el impacto es HIPÓTESIS.
- `scripts/ensayo/verificar-restauracion.mjs:133-167` compara tabla por tabla y columna por columna contra dos contratos: `esquema-produccion.prisma`, idéntico a `d02ae0e`, y el `prisma/schema.prisma` del checkout.
- Si ninguno coincide, da "esquema restaurado desconocido" (`:545-548`).
- El schedule hace checkout de la rama por defecto (main), no de `release`. Consecuencias:
  - cualquier migración de columnas en main que todavía no se publicó pone en rojo el ensayo diario;
  - la fase 2 (el DROP de `audio_clave_encrypted`/`audio_iv`) pone en rojo toda copia anterior.
- La primera copia mensual con el esquema nuevo sale el 1-oct.
- Propuesta: elegir el contrato según `_prisma_migrations` restaurada, o por lo menos hacer checkout de `release`. Hay que resolverlo **antes** de la fase 2.

**H16. El acta manual de restauración vence el 20-dic y frena Publicar.** Riesgo **A**, con fecha. Esfuerzo S (es operativo). VERIFICADO.
- `scripts/ci/acta-vigente.mjs:30` `LIMITE_PRIMER_ACTA = 2026-12-20`. `docs/operaciones/actas/` solo tiene la plantilla.
- Desde esa fecha el job Guardias falla y `publicar.yml:84-92` no publica.
- Propuesta: hacer el ensayo manual antes. El guardián no se toca.

**H17. `railway.json` no está deprecado, pero es redundante.** Riesgo B. Esfuerzo S. VERIFICADO el repo; HIPÓTESIS lo que pasa en Railway.
- `railway.json` usa `builder: DOCKERFILE`, `startCommand: python worker.py` y `ON_FAILURE`/10. `Dockerfile:7` repite el `CMD`. `Procfile` (`worker: python worker.py`) no lo lee nadie con Dockerfile.
- `Dockerfile:9` menciona un "patrón de watch" que no está en `railway.json`: vive solo en la consola.
- Railway aplica el config-as-code desde la raíz. Con `rootDirectory=/processor`, si el path no se cargó a mano, `railway.json` se ignora (HIPÓTESIS).
- Ninguna fuente del repo ni de los forenses anteriores dice "deprecado".
- Propuesta: borrar el `Procfile`, dejar un solo comando de arranque, llevar `watchPatterns` al JSON y confirmar el path en *Settings → Config-as-code*.

**H18. `vercel.json` apaga los deploys de main pero deja preview en toda otra rama.** Riesgo A si Preview comparte variables con producción; no es verificable desde el repo. Esfuerzo S. VERIFICADO.
- `vercel.json:2-6` tiene `deploymentEnabled: {"main": false}`. Vive desde 03-infra.

**H19. La instalación de PGDG y las credenciales de R2 están copiadas en varios workflows.** Riesgo M. Esfuerzo S. VERIFICADO.
- postgresql-client-17 se instala igual en `ci.yml:159-171`, `backup.yml:105-117` y `ensayo-restauracion.yml:108-120`. El propio `backup.yml:102-103` pide cambiarlo en 4 lugares cuando llegue Postgres 18.
- La configuración de AWS CLI para R2 está dos veces: `backup.yml:197-204` y `ensayo-restauracion.yml:122-129`.
- La preparación de Node (checkout, setup-node, `npm ci`) aparece 6 veces en ci y 1 en publicar. Eso es tolerable.
- Propuesta: acciones compuestas `postgres-cliente` y `r2-cli`.
- Ojo: `backup.test.ts`, `publicacion-manual.test.ts`, `ensayo-restauracion.test.ts` y `consentimiento-retencion.test.ts` buscan pasos por `name`. Hay que moverlos en el mismo commit.

**H20. `pruebas/` es mayormente manual o huérfano.** Riesgo B. Esfuerzo S. VERIFICADO.
- `e2e/recorrido.mjs` se corre a mano contra producción (`npm run e2e`).
- `comprobaciones.node.mjs` solo lo cita el README.
- `grabador-ajustes/` (19-sep) y `grabador-dhh/` (18-sep) no los cita nada fuera de su carpeta. `grabador-ajustes/verificar.mjs:80` firma con `textoVersion: "2.6"`, cuando el vigente es 2.7.
- `vida/` está apagado por `runIf`.
- Propuesta: documentarlos en `docs/como-trabajamos.md` como herramientas manuales, o archivarlos.

**H21. `migraciones.mjs` no detecta renombres.** Riesgo M. Esfuerzo S. VERIFICADO.
- `DESTRUCTIVAS` (`scripts/ci/migraciones.mjs:94-104`) no incluye `RENAME COLUMN/TABLE`.
- Un rename rompe el código viejo durante la ventana entre migrar y publicar, que el propio script describe en `:15-25`.

**H22. La cancelación de CI en main puede dejar un SHA sin verde publicable.** Riesgo B. Esfuerzo S. VERIFICADO.
- `ci.yml:56-58` cancela en todo ref, main incluido.
- `avisar-ci.yml:17` solo avisa `failure`, así que un SHA cancelado no queda en verde ni avisa.
- Propuesta: `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`.

### Esquema y migraciones

**H23. Columnas muertas: `audio_clave_encrypted` y `audio_iv`.** Riesgo B. Esfuerzo M. VERIFICADO.
- Tienen `@ignore` en `schema.prisma:627-628`, sin lector ni escritor.
- `audio_iv` la agregó `20260918120000_grabador_restaurado:9` el mismo día que quedó muerta.
- Fase 2: un DROP con la marca `-- DESTRUCTIVA:`, **después** de H15.
- `inicio_ms`, `continuacion` y `audio_segmentos` ya no existen: la tabla cayó en `grabador_restaurado:11`.
- Resto: un comentario `///` huérfano que describe el modelo borrado, en `schema.prisma:703-711`.

**H24. El borrado de audio en R2 solo borra el índice 0.** Riesgo M (audio clínico huérfano). Esfuerzo M. VERIFICADO el código; HIPÓTESIS que existan esos objetos.
- `indices: [0]` en `audio.ts:201`, `sesion/abandonar.ts:140`, `sesion/eliminar.ts:58` y `sesion/aprobar.ts:133`.
- `keysDe` (`trabajos/ejecutar-borrado-r2.ts:76-77`) solo borra esas keys. Los `/1…/N` de la época de segmentos no se borran nunca.
- Propuesta: listar por prefijo. Primero, el inventario de R2 que pedía 02-datos §3.

**H25. Columnas que solo se escriben y comentarios que prometen lectores que no existen.** Riesgo B. Esfuerzo S. VERIFICADO.
- Ejemplos: `uso` en `trabajos` y en `sesiones_clinicas`, `series_turno.frecuencia/hora_ancla`, `worker_estado.worker_id/ultimo_trabajo_en`, `trabajos.hecho_en/ultimo_error`, `asr_transcript_id`, `sesiones_acceso.motivo_cierre`.
- Conservarlas es barato. Lo que hay que corregir son los comentarios falsos:
  - `schema.prisma:683` y `sesion-clinica/schema.ts:349` (un "reporte mensual" que no existe);
  - `schema.prisma:109` (el cron no escribe `vencimiento`: borra la fila);
  - `schema.prisma:203-204` (un tope de invitaciones que ya no existe);
  - `schema.prisma:509` (el índice `envios_sms(org, aceptado_en)` no calza con `sms/metricas.ts:60-63`).
- Índices sin consulta en la app: `invitaciones(creada_por_id)` (sirve a la FK), `eventos_auditoria(org, creado_en)` (SQL manual) y el desalineado de `envios_sms`.
- Enums sin productor: `MotivoCierreSesion.vencimiento`, `.incidente` y `MotivoBajaSms.manual`. Los dos últimos son a propósito, para SQL a mano.

**H26. `revertir-limites-invitados.sql` va contra el código actual.** Riesgo B. Esfuerzo S. VERIFICADO.
- La cabecera ya advierte "Antes hay que desplegar un código que no lea estas columnas" (`:3`). Hoy las leen `estado-prueba.ts:12-14`, `cuenta-registro-db.ts:17-19` y `audio.ts:100`, así que el script no es ejecutable sin revertir código.
- No es una trampa, pero conviene marcarlo "obsoleto salvo reversión de código".
- `revertir-inmutabilidad.sql` no borra su fila de `_prisma_migrations`, al revés que el otro: tras revertir, `migrate deploy` no repone los triggers. Hay que documentarlo.

### Dependencias

**H27. No sobra ninguna dependencia; faltan dos declaraciones.** Riesgo B. Esfuerzo S. VERIFICADO.
- npm: todas tienen import o una razón legítima. Las razones: `prisma` es CLI, `@tailwindcss/postcss` se carga por string, `@testing-library/dom` es peer, `jsdom` es el entorno por archivo y los `@types/*` son tipos.
- Python: `requests`, `boto3` y `anthropic` se importan; `pytest` y `pytest-mock` se usan.
- Faltan `js-yaml` (H9) y `jmespath` (H14).
- `@aws-sdk/s3-request-presigner` está fijado exacto (`3.1138.0`) y `client-s3` va con `^`: hay que confirmar que es a propósito (checksum de R2).
- El worker sigue sin lockfile: `pip-audit` audita rangos.
- Comentario falso en `turno-realizado.test.ts:14`: "no tiene jsdom ni @testing-library".

---

## (c) Cobertura

### Cómo se midió (leer antes de los números)

- **vitest.** `@vitest/coverage-v8` **no está instalado**, y no lo instalé.
  - En su lugar, un archivo de setup fuera del repo (`--config` desde el scratchpad, que extiende `vitest.config.ts` sin cambiarlo) activa `Profiler.startPreciseCoverage` de V8 con `node:inspector` en cada archivo de test. En `afterAll` vuelca la cobertura y el código transformado.
  - Después se mapea a líneas originales con el source map inline y con `@jridgewell/trace-mapping`, que ya está en `node_modules`.
  - Es el mismo mecanismo que usa coverage-v8, pero con **cobertura de líneas por mapeo**, no de ramas ni de sentencias.
  - El % por archivo es líneas mapeadas ejecutadas sobre líneas mapeadas. El peso por carpeta usa las líneas de código del fuente, sin blancas ni comentarios. Los archivos que ningún test carga cuentan 0 %.
  - Espere diferencias de ±5 puntos contra coverage-v8.
- **pytest.** `pytest-cov` no está disponible. Usé el módulo `trace` de la stdlib (líneas ejecutables contra líneas ejecutadas) con el venv que ya existía, `~/proyectos/ensayo-diaria-venv` (pytest 8.4.2, anthropic 1.6.0; el piso del repo es 1.8, pero los tests no llaman a la API).
  - Hay que pasar `ignoredirs=[]`: con el valor por defecto, la caché de `trace` por nombre de módulo ignora `config.py` porque existe otro `config.py` en el venv, y da un falso 0 %.

### vitest, por carpeta (ordenado por líneas de código)

| Carpeta | Archivos | Nunca cargados | Líneas de código | Cubiertas | % |
|---|---:|---:|---:|---:|---:|
| `src/app/api` (con `_lib`) | 143 | 13 | 9753 | 8697 | 89,2 |
| `src/lib` (raíz) | 51 | 1 | 4727 | 4585 | 97,0 |
| `src/app/(dashboard)/pacientes` | 25 | 3 | 4453 | 3639 | 81,7 |
| `src/components/grabacion` | 7 | 0 | 2401 | 1391 | **57,9** |
| `src/app/(dashboard)/sesiones` | 18 | 4 | 1752 | 1505 | 85,9 |
| `src/app/(dashboard)/agenda` | 10 | 1 | 1528 | 1285 | 84,1 |
| `src/components/ui` | 20 | 0 | 1486 | 1435 | 96,6 |
| `src/app/(dashboard)/_components` | 12 | 0 | 1429 | 1229 | 86,0 |
| `src/app/(dashboard)/config` | 7 | 2 | 1181 | 890 | 75,4 |
| `src/app/(dashboard)/cobros` | 4 | 2 | 943 | 848 | 89,9 |
| `src/components/layout` | 11 | 0 | 904 | 871 | 96,3 |
| `src/app/(dashboard)/grabar` | 3 | 1 | 902 | 653 | 72,4 |
| `src/app/(dashboard)/finanzas` | 7 | 2 | 857 | 822 | 95,9 |
| `src/components/forms` | 4 | 0 | 761 | 662 | 86,9 |
| `src/components/clinico` | 5 | 0 | 546 | 421 | 77,1 |
| `src/hooks` | 5 | 0 | 537 | 260 | **48,3** |
| `src/lib/sms` | 6 | 0 | 484 | 483 | 99,8 |
| `src/lib/sesion-clinica` | 3 | 0 | 483 | 453 | 93,8 |
| `src/components/esqueletos` | 8 | 0 | 439 | 439 | 100 |
| `src/components/ayuda` | 1 | 0 | 331 | 328 | 99,0 |
| `src/types` | 1 | 0 | 291 | 291 | 100 |
| `src/app/(impresion)/…` | 3 | 2 | 293 | 269 | 91,8 |
| `src/app/(auth)/…` | 12 | 3 | 429 | 399 | 93,0 |
| `src/app` (raíz: layout, manifest, íconos, global-error) | 6 | 5 | 220 | 86 | **39,1** |
| `src/app/(dashboard)` (raíz: layout, page, loading) | 4 | 3 | 82 | 21 | 25,6 |
| resto (`lib/hilo`, `src/proxy.ts`, `deudores`) | 3 | 1 | 120 | 116 | 96,7 |
| **TOTAL `src/`** | **~370** | **43** | **37 332** | **32 077** | **85,9** |

Los 43 archivos que nunca se cargan suman 935 líneas: páginas `page.tsx`/`layout.tsx`/`loading.tsx` (esperable en unit tests) y **12 rutas de API** (H7).

### vitest: los 20 archivos con más líneas sin cubrir

| # | Archivo | Líneas | % | Sin cubrir |
|---:|---|---:|---:|---:|
| 1 | `src/components/grabacion/HotWordsManager.tsx` | 567 | 59,1 | 232 |
| 2 | `src/hooks/useSesionClinicaPolling.ts` | 221 | **3,2** | 214 |
| 3 | `src/components/grabacion/ConsentimientoBadge.tsx` | 213 | **4,6** | 203 |
| 4 | `src/app/(dashboard)/config/_components/config-view.tsx` | 850 | 77,3 | 193 |
| 5 | `src/components/grabacion/FeedbackTerapeutaView.tsx` | 652 | 70,5 | 192 |
| 6 | `src/components/grabacion/FirmaCanvas.tsx` | 181 | **1,7** | 178 |
| 7 | `src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx` | 780 | 78,6 | 167 |
| 8 | `src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx` | 567 | 77,3 | 129 |
| 9 | `src/app/api/_lib/casos-uso/hot-words.ts` | 188 | 39,6 | 114 |
| 10 | `src/app/(dashboard)/pacientes/[id]/_components/editar-paciente-form.tsx` | 122 | **8,6** | 112 |
| 11 | `src/app/(dashboard)/agenda/_components/agenda-view.tsx` | 394 | 72,6 | 108 |
| 12 | `src/components/grabacion/ConsentimientoForm.tsx` | 113 | **7,4** | 105 |
| 13 | `src/app/(dashboard)/pacientes/_components/pacientes-view.tsx` | 522 | 80,1 | 104 |
| 14 | `src/app/(dashboard)/pacientes/[id]/_components/sesiones-tab.tsx` | 543 | 81,4 | 101 |
| 15 | `src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx` | 520 | 81,4 | 97 |
| 16 | `src/app/(dashboard)/sesiones/[id]/_components/mas-de-esta-sesion.tsx` | 212 | 56,4 | 93 |
| 17 | `src/components/forms/nuevo-turno-form.tsx` | 560 | 84,0 | 90 |
| 18 | `src/app/(dashboard)/cobros/_components/cobros-view.tsx` | 839 | 89,7 | 86 |
| 19 | `src/components/clinico/brief-corto.tsx` | 270 | 69,1 | 83 |
| 20 | `src/app/(dashboard)/pacientes/[id]/_components/graficos/flags.tsx` | 101 | 17,9 | 83 |

**Lectura:** el hueco está concentrado en la **grabación y el consentimiento**:
- `useSesionClinicaPolling` (3 %), `ConsentimientoBadge` (5 %), `ConsentimientoForm` (7 %) y `FirmaCanvas` (2 %).
- Es el flujo que produce la firma legal y dispara el procesamiento, justo después de "Consentimiento 2.7" (284bcb5). Los tests de consentimiento que existen (`consentimiento.test.ts`) afirman mayormente strings de código (H8), no el componente.

### pytest (worker)

| Módulo | Líneas ejecutables | Ejecutadas | % |
|---|---:|---:|---:|
| `r2_client.py` | 25 | 6 | **24,0** |
| `worker.py` | 129 | 58 | **45,0** |
| `asr_assemblyai.py` | 263 | 212 | 80,6 |
| `transcripcion.py` | 10 | 9 | 90,0 |
| `audio_asr.py` | 39 | 36 | 92,3 |
| `speech_analytics.py` | 41 | 38 | 92,7 |
| `riesgo_lexico.py` | 16 | 15 | 93,8 |
| `errores.py` | 19 | 18 | 94,7 |
| `processor.py` | 378 | 359 | 95,0 |
| `schemas_llm.py` | 354 | 339 | 95,8 |
| `clinical_analyzer.py` | 304 | 292 | 96,1 |
| `app_client.py` | 148 | 143 | 96,6 |
| `uso.py` | 38 | 37 | 97,4 |
| `config.py` | 60 | 59 | 98,3 |
| **TOTAL** | **1824** | **1621** | **88,9** |

En `asr_assemblyai.py` quedan sin cubrir los caminos de error del polling (`:264-273`, `:294-302`), el fallo del DELETE (`:323-324`), `_mapping_roles` (`:338-347`) y parte de `_normalizar` (`:389-412`).

---

## (d) VERIFICADO contra HIPÓTESIS

**VERIFICADO** (leído, greppeado o ejecutado sobre `8f2047b`):
- H1, H2, H3 a H14 y H19 a H27, más todos los números de cobertura y de la suite.
- Corrí los guardianes `max-duration.mjs` (66 rutas, rc 0), `acta-vigente.mjs` (rc 0, con aviso) y `documentacion-vigente.mjs` (rc 0). `documentacion-vigente` no está en ningún workflow: lo ejecuta `documentacion-vigente.test.ts` dentro de `npm test`.

**HIPÓTESIS** (no se puede confirmar sin consola, o es una estimación):
- H1: que el upload quede huérfano si falla la creación.
- H2: el costo exacto por sesión.
- H15: el impacto concreto sobre la mensual del 1-oct y sobre la diaria.
- H17: qué archivo lee realmente Railway (el path de config-as-code y los watch patterns en la consola).
- H18: si Preview de Vercel tiene variables de producción.
- H24: si existen objetos `/1…/N` en R2.
- H25: el beneficio real de reajustar el índice de `envios_sms`.
- Horarios que se apagan tras 60 días sin actividad. Plan Pro de Vercel para los crons `*/5`.
- La tolerancia de ±5 puntos de la cobertura V8 contra coverage-v8.

**No encontrado:**
- **La carta del 25-sep no aparece** en `docs/`, `~/forense-sesion/`, `~/disenos-sesion/` ni en la memoria del proyecto. Tampoco hay ninguna fuente que diga que `railway.json` está "deprecado". Evalué como sustituto la lista de pendientes de `~/forense-sesion/03-infra.md` y las notas del 25-sep (sección f). Si la carta está en un chat o un correo, hace falta el texto para cerrar ese cruce.

---

## (e) Top 10

| # | Hallazgo | Riesgo | Esfuerzo |
|---:|---|---|---|
| 1 | **H15**: el ensayo de restauración exige el esquema exacto y hace checkout de main. Falsas alarmas apenas haya una migración; hay que resolverlo antes del DROP de fase 2 | A | M |
| 2 | **H16**: sin acta manual antes del **20-dic**, Guardias falla y no se publica nada | A (fecha) | S |
| 3 | **H1**: el transcript de AssemblyAI se registra para borrado recién después de haberlo borrado; si el worker muere en la espera, el texto clínico queda en el proveedor | M (privacidad) | M |
| 4 | **H18**: `vercel.json` despliega preview de toda rama salvo main | A si Preview comparte variables | S |
| 5 | **H2**: `llm_estructura_invalida`, `llm_json_invalido`, `llm_rechazo` y `llm_sin_texto` son transitorios; hasta 5 vueltas de LLM | M (costo) | S |
| 6 | **Cobertura de grabación y consentimiento** (tabla c): `useSesionClinicaPolling` 3 %, `ConsentimientoBadge` 5 %, `ConsentimientoForm` 7 %, `FirmaCanvas` 2 % | M | M |
| 7 | **H7**: 12 rutas que ningún test importa, entre ellas el reclamo del worker y los 3 crons (sin test de auth ni timeout) | M | M |
| 8 | **H24**: el borrado de R2 solo borra `…/0`; los restos de segmentos no se borran nunca | M | M |
| 9 | **H9 + H10**: `js-yaml` sin declarar y pin `checkout@v7` en un test; son dos rojos gratuitos esperando | M | S |
| 10 | **H3**: `worker.py` (45 %) y `r2_client.py` (24 %), con el loop, las señales y la descarga sin test | M | S |

Siguientes, en orden: H21 (RENAME en el guardián), H19 (PGDG en 3 lugares), H8 (tests de strings duplicados), H11 (`TZ=UTC` en `test:unit`/`test:integration`), H17 (Procfile y railway.json), H23 (fase 2 del DROP, después de 1).

---

## (f) Cruce con el forense anterior (`~/forense-sesion/`, 24-sep)

No existe un `04-tests.md`: los tests del worker están en `04-worker.md §5` y los de infraestructura en `03-infra.md §5`.

### `04-worker.md`

| Hallazgo | Hoy |
|---|---|
| 1.1 `callback.py` roto | RESUELTO: el archivo no existe |
| 1.2-1.3 cripto, segmentos, `audio_sin_clave` | RESUELTO: solo queda un comentario histórico en `processor.py:77-78` |
| 1.4 `asr_rechazado` sin emisor | RESUELTO (salió del set). Ahora falta lo inverso (H5) |
| 1.5 `orientacion_teorica` sin uso | Worker RESUELTO. App VIVO: `reclamar.ts:66,176` sigue mandando `orientacionTeorica` |
| 1.6 advertencias y reintentos descartados | RESUELTO: viajan en `uso` |
| 1.7 `LLM_BACKEND`, 1.8 `_truncado` doble, 1.10 tests en la imagen, 1.11 ffmpeg | RESUELTOS |
| 1.9 comentarios viejos | RESUELTOS. Nuevos falsos: `schemas_llm.py:9` (`validar_rangos_nota` no existe) y `:28` ("AGENTS.md, regla 3") |
| §2 prompts viejos | RESUELTO: quedan 4, todos cargados |
| §2.1 el Recorrido crece sin techo | VIVO (diseño) |
| §3.1-3.2 campos del LLM sin lector (`confianzaModelo`, `duracionRealMin`, `mitiCounts`…) | VIVO (decisión de producto) |
| §4.1 `APP_BASE_URL`, `WORKER_VERSION` | RESUELTOS (`config.py:137-189`) |
| §4.1 `.env.example` sin `LLM_MAX_TOKENS_NOTA/FEEDBACK/REINTENTO`, `PROMPTS_DIR`, `WORKER_ID` | **VIVO** |
| §4.2 timeout 300 s y 3 reintentos | RESUELTO (600 s y 1). El streaming sigue VIVO |
| §5.1 `transcripcion` y `speech_analytics` sin test | RESUELTO. El armado del user content del Recorrido (`clinical_analyzer.py:466-481`) sigue VIVO |
| §5.3 loop de `worker.py` sin test | **VIVO** (H3, ahora con número: 45 %) |
| §6 lockfile de Python | **VIVO** |
| §7.1 `str(e)` en logs | RESUELTO, salvo `processor.py:257` (H6) |
| §8 `cache_control` sin lectura | RESUELTO (se sacó). Batches para C/B: VIVO (producto) |

### `02-datos.md`

| Hallazgo | Hoy |
|---|---|
| §1.1 columnas de audio muertas | Fase 1 hecha (`@ignore`); **fase 2 VIVA** (H23). `docs/esquema.md:58` sigue diciendo que aprobar anula la clave |
| §1.2 columnas solo escritas | VIVO, y son más (H25) |
| §1.4 el ensayo exige el esquema exacto | **VIVO** (H15) |
| §2 sesiones colgadas | RESUELTO (`abandonar.ts`, `abandonarHuerfanas`, 7 días) |
| §2.2.4 borrado por prefijo | **VIVO** (H24) |
| §5.2 borrados fallidos sin salida | VIVO: no hay reintento de `fallido` en `cron/trabajos` |
| §5.3 alarma falsa `trabajos_atrasados` | VIVO: `trabajos/metricas.ts:21-26` no excluye los `integrar_contexto` bloqueados |
| §6 índice `eventos_auditoria(accion, creado_en)` | RESUELTO (migración `20260924120000`) |
| §7 rama `test` de Neon | Repo a medias: `db-test.ts:40,115,189,260` todavía la ofrece |

### `03-infra.md` y `05-docs.md` (lo de infraestructura y tests)

| Hallazgo | Hoy |
|---|---|
| `NOTES_ENCRYPTION_KEY` en CI; latido sin diagnóstico; `ubuntu-latest`; `setup-python@v5`/`upload-artifact@v4`; `dependabot.yml`; audit que frena por caída de npm; worktrees | RESUELTOS |
| Pin de acción en `publicacion-manual.test.ts` | **VIVO**, ahora con `@v7` (H10) |
| Auditoría semanal que compense el audit tolerante | **VIVO**: ningún workflow tiene audit con `schedule` |
| `vercel.json` y previews | **VIVO** (H18) |
| README "N migraciones" | VIVO: `README.md:46` dice "ocho" y hay 9. También en `docs/operaciones/reconstruir-produccion.md:6` |
| Reglas numeradas de AGENTS.md citadas en el código | VIVO: `proxy.ts:13`, `csp.ts:37,40,92`, `anthropic-mensajes.ts:3`, `ayuda-corpus.ts:36`, `sesion-clinica/schema.ts:47` |
| `docs/pendientes/05-operacion.md:6-9` (`REINTENTAR_RECORDATORIO*`) | Código RESUELTO; el pendiente quedó viejo |
| Railway staged patch, ramas de Neon, proyectos y previews de Vercel, secretos muertos en GitHub | No verificable desde el repo |

### "Carta del 25-sep" (sustituto: 03-infra y las notas del 25-sep)

| Pendiente | Hoy |
|---|---|
| `railway.json` "deprecado" | Sin fuente. Lo vivo es la redundancia `Procfile`/`startCommand`/`CMD` y el watch fuera del repo (H17) |
| Borrar `WORKER_VERSION=ola3` en Railway | Código RESUELTO; la consola no se puede verificar |
| Fase 2 del DROP de audio | VIVO, habilitado (3ab20dd ya está en release). Bloqueado por H15 |
| El guardián de documentación no ve las variables del worker | VIVO (`documentacion-vigente.mjs:41`) |
| Acta manual antes del 20-dic | VIVO, con fecha (H16) |
| Primera copia mensual (1-oct) e issue #33 | Mecanismo listo (`backup.yml:251-266`); la prueba real está pendiente |

---

## (g) Mapa de archivos por propuesta

| Propuesta | Archivos que toca |
|---|---|
| H15 ensayo por migración | `scripts/ensayo/verificar-restauracion.mjs`, `.github/workflows/ensayo-restauracion.yml` (checkout de `release`), `src/lib/__tests__/ensayo-restauracion.test.ts`, `processor/tests/test_ensayo_listado.py` |
| H16 acta | `docs/operaciones/actas/AAAA-MM-DD-*.md` (nuevo; es operativo) |
| H1 registrar el transcript antes del polling | `processor/asr_assemblyai.py`, `processor/processor.py`, `processor/tests/test_asr_assemblyai.py`, `processor/tests/test_processor.py` |
| H2 y H5 códigos definitivos | `processor/errores.py`, `processor/asr_assemblyai.py`, `processor/tests/test_errores.py` |
| H3 tests del loop y de R2 | `processor/tests/test_worker.py`, `processor/tests/test_r2_client.py` (nuevo) |
| H4 campos muertos del worker | `processor/processor.py`, `processor/clinical_analyzer.py`, `processor/r2_client.py`, `processor/tests/test_clinical_analyzer.py` |
| H6 log de R2 | `processor/processor.py:257`, `processor/r2_client.py:36` |
| H7 tests de rutas | `src/app/api/{trabajos/pendientes,cron/trabajos,cron/mantenimiento,cron/recordatorios,health,estado-worker}/route.ts` (solo lectura), `src/lib/__tests__/rutas-cron-m2m.test.ts` (nuevo) |
| Cobertura de grabación y consentimiento | `src/hooks/useSesionClinicaPolling.ts`, `src/components/grabacion/{ConsentimientoBadge,ConsentimientoForm,FirmaCanvas,HotWordsManager}.tsx`, más tests nuevos en `src/components/grabacion/__tests__/` |
| H8 tests de strings | `src/lib/__tests__/{ayuda-vigente,consentimiento,limites-prueba-integracion,rutas-area2}.test.ts` |
| H9 `js-yaml` | `package.json`, `package-lock.json` |
| H10 pin | `src/lib/__tests__/publicacion-manual.test.ts:72` |
| H11 TZ y reloj | `package.json:14-15`, `src/lib/__tests__/{format,cobros-mes,finanzas,multi-tenant}.test.ts` |
| H12 skips | `vitest.config.ts` (excluir `pruebas/e2e/*.spec.ts`), `src/lib/__tests__/prisma-encryption.test.ts` (partirlo) |
| H13 y H14 tests del worker | `processor/tests/{test_clinical_analyzer,test_anthropic,test_errores,test_audio_asr,test_schemas_llm,test_ensayo_listado}.py`, `processor/requirements-dev.txt` (`jmespath`), `processor/tests/dobles.py` (nuevo) |
| Contrato a mano (inventario) | `processor/schemas_llm.py:455-469`, `src/lib/hilo/contenido.ts:12-25`, `processor/tests/test_transcripcion.py:15` |
| H17 Railway | `processor/Procfile` (borrar), `processor/railway.json`, `processor/Dockerfile:7-9`, `docs/operaciones.md:15` |
| H18 previews | `vercel.json` |
| H19 acciones compuestas | `.github/actions/{postgres-cliente,r2-cli}/action.yml` (nuevos), `ci.yml`, `backup.yml`, `ensayo-restauracion.yml`, y los 4 tests que buscan pasos por nombre |
| H20 `pruebas/` | `docs/como-trabajamos.md`, `pruebas/grabador-ajustes/verificar.mjs:80` |
| H21 RENAME | `scripts/ci/migraciones.mjs:94-104`, `src/lib/__tests__/migraciones-guardia.test.ts` |
| H22 cancelación en main | `.github/workflows/ci.yml:56-58` |
| H23 fase 2 del DROP | `prisma/migrations/<nueva>/migration.sql`, `prisma/schema.prisma:627-628,703-711`, `docs/esquema.md:58` (**después de H15**) |
| H24 borrado por prefijo | `src/app/api/_lib/casos-uso/trabajos/ejecutar-borrado-r2.ts`, `src/lib/r2.ts`, `sesion/{abandonar,eliminar,aprobar}.ts`, `audio.ts` |
| H25 comentarios falsos | `prisma/schema.prisma:109,203-204,509,683`, `src/lib/sesion-clinica/schema.ts:349` |
| H26 scripts de reversión | `scripts/mantenimiento/revertir-limites-invitados.sql`, `scripts/mantenimiento/revertir-inmutabilidad.sql`, `docs/operaciones.md:249-253` |
| Varios de documentación (f) | `processor/.env.example`, `README.md:46`, `docs/operaciones/reconstruir-produccion.md:6`, `src/lib/__tests__/db-test.ts:40,115,189,260`, `docs/pendientes/05-operacion.md`, `src/lib/__tests__/turno-realizado.test.ts:14` |
