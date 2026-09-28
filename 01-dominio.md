# Forense 2 · Panel 1 — Dominio y casos de uso

**Commit leído:** `main` = `8f2047b` (Merge origin/consentimiento-2-7), carpeta `~/proyectos/sesion-arreglos`. `git status` vacío al empezar y al terminar: no se tocó nada del repo.
**Zona:** `src/app/api/_lib/**` (domain, casos-uso, auth, tickets, responses, schemas, auditoría, periodo, sesion-clinica) y `src/lib/sesion-clinica/**`. 80 archivos, 11 608 líneas.
**Fecha:** 28 de septiembre de 2026.

**Cómo se hizo:**
- Leí entera la zona, archivo por archivo.
- Métricas con un script propio sobre el compilador de TypeScript del repo (largo de cada función, `if`, `switch` y ternarios; los de funciones anidadas no se suman a la de afuera). El script vive fuera del repo.
- `npx jscpd src --min-tokens 50`, con la salida fuera del repo: 176 clones en todo `src` (2,33 %). En la zona hay solo 7, y todos son internos a un archivo. La duplicación que importa acá es **semántica**, no textual: la misma regla escrita con otras palabras.
- Un script de exports: cada `export` de la zona, buscado con grep en `src`, `scripts` y `e2e`, separando código de producción y tests.
- Grep dirigido para cada hallazgo. **Ojo:** en este shell `grep` es un alias de ugrep. Con `--` o `--include` da resultados distintos de GNU grep. Todo lo que cito lo reconfirmé con `command grep`.
- Un agente de solo lectura cruzó `~/forense-sesion/01-app.md` contra el main actual (sección e). Sus citas más fuertes las reverifiqué.
- No corrí la suite ni ningún test.

**VERIFICADO** = leí las líneas en `8f2047b` o corrí el comando. **HIPÓTESIS** = deducido y no comprobado.

---

## (a) Inventario

### Archivos (los 30 más grandes; `funciones` cuenta también flechas y callbacks)

| archivo | líneas | bytes | funciones |
|---|---:|---:|---:|
| `casos-uso/finanzas.ts` | 720 | 27 892 | 37 |
| `casos-uso/despachar-sms.ts` | 492 | 21 249 | 8 |
| `domain.ts` | 456 | 18 154 | 22 |
| `lib/sesion-clinica/schema.ts` | 451 | 19 181 | 3 |
| `casos-uso/envios-del-turno.ts` | 351 | 13 544 | 10 |
| `casos-uso/progreso-clinico.ts` | 351 | 12 704 | 18 |
| `casos-uso/pendientes-terapeuta.ts` | 349 | 12 959 | 21 |
| `casos-uso/turnos.ts` | 297 | 10 627 | 5 |
| `lib/sesion-clinica/estados.ts` | 281 | 13 144 | 11 |
| `casos-uso/mantenimiento.ts` | 275 | 11 231 | 8 |
| `casos-uso/pacientes.ts` | 266 | 8 980 | 7 |
| `casos-uso/hot-words.ts` | 257 | 7 856 | 12 |
| `casos-uso/audio.ts` | 250 | 12 567 | 9 |
| `casos-uso/solapamiento-turnos.ts` | 241 | 9 585 | 7 |
| `schemas.ts` | 238 | 10 937 | 7 |
| `casos-uso/consentimiento.ts` | 236 | 7 759 | 7 |
| `casos-uso/sesion/reclamar.ts` | 230 | 7 718 | 4 |
| `casos-uso/avisos-notas.ts` | 211 | 8 632 | 16 |
| `casos-uso/cobrar-turno.ts` | 189 | 6 701 | 4 |
| `casos-uso/crear-turno.ts` | 189 | 6 246 | 2 |
| `casos-uso/responder-ayuda.ts` | 185 | 7 356 | 9 |
| `casos-uso/sesion/abandonar.ts` | 183 | 6 787 | 4 |
| `casos-uso/registrar-cuenta.ts` | 180 | 6 451 | 7 |
| `casos-uso/sesion/aprobar.ts` | 176 | 5 608 | 3 |
| `casos-uso/obtener-dashboard.ts` | 169 | 5 148 | 5 |
| `casos-uso/recordar-cobro.ts` | 167 | 6 040 | 2 |
| `casos-uso/sesion/resultado.ts` | 167 | 5 785 | 2 |
| `casos-uso/trabajos/reclamar.ts` | 159 | 5 692 | 4 |
| `auditoria-pura.ts` | 152 | 5 659 | 4 |
| `auth.ts` | 150 | 5 649 | 12 |

Los otros 50 archivos tienen menos de 150 líneas cada uno. Los prefijos `casos-uso/…`, `domain.ts`, etc. son relativos a `src/app/api/_lib/`.

### Las 15 peores funciones

| función | archivo:línea | líneas | `if` | `switch`/ramas | ternarios | nota |
|---|---|---:|---:|---|---:|---|
| `procesar` | `casos-uso/despachar-sms.ts:226` | 246 | 20 | 1 / 4 | 9 | La peor de la zona (H19). |
| `despacharEnvios` | `casos-uso/despachar-sms.ts:181` | 312 | 1 | — | — | Largo porque contiene a `procesar`. |
| `pendientesTerapeuta` | `casos-uso/pendientes-terapeuta.ts:182` | 168 | 0 | — | 1 | Cinco consultas con sus `select`. Largo pero lineal. |
| `actualizarTurno` (callback de la tx) | `casos-uso/turnos.ts:157` | 138 | 9 | — | 1 | Mezcla cuatro responsabilidades (H20). |
| `aplicarResultadoSesion` | `casos-uso/sesion/resultado.ts:37` | 131 | 5 | — | 3 | Tres ramas en cadena (H21). |
| `aprobarSesion` | `casos-uso/sesion/aprobar.ts:48` | 129 | 6 | — | 0 | Regla de producto y escritura juntas (H1, H22). |
| `resumenFinanzas` | `casos-uso/finanzas.ts:263` | 127 | 2 | — | 2 | Orquestación; las cuentas ya están en funciones chicas. |
| `crearTurno` (callback) | `casos-uso/crear-turno.ts:84` | 105 | 5 | — | 4 | Aceptable: el bucle de la serie es la regla. |
| `obtenerDashboard` | `casos-uso/obtener-dashboard.ts:59` | 111 | 0 | — | 0 | Tiene una consulta repetida (H12). |
| `reclamarSesiones` | `casos-uso/sesion/reclamar.ts:83` | 104 | 2 | — | 2 | Tiene el predicado duplicado (H23). |
| `avisosNotas` | `casos-uso/avisos-notas.ts:104` | 102 | 0 | — | 1 | Repite la lista "en proceso" 3 veces (H3). |
| `actualizarPaciente` | `casos-uso/pacientes.ts:180` | 87 | 4 | — | 1 | Aceptable. |
| `reclamarTrabajos` | `casos-uso/trabajos/reclamar.ts:77` | 83 | 3 | — | 4 | Tiene el predicado duplicado (H23). |
| `cerrarSinTerminar` | `casos-uso/sesion/abandonar.ts:90` | 71 | 2 | — | 1 | Buen ejemplo: dos entradas, una regla. |
| callback de `regenerarHilo` | `casos-uso/hilo/regenerar.ts:9` | 29 | 9 | — | 0 | Nueve guardas en 29 líneas densas, con los estados del hilo a mano (H25). |

No hay ningún `switch` de más de 5 ramas en la zona. El único `switch` es el de `procesar` (4 ramas).

---

## (b) Hallazgos

Riesgo: **alto** = puede dañar un dato clínico o dejar pasar un acto sin su control. **Medio** = dos fuentes de una regla que hoy coinciden o divergen sin daño. **Bajo** = prolijidad o costo.
Esfuerzo: **S** = menos de medio día, **M** = uno o dos días, **L** = más.
La numeración tiene huecos (H24, H28, H30, H31) porque esos candidatos se fundieron en otros hallazgos o se descartaron al verificarlos. Los hallazgos se agrupan por tipo, no por número.

### 1. Reglas duplicadas o con más de una fuente de verdad

**H1. La regla de "qué hay que confirmar antes de aprobar" está escrita dos veces, y ya diverge.** Riesgo **alto**, esfuerzo **M**. VERIFICADO.

Servidor, `casos-uso/sesion/aprobar.ts:87-104`:
- exige `confirmoRiesgo` solo si el nivel es `moderado` o `alto`;
- exige `confirmoMenciones` si hay menciones léxicas y el nivel no es ninguno de esos dos;
- no mira los flags.

Pantalla, `src/components/grabacion/RiesgoDetectadoBanner.tsx:82-91` (`clavesDeRiesgo`):
- pide una casilla por cada flag activo;
- pide otra casilla más si el nivel es **cualquiera distinto de `ninguno`**, o sea que incluye `bajo`.

`src/components/clinico/MencionesNota.tsx:7-9` (`exigeConfirmarMenciones`) copia a mano la regla de menciones del servidor. `(d)/sesiones/[id]/_components/sesion-detail-view.tsx:245-260,310` combina las dos.

Hoy la pantalla es más estricta que el servidor, así que no hay un 400. Pero la regla clínica que protege la aprobación la cumple el cliente y no el servidor. Un cliente viejo, un PWA cacheado o una llamada directa aprueban una nota con flags activos o con riesgo `bajo` sin confirmar nada. Es el mismo caso que `sePuedeCobrar` resolvió para cobrar.

Propuesta mínima: una función pura en `src/lib/sesion-clinica/aprobacion.ts`, `confirmacionesParaAprobar(datos) → { riesgoGraduado, flags[], menciones }`. La usan `aprobar.ts` (para validar) y las dos pantallas (para dibujar las casillas).

**Decisión del dueño:** ¿el servidor exige también `bajo` y los flags, como hace la pantalla, o la pantalla afloja a lo del servidor?

**H2. La tabla `OPERACIONES` no la consume ninguna pantalla, aunque su cabecera dice que sí.** Riesgo **medio**, esfuerzo **M**. VERIFICADO.

`lib/sesion-clinica/estados.ts:4-7` dice: "La consumen `transicionar` … y las pantallas (qué botón ofrecer)". Pero `OPERACIONES` y `LISTA_OPERACIONES` no tienen ningún importador de producción fuera de `estados.ts`: solo los usan tests. Las pantallas deciden los botones con literales que repiten la tabla:
- `sesion-detail-view.tsx:374` (`editable` si está en `revision` = `aprobar.desde`);
- `:379` (`revision` o `aprobada` = `reintentar_feedback.desde`);
- `:465` (`fallida` = `reintentar` y `eliminar`);
- `(d)/pacientes/[id]/_components/sesiones-tab.tsx:237,534-550`;
- `(d)/_components/card-ahora.tsx:123-137`;
- `src/components/ui/session-row.tsx:97-101`.

Propuesta: `puede(op: NombreOperacion, estado)` en `estados.ts`, derivada de `OPERACIONES[op].desde`, y usarla en esas pantallas. Otra opción es corregir la cabecera si se decide que no.

**H3. "En proceso" (`subiendo` o `procesando`) está escrito ocho veces.** Riesgo **medio**, esfuerzo **S**. VERIFICADO.

Está en:
- `src/lib/notas-en-proceso.ts:104`;
- `casos-uso/avisos-notas.ts:94`, `:118` y `:194-196` (tres veces en el mismo archivo);
- `sesion-detail-view.tsx:447`;
- `sesiones-tab.tsx:541`;
- `card-ahora.tsx:132-133`;
- `(d)/agenda/_components/turno-detail-sheet.tsx:242`.

`estados.ts` tiene `ESTADOS_EN_PIPELINE` (que incluye `grabando`) y `ESTADOS_SIN_TERMINAR`, pero no este conjunto.

Propuesta: `ESTADOS_EN_PROCESO` en `estados.ts`, y que `enProceso` de `notas-en-proceso.ts` lo use. Ya estaba en 01-app §2 y sigue vivo.

**H4. `["programado","realizado"]` (turnos en los que se graba, o que ocupan la agenda) está escrito seis veces, y la ficha reimplementa `sePuedeGrabar` entera.** Riesgo **medio**, esfuerzo **S**. VERIFICADO.

Está en:
- `domain.ts:248` (dentro de `sePuedeGrabar`);
- `casos-uso/audio.ts:86` (el guard con lock de `prepararAudio`, que después vuelve a llamar a `sePuedeGrabar` en `:95`);
- `casos-uso/pendientes-terapeuta.ts:79` (`ESTADOS_GRABABLES`, cuyo comentario dice "Espejo del guard…");
- `casos-uso/solapamiento-turnos.ts:101` (`ESTADOS_QUE_OCUPAN`: otra regla con los mismos valores);
- `(d)/pacientes/[id]/_components/paciente-detail-view.tsx:202-203` (estado más `esMismoDiaMvd`, o sea `sePuedeGrabar` a mano);
- `turno-detail-sheet.tsx:230` (`puedeGrabarORevisar`).

Propuesta: exportar `ESTADOS_GRABABLES` junto a `sePuedeGrabar`, usarlo en `audio.ts:86` y en `pendientes`, y llamar a `sePuedeGrabar` en la ficha. `ESTADOS_QUE_OCUPAN` se queda con su nombre porque es otra regla, pero se mueve a `constantes-turno.ts`.

**H5. Dos escrituras de auditoría se saltean `auditar`/`registrarAuditoria`, contra la regla de `auditoria.ts:3-8,26-27`.** Riesgo **medio**, esfuerzo **S**. VERIFICADO.
- `casos-uso/hilo/base.ts:95-101` (`auditarHilo`) hace `tx.eventoAuditoria.create` a mano y **sin `detalleSeguro`**. Hoy el detalle son ids y números. Pero es justo la puerta que el filtro existe para cerrar: `...origen` hace spread de una fila.
- `casos-uso/iniciar-sesion.ts:102-116` reimplementa `registrarAuditoria` (try/catch más `detalleSeguro` a mano).

Propuesta: `auditarHilo` llama a `auditar(tx, …)` e `iniciarSesion` llama a `registrarAuditoria(prisma, …)`. `grep eventoAuditoria.create` queda con un único resultado fuera de tests (`auditoria.ts:50`) y un `createMany` en `src/lib/cuenta-registro-db.ts:79` (fuera de la zona).

**H6. Los nombres de las acciones de auditoría se escriben sueltos, y hay lectores en otros archivos que dependen de ese texto exacto.** Riesgo **medio**, esfuerzo **S-M**. VERIFICADO.
- `"sesion.ver"` se escribe en `src/app/api/sesion-clinica/[id]/route.ts:31`. `casos-uso/avisos-notas.ts:92` tiene su propia `ACCION_VER`, que la ruta no importa.
- `"sesion.reintentar"` está en `casos-uso/sesion/reintentar.ts:44` y en `avisos-notas.ts:93`.
- `"sesion.crear"` está en `src/app/api/sesion-clinica/route.ts:23`, y `"sesion.aprobar"` en `aprobar.ts:159`. La métrica `casos-uso/auditoria-metricas.ts:65-66` los cuenta por texto.

Si alguien renombra una acción, la franja de "nota lista" y la métrica de rastros perdidos se rompen sin que falle nada.

Propuesta: un catálogo `ACCIONES` (en `auditoria-pura.ts` o en un módulo propio) que importen quienes emiten y quienes leen. Un test que recorra el disco puede exigir que ninguna llamada use un literal.

**H10. La deuda de una sola paciente se calcula igual en dos lugares.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
`casos-uso/recordar-cobro.ts:91-96` y `casos-uso/texto-de-cobro.ts:22-26` hacen lo mismo: `buscarTurnosConDeuda(…, pacienteId)`, después `calcularDeudores`, después `[deuda]`, después `sesionesImpagas === 0`. Propuesta: `deudaDePaciente(prisma, org, paciente, ahora)` en `domain.ts`.

**H11. "Cobrado en el mes" tiene tres implementaciones.** Riesgo **bajo-medio**, esfuerzo **S-M**. VERIFICADO el código; HIPÓTESIS que den el mismo número (no lo ejecuté).
Las tres son:
- `casos-uso/obtener-dashboard.ts:92-99` (KPI `ingresosMes`);
- `casos-uso/turnos.ts:94-110` (`cobrosDelMes`);
- `casos-uso/finanzas.ts:421-443` (`consultaPagos`, SQL con corrimiento a Montevideo).

Las tres filtran `pagado` y `pagoFecha` dentro del mes, pero por caminos distintos. Propuesta: que el KPI de Hoy salga de un `where` compartido (`cobradoEnMes(mes)`) o de la cuenta de finanzas.

**H14. La señal de riesgo del día se lee sin normalizar.** Riesgo **bajo-medio**, esfuerzo **S**. VERIFICADO el código; HIPÓTESIS el impacto.
`casos-uso/obtener-dashboard.ts:34-51` (`aSenalDeRiesgo`) castea el `datos` crudo y reenvía `nivel: unknown`. En cambio `aprobar.ts:87-88` y `hilo/brief.ts:19-20` pasan por `parseDatosEstructurados` y `normalizarRiesgo`. Un `nivel` inválido guardado llega tal cual a Hoy. Propuesta: las mismas dos llamadas.

**H15. "Flags de riesgo activos" tiene tres implementaciones.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
Están en `casos-uso/hilo/brief.ts:29`, `casos-uso/progreso-clinico.ts:306-307` y `RiesgoDetectadoBanner.tsx:71-74`. Propuesta: `flagsActivos(flags)` en `lib/sesion-clinica/normalizar.ts`. Conviene hacerlo junto con H1.

**H16. El guard "paciente de esta organización, o 404" está escrito siete veces.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
- `_lib/pacientes.ts:14` (`requirePaciente`, con **un solo** consumidor: `src/app/api/pacientes/[id]/documentacion/route.ts:67`);
- `casos-uso/hilo/base.ts:18` (`exigirPaciente`);
- `casos-uso/consentimiento.ts:78` (otro `exigirPaciente`);
- en línea en `crear-turno.ts:90-97`, `recordar-cobro.ts:81-88` y `hilo/exportar.ts:55-59`.

Propuesta: una sola `requirePaciente(prisma, id, org, select?)`.

**H17. La orientación teórica y su valor por defecto no tienen fuente única.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
- `ORIENTACION_DEFAULT = "cbt_mi"` está duplicada en `casos-uso/sesion/reclamar.ts:29` y `casos-uso/trabajos/entregar.ts:25`.
- La lista está en `schemas.ts:203` (`z.enum(["cbt_mi","gestalt"])`), `src/types/domain.ts:408` y el enum de Prisma.
- No está en `processor/contrato/enums-clinicos.json`, aunque el worker la recibe.

Propuesta: `ORIENTACIONES` y `ORIENTACION_DEFAULT` en un módulo de `lib`, y `schemas.ts` usa `z.enum(ORIENTACIONES)`.

**H18. Los estados de SMS se escriben a mano y el alta de envío está copiada tres veces.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
- `["pendiente","enviando"]` ya existe como `ESTADOS_CON_ENVIO_PENDIENTE` (`casos-uso/envios-del-turno.ts:58`), pero se reescribe en `despachar-sms.ts:416` y `sms-webhooks.ts:97`.
- `despachar-sms.ts:270` compara `!== "programado"` en vez de usar `turnoSigueProgramado` (`envios-del-turno.ts:75`).
- El bloque "con teléfono, `pendiente`; sin teléfono, `fallido`" está tres veces en `envios-del-turno.ts`: `137-140`, `155-158` y `300-303`.

Propuesta: `estadoInicialDelEnvio(destino, programadoEn, ahora)` y `cancelarPendientesDelDestino(tx, destino, motivo, ahora, excluirId?)`.

### 2. Lógica de negocio fuera de lugar

**H7. Seis eventos de auditoría de la sesión se escriben en las rutas y no en su caso de uso, y una ruta reconoce un error comparando el texto del mensaje.** Riesgo **medio**, esfuerzo **M**. VERIFICADO.

Los seis eventos, cada uno con su ruta y el caso de uso al que pertenecería:

| evento | ruta | caso de uso |
|---|---|---|
| `sesion.crear` | `api/sesion-clinica/route.ts:23` | `prepararAudio` |
| `sesion.ver` | `api/sesion-clinica/[id]/route.ts:31` | — |
| `sesion.subir_audio_inicio` | `api/sesion-clinica/[id]/upload-url/route.ts:44` | `pedirUrlSubida` |
| `sesion.subir_audio_fin` | `api/sesion-clinica/[id]/upload-confirmar/route.ts:31-45` | `confirmarSubida` |
| `sesion.volver_a_grabar` | `api/sesion-clinica/[id]/volver-a-grabar/route.ts:29` | `volverAGrabar` |
| `sesion.exportar` | `api/pacientes/[id]/documentacion/route.ts:148` | — |

En cambio aprobar, reprocesar, reintentar, eliminar, descartar y abandonar auditan dentro del caso de uso.

`upload-confirmar/route.ts:43` decide qué auditar con `error.message === MENSAJE_NO_LLEGO`. Si alguien corrige una tilde del mensaje, se pierde el rastro. `ApiError` ya tiene `codigo`.

Propuesta:
- mover cada evento a su caso de uso;
- `MENSAJE_NO_LLEGO` con `codigo: "audio_no_llego"`, como ya hace `CODIGO_GRABACION_CORTA` (`audio.ts:206`).

Se cruza con el panel de rutas (`02-rutas.md`): coordinar quién lo toma.

**H8. Las pre-lecturas vuelven a escribir la tabla de estados a mano.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
- `casos-uso/sesion/eliminar.ts:47` y `:67` escriben `"fallida"` dos veces y no usan `whereTransicion({ operacion: "eliminar" })`, como sí hace `abandonar.ts:132`. Además repiten el texto de `MENSAJE_CONFLICTO` en `:71`.
- `aprobar.ts:74` (`revision`), `audio.ts:123` (`grabando`) y `:160` (`subiendo`) repiten el `desde` de su operación.
- `resultado.ts:35` (`EstadoTrasResultado`) y `:98,114,141` repiten el `hacia`.

Propuesta: `exigirEstado(estado, op, mensaje)` derivada de `OPERACIONES[op].desde`; que `eliminar` use `whereTransicion`; que `resultado` devuelva `OPERACIONES[op].hacia`.

**H9. El trabajo `borrar_audio_r2` se arma igual en cuatro lugares.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
El payload es siempre `{ prefijo: prefijoAudio(org, sesion), indices: [0] }`, en `cu/sesion/aprobar.ts:128-138`, `cu/sesion/eliminar.ts:53-63`, `cu/sesion/abandonar.ts:137-145` y `cu/audio.ts:198-204`. Además, del lado que lo ejecuta, `trabajos/ejecutar-borrado-r2.ts:76-78` (`keysDe`) vuelve a armar la key que ya calcula `keyAudio` (`estados.ts:146-152`).
Propuesta: `trabajoBorrarAudio({ organizationId, sesionId, pacienteId?, proximoIntentoEn? })` en `trabajos/crear.ts`.

**H32. Un mapper de dominio vive en un caso de uso y repite campos.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
`casos-uso/pacientes.ts:31-55` (`toPaciente`) repite la lista de campos de `toPacienteConDeuda` (`domain.ts:58-68`). Los demás mappers viven en `domain.ts`. Propuesta: `toPaciente` pasa a `domain.ts` y `toPacienteConDeuda = { ...toPaciente(p), …estadísticas }`.

**H33. La normalización del email está copiada cuatro veces.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
`.trim().toLowerCase()` aparece en `iniciar-sesion.ts:57`, `registrar-cuenta.ts:43` y `:158`, y `recuperar-cuenta.ts:74`. Propuesta: `normalizarEmail` en `lib`.

### 3. Funciones largas y ramificación

**H19. `procesar` de `despachar-sms.ts:226-471` tiene 246 líneas, 20 `if`, un `switch` de 4 ramas y 9 ternarios.** Riesgo **medio** (es el camino más delicado de SMS), esfuerzo **M**. VERIFICADO.
- Los tres cortes previos (baja, turno cerrado, turno pasado, `:259-282`) tienen la misma forma: cerrar, contar, anotar el evento y volver.
- `limiteUtil` se calcula dos veces (`:330-332` y `:446`).

Propuesta:
- una tabla `CORTES_PREVIOS: Array<(e, ahora, baja) → { motivo, evento } | null>`;
- un mapa `MANEJADORES[resultado.tipo]` en lugar del `switch`;
- sacar `procesar` a una función del módulo que reciba un contexto.

Ya hay tests (`despachar-sms.test.ts`, `sms-callback.test.ts`).

**H20. `actualizarTurno` (`casos-uso/turnos.ts:144-297`, callback de 138 líneas con 9 `if`) mezcla cuatro cosas.** Riesgo **medio**, esfuerzo **M**. VERIFICADO.
Las cuatro:
- guardas de estado del turno;
- solapamiento;
- cifrado de la nota;
- reprogramación de SMS.

Además el turno no tiene tabla de transiciones. Sus reglas están repartidas en `turnos.ts:181-187`, `cobrar-turno.ts:57-62,97`, `cancelar-serie-turno.ts:67,84` y `despachar-sms.ts:270`.

Propuesta: una función pura `decidirEdicionTurno(actual, cambios) → { error } | { verificarSolapamiento, efectoEnvio: "cancelar" | "reprogramar" | "revivir" | null }` en `domain.ts`, testeable sin base. El caso de uso solo aplica lo que decide.

**H21. `aplicarResultadoSesion` (`resultado.ts:37-167`) tiene tres ramas en cadena y el mismo mensaje cinco veces.** Riesgo **bajo**, esfuerzo **S-M**. VERIFICADO.
"El intento ya no es el vigente; resultado ignorado" aparece en `:55,85,112,121,139`. Propuesta: un mapa `{ nota, fallo_definitivo, fallo_transitorio } → función` y una constante para el mensaje.

**H22. `aprobarSesion` (`aprobar.ts:48-176`) tiene 129 líneas.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
Con H1 pierde unas 20. El mensaje de conflicto de generación está repetido en `:79` y `:114`.

**H23. El predicado "reclamable" está escrito dos veces dentro de cada reclamo.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO (jscpd marca el primero).
Aparece en `casos-uso/sesion/reclamar.ts:91-95` contra `:118-124`, y en `casos-uso/trabajos/reclamar.ts:90-94` contra `:119-124`. Propuesta: `const reclamable = (ahora) => ({…})` en cada archivo.

**H25. El hilo repite consultas y serializaciones, y no tiene tabla de estados de versión.** Riesgo **bajo-medio**, esfuerzo **S** para las dos primeras, **M** para la tabla. VERIFICADO.
- "Notas aprobadas de esta paciente" aparece siete veces: `hilo/base.ts:68-71`, `brief.ts:13`, `exportar.ts:85-89`, `leer.ts:31-34`, `trabajo.ts:20-23` y `:44-46`, y `regenerar.ts:29`.
- Una versión se pasa a ISO cuatro veces: `base.ts:52-55`, `leer.ts:14` y `:39`, `exportar.ts:78-80` (jscpd marca exportar contra leer).
- Los estados de versión (`propuesta`, `aplicada`, `rechazada`, `desactualizada`) son literales sueltos: `escribir.ts:36,60`, `regenerar.ts:17`, `trabajo.ts:49` y `base.ts:86-89`. No hay una tabla como `estados.ts`.
- El estilo de la carpeta `hilo/` (una línea densa por sentencia, sin comentarios) difiere del resto.

Propuesta: `whereAprobadasDe(identidad)`, `aResumen(fila)` y una tabla chica de transiciones de versión en `src/lib/hilo/`.

### 4. Código muerto y columnas que ya no se usan

**H26. El brief manda dos campos constantes, y la pantalla tiene ramas que nunca se ven.** Riesgo **bajo-medio**, esfuerzo **S**. VERIFICADO.
- `casos-uso/hilo/brief.ts:25` fija `pendienteAprobacion: false` y `:34` fija `revisadoPorTerapeuta: true`.
- Por eso el aviso de `src/components/clinico/brief-corto.tsx:220` y `(d)/pacientes/[id]/_components/brief-pre-sesion.tsx:313` nunca se muestra, y tampoco la rama de `brief-pre-sesion.tsx:279`.
- El dato real existe aparte: `notaPendiente` (`brief.ts:17`).

Propuesta: sacar los dos campos y leer `notaPendiente`. O decidir si "nota pendiente" debe verse en el brief.

**H27. Columnas y ramas sin lector.**
- `asr_transcript_id`. Riesgo **bajo**, esfuerzo **S**, VERIFICADO. Se escribe (`registrar-asr.ts:33`, `registrar-transcripcion.ts:59`) y nada de la app lo lee: solo `worker-escrituras.test.ts:220`. El borrado del transcript usa el payload del trabajo (`registrar-asr.ts:47`). Dejar de escribirla y migrar, o documentar que es para SQL manual. Decide el dueño.
- `uso` (en `sesiones_clinicas` y `trabajos`). Riesgo **bajo**. VERIFICADO que ningún código de `src` ni `scripts` lo lee; HIPÓTESIS que "lo suma el reporte mensual" (el comentario de `schema.prisma`) sea una consulta manual. Se escribe en `resultado.ts:81,109,136` y `trabajos/resolver.ts:69`.
- `audio_clave_encrypted` y `audio_iv`. VERIFICADO. Siguen con `@ignore` en `schema.prisma` ("fase 2 de la limpieza"). Las columnas siguen en la base y ninguna línea de la zona las nombra. Falta la migración de la fase 2.
- Rama `fallida` de `esHuerfana`. Riesgo **bajo**, esfuerzo **S**, VERIFICADO. La rama (`estados.ts:221`) es inalcanzable desde su único llamador (`mantenimiento.ts:204-213`, que preselecciona `ESTADOS_SIN_TERMINAR`). Solo la ejercita `estados.test.ts:124`. Sacarla o dejar de llamarla "regla única".
- Otros restos menores, todos riesgo **bajo**, esfuerzo **S**, VERIFICADO:
  - `finanzas.ts:97-98` define dos alias sin valor (`inicioDe = inicioDeMes`, `finDe = finDeMes`).
  - `mantenimiento.ts:203` recalcula `UMBRAL_HUERFANA_HORAS * 3 600 000`, cuando `estados.ts:197` ya tiene `UMBRAL_HUERFANA_MS` (privada).
  - `mantenimiento.ts:259` y `:270` repiten el `50_000`.
  - `operacion.ts:21` escribe `id: "worker"` en lugar de `WORKER_ESTADO_ID` (`sesion/latido.ts:8`).
  - `tickets.ts:93` repite a mano la unión de `TipoTrabajo` de Prisma.
  - `hot-words.ts:29` (`ScopeHotWord`) duplica `hotWordScopeSchema` (`schemas.ts:123`).
  - `trabajos/ejecutar-borrado-r2.ts:18-22,76-78` (`payloadBorradoR2Schema`, `keysDe`) repite el tipo de `trabajos/crear.ts:17` y la key de `keyAudio`.
- Exports sin consumidor de producción fuera de su archivo: unos 200 en la zona. Casi todos son tipos `*Input`, constantes usadas adentro o funciones que se exportan para testear. **No es código muerto**: es sacar el `export` en bloque. Una sola excepción real: no encontré ninguna función exportada que no se use ni adentro ni en tests.

**H29. El 404 de una sesión tiene dos textos distintos.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
`"Sesión no encontrada"` (`transicion.ts:65`) y `"Sesión clínica no encontrada"` (`leer.ts:18`, `eliminar.ts:46`, `aprobar.ts:73`, `reintentar-feedback.ts:41`, `ver-transcripcion.ts:38`, `audio.ts:122,159`). Una sola constante.

**H12. `obtenerDashboard` hace una consulta de más.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
`obtener-dashboard.ts:84-90` (`turno.count`) usa el mismo `where` que `:100-113` (`turno.findMany`): `sesionesHoyCount` es `sesionesHoyRows.length`.

**H13. La deuda se calcula dos veces por pedido a `/api/dashboard`.** Riesgo **bajo**, esfuerzo **S**. VERIFICADO.
- `obtener-dashboard.ts:145` llama a `deudoresDeHoy`, y `pendientes-terapeuta.ts:169` lo vuelve a llamar dentro de `deudaDeHoy`.
- `masAntiguoPorPaciente` corre dos veces dentro de `deudaDeHoy` (`:127` y `:170`).
- `calcularDeudores` ya calcula el impago más antiguo (`domain.ts:292-314`) y lo descarta.

Propuesta: que `calcularDeudores` devuelva también `impagoMasAntiguo`, y que `obtenerDashboard` use `pendientes.deudores`. `deudaDeHoy` hoy no lo devuelve: habría que agregarlo.

### 5. Abstracciones sin segundo uso

| abstracción | consumidores de producción | veredicto | V/H |
|---|---|---|---|
| `requirePaciente` (`_lib/pacientes.ts:14`) | 1 (`documentacion/route.ts:67`) | Unificar con los otros seis guards (H16) | VERIFICADO |
| Parámetros `adjuntos` (`trabajos/entregar.ts:69,77`) y `aplicadores` (`trabajos/resultado-worker.ts:89,97`) | 0: solo los pasa `feedback-trabajos.test.ts:216,219` | CONSERVAR: son el doble de test para el 501 | VERIFICADO |
| `RepositorioRegistro` / `RepositorioRecuperacion` | 1 implementación cada una (`src/lib/cuenta-registro-db.ts` y su par) | CONSERVAR: separan Prisma del caso de uso y los tests doblan el repositorio | VERIFICADO |
| `AlmacenAudio`, `AdaptadorBorradoR2`, `LectorAgenda` | 1 implementación cada una (`src/lib/r2.ts`, Prisma) | CONSERVAR: mismo motivo | VERIFICADO |
| `hilo-http.ts` (`autorizarEdicionHilo`) | 5 rutas | CONSERVAR | VERIFICADO |
| `ClienteSesion` / `ClienteTransaccional` / `ClienteHilo` / `BaseHilo` / `ClienteEnvios` | Varios | CONSERVAR: son `Pick` de Prisma para aceptar `tx` | VERIFICADO |

### 6. Tests de dominio

Casos de uso de la zona **sin ningún test que los nombre** (busqué con `command grep -rlw` en `*.test.ts(x)`): VERIFICADO.
- `aSenalDeRiesgo` (`obtener-dashboard.ts:34`). Es justo la lectura que no normaliza (H14).
- `leerEstadoWorker` y `verificarBase` (`operacion.ts`), aunque son triviales.
- `normalizarFeedback` y `esRiesgoDetectadoValido` (`lib/sesion-clinica/normalizar.ts`). `normalizarRiesgo` aparece solo en `agenda-del-dia.test.tsx`.
- `fuenteAuditoria`, `obtenerDashboard`, `aplicarCallbackTwilio`, `adjuntoContexto` y `aplicarPropuesta` no se nombran en ningún test. Pero los cubren tests de rutas: `pendientes-terapeuta.test.ts` sobre `/api/dashboard`, `sms-callback.test.ts`, y `hilo-integracion.test.ts` vía `entregarTrabajos`. Eso es HIPÓTESIS: no seguí cada llamada.

Reglas sin test que ate sus dos copias:
- **H1:** ningún test compara `clavesDeRiesgo` ni `exigeConfirmarMenciones` con lo que exige `aprobar.ts`. `aprobar.test.ts` no prueba el nivel `bajo`. VERIFICADO.
- **H3 y H4:** ninguna de las copias está atada a un test.
- Contraejemplo bien hecho: `hayMaterial` y `HAY_MATERIAL` (`reprocesar.ts:23-43`) sí están atadas por un test (`pendientes-terapeuta.test.ts` importa las dos).

Tests que solo repiten la implementación: en la zona no encontré casos nuevos. Muestreé `POLITICA_POR_TIPO`, `TOPE_NOTAS_FALLIDAS`, `MENSAJE_GRABAR_OTRO_DIA` y `HORIZONTE_MESES`, y las aserciones son de comportamiento.

Queda un comentario viejo en un test: `src/lib/__tests__/aprobar.test.ts:3,75` todavía dice "destruye la clave". VERIFICADO.

---

## (c) VERIFICADO contra HIPÓTESIS

| hallazgo | estado |
|---|---|
| H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H12, H13, H15, H16, H17, H18, H19, H20, H21, H22, H23, H25, H26, H29, H32, H33 | **VERIFICADO**: leí las líneas en `8f2047b` y corrí los grep citados |
| H11 | Código **VERIFICADO**; que los tres números coincidan hoy es **HIPÓTESIS** (no ejecuté las consultas) |
| H14 | Código **VERIFICADO**; que haya algún `nivel` inválido en la base es **HIPÓTESIS** |
| H27 `uso` | Que nada en `src` ni `scripts` lo lee está **VERIFICADO**; si hay un reporte fuera del repo es **HIPÓTESIS** |
| H27 `asr_transcript_id`, `audio_*`, `esHuerfana` | **VERIFICADO** |
| §6, cobertura indirecta vía rutas | **HIPÓTESIS**: no seguí cada llamada del test |
| Métricas de (a) | **VERIFICADO**: script sobre el AST. Los `if` de funciones anidadas no se suman a la de afuera |

---

## (d) Los 10 primeros por valor/esfuerzo

| # | hallazgo | riesgo | esfuerzo | por qué primero |
|---|---|---|---|---|
| 1 | **H1** Confirmaciones para aprobar: una función pura para servidor y pantalla | alto | M | Control clínico que hoy solo aplica el cliente, y ya diverge (nivel `bajo`, flags) |
| 2 | **H5** `auditarHilo` e `iniciarSesion` por `auditar`/`registrarAuditoria` | medio | S | Cierra la única puerta de auditoría sin `detalleSeguro` |
| 3 | **H6** Catálogo de acciones de auditoría | medio | S | La franja de "nota lista" y la métrica dependen de un texto escrito en otro archivo |
| 4 | **H4** `ESTADOS_GRABABLES` y `sePuedeGrabar` en la ficha | medio | S | Seis copias; la ficha reimplementa la regla entera |
| 5 | **H3** `ESTADOS_EN_PROCESO` | medio | S | Ocho copias; un estado nuevo obliga a tocar ocho lugares |
| 6 | **H14** Normalizar el riesgo del día | bajo-medio | S | Dos líneas; la única lectura clínica sin normalizar |
| 7 | **H26** Campos constantes del brief | bajo-medio | S | Un aviso de "nota sin aprobar" que no puede verse nunca |
| 8 | **H12 + H13** Dashboard: una consulta y un cálculo de deuda de más | bajo | S | Menos trabajo por cada carga de Hoy, sin cambio visible |
| 9 | **H8** `eliminar` por `whereTransicion` y `exigirEstado` derivada | bajo | S | Termina de poner la máquina de estados en un solo lugar |
| 10 | **H2** `puede(op, estado)` en las pantallas | medio | M | Hace verdadera la cabecera de `estados.ts`; conviene después de H3 |

Siguen en valor, pero cuestan más: H20 (`decidirEdicionTurno`, M), H19 (`despachar-sms`, M) y H7 (auditoría en rutas, M, compartido con el panel de rutas).

---

## (e) Estado de los hallazgos de `~/forense-sesion/01-app.md` (24-sep, `7f016ec`)

Un agente de solo lectura cruzó cada ítem del informe viejo con el main actual, buscando por símbolo o por texto (entre los dos commits hay 80 commits). Reverifiqué cinco de sus afirmaciones más fuertes: `APROBAR_MENSAJE` corregido, `formatPhoneDisplay` sin uso, el orden de `/api/deudores`, que `session-row` no incluye `fallida` y que `SesionHuerfanaBanner.tsx` fue borrado. Las cinco se confirmaron.

**Conteo:** 94 RESUELTOS, 5 CAMBIARON, 50 VIVOS y 1 NO CONFIRMADO (§8, "todas las demás"). De los 50 vivos, 10 son filas que 01-app mandaba CONSERVAR. Quedan **40 defectos vivos de verdad**. La tanda de limpieza (`3d87db4` "Limpieza 4" y sus vecinos) cerró casi todo §1, §3, §5.2-5.4 y §6.

### Siguen VIVOS (defectos)

| sección 01-app | ítem | evidencia hoy (`8f2047b`) | cruce con este informe |
|---|---|---|---|
| Top-4 / §2 | El mismo turno con otro color según la pantalla | `session-row.tsx:119` (neutral) contra `turno-detail-sheet.tsx:120` (gold); ausente en `turnos-pagos-tab.tsx:71`; "Cancelado" a mano en `:61` | — |
| Top-4 / §2 | Deudores ordenados de 3 formas | `api/deudores/route.ts:52-56` (días de atraso), `cobros-view.tsx:231` (monto), `domain.ts:322` (monto), `lib/orden-deuda.ts` (monto y antigüedad) | toca `domain.ts` (lote L3) |
| Top-3 / §7 | 3 selectores de método de pago y 4 POST a `/cobrar` | `sheet-metodo-pago.tsx:19`, `turno-detail-sheet.tsx:538`, `turnos-pagos-tab.tsx:469` y `:80` | — |
| §1.3 / §2 | `parseTurno` ×4 | `(d)/_components/datos.ts:59`, `cobros-view.tsx:124`, `agenda-view.tsx:68`, `json-ficha.ts:40` | — |
| §2 | "Nota guardada" contra "Nota lista" | `sesiones-tab.tsx:140-153` (`chipDeEstado`) no usa `estadoClinicoDe` | — |
| §2 | Estado fantasma "transcribiendo" | `session-row.tsx:85` (ahora con comentario de alias viejo) | — |
| §2 | "En proceso" copiado | ver **H3**; además `session-row.tsx` define su propio `ESTADOS_PROCESANDO` (`:110`) | **H3** |
| §2 | La fila ofrece Grabar con la sesión `fallida` | `session-row.tsx:109-113` (`ESTADOS_PASADA_LA_GRABACION` sin `fallida`) contra `audio.ts:92` (409); `grabar-view.tsx:87` `ADMITE_AUDIO` aparte | **H2** (`puede`) |
| §2 | `["programado","realizado"]` | ver **H4** | **H4** |
| §2 | Métodos de pago ×2 | `constantes-turno.ts:46` contra `glosario.ts:495-498` | — |
| §2 | Duración y modalidad por defecto | `grabar-view.tsx:83,286` | — |
| §2 | "Presencial"/"Online" ×6 | `turno-editar-campos.tsx:48`, `turnos-pagos-tab.tsx:53`, `session-row.tsx:232`, `sesiones-tab.tsx:445`, `card-ahora.tsx:226`, `turno-detail-sheet.tsx:359` | — |
| §2 / §4.1 | `RECORDATORIO_ESTADO` sin uso, con copia literal | `glosario.ts:305` y `turno-detail-sheet.tsx:395` | — |
| §2 | Días de la semana ×3 | `month-view.tsx:23`, `week-view.tsx:17`, `agenda/_components/textos.ts:6` | — |
| §2 | `horaCorta` sin zona Montevideo | `glosario.ts:371-372` | — |
| §2 | Tarifa `> 0` contra `≥ 0` | `schemas.ts:96` contra `:194`; `config-view.tsx:112-122,505` | zona: `schemas.ts` |
| §2 | Alta de paciente a mano en el formulario de turno | `nuevo-turno-form.tsx:351-357` | — |
| §2 | 3 títulos para la confirmación de cobro | ver selectores | — |
| §2 | Sondeo: 20 s contra un 10 000 literal | `avisos-notas.ts:90` contra `useSesionClinicaPolling.ts:139` | lote L1 |
| §4.1 | `SENALES_ANTERIORES` sin uso; el texto está a mano | `glosario.ts:190`; `HiloEditor.tsx:52`, `HiloContenido.tsx:47` | — |
| §4.1 | `CARGANDO` sin uso; 8 "Cargando…" a mano | `glosario.ts:1016` | — |
| §4.2 | Textos a mano con constante (Reintentar, Guardando…, Volver, Cobrar, nombre del producto) | muestra de 5: todos siguen | — |
| §5.2 | Tests que leen fuentes con `toContain` | `ayuda-corpus-codigo.test.ts:76-99`, `ayuda-vigente`, `consentimiento`, `ayuda-agenda` | — |
| §5.2 | `limites-prueba-integracion` lee el texto de una ruta | `:49,54` | — |
| §5.4 | `hoy-solapamiento` mockea el formulario | `hoy-solapamiento.test.tsx:34-49` | — |
| §6 | `formatPhoneDisplay` sin uso; el teléfono se muestra crudo | `phone.ts:25`; `ficha-tab.tsx:102`, `pacientes-view.tsx:397`, `cobros-view.tsx:736` | — |
| §6 | `tope: 20` a mano en la política de trabajos | `trabajos/politica.ts:22,26` contra `consentimiento-hechos` (atados solo por test) | lote L4 |
| §7 | Tres lectores de la nota | `sesion-detail-view.tsx:173-189,201,207-223` | lote L2 |
| §7 | Dos sondeos en la ficha | `paciente-detail-view.tsx:221,231` | — |
| §7 | Dos briefs con tipo y `hayRiesgo` copiados | `brief-corto.tsx:74,251` contra `brief-pre-sesion.tsx:66,133` | **H26** (mismos archivos) |
| §7 | `EstadoVacio` duplicado, **ahora ×3** | `day-view.tsx:81`, `cobros-view.tsx:969`, `finanzas-view.tsx:282` | — |
| §7 | `EmptyState`/`ErrorState` repetidos | `pacientes-view.tsx:328,512`, `graficos/contenedor.tsx:240,272`, `HotWordsManager.tsx:656` (contenido sin comparar) | — |
| §7 | 11 componentes de más de 450 líneas | cobros-view 1016 (sigue pidiendo `/api/dashboard` en `:146`), config-view 1008, grabar-view 917… | — |
| §7 | Dos arneses del grabador; `vite` sin declarar | `pruebas/grabador-dhh/verificar.mjs:15` | — |
| §8 | `postcss` y `vite` sin declarar en `package.json` | llegan como transitivas | — |

### CAMBIARON (resuelto en parte)

- **Top-3 (cobrar):** la regla se unificó en `sePuedeCobrar`, que usan el servidor y todas las pantallas. Siguen los tres selectores (fila de arriba).
- **§1.1 `ACCION_VER_SESION`:** sigue sin uso en producción. Ahora lo lee un test (`consentimiento.test.ts:211`).
- **§2 rótulo del estado clínico:** `card-ahora` y `turno-detail-sheet` ya usan `estadoClinicoDe`. `sesiones-tab` no.
- **§5.4 `duracion-navegacion`:** esa tautología se fue, pero quedó otra (`:85-88` contra `movimiento.tsx:15-16`).
- **§7 agendar:** Agenda usa `payloadNuevoTurno`, pero con `NuevoTurnoForm` y no con `SheetNuevoTurno`. Grabar sigue armando el body a mano (`grabar-view.tsx:282`).

### RESUELTOS (94)

- **Top:** `APROBAR_MENSAJE` falso, `esHuerfana` sin llamador (cableada, con umbral de 7 días), cifrado de audio muerto, `falloDetalle` crudo en pantalla, archivar sin cancelar SMS.
- **§1.1:** los 10 ítems (`CODIGO_GRABACION_ABANDONADA` se cableó en vez de borrarse).
- **§1.2:** los 4 archivos. **§1.3:** todos, menos `parseTurno`.
- **§2:** qué turno se puede cobrar, grabar solo el día del turno, `ESTADOS_EN_PIPELINE`. Ojo: `paciente-detail-view.tsx:202-203` repite `sePuedeGrabar` a mano; lo retomo en **H4**.
- **§3:** todos los comentarios y los dos textos visibles.
- **§4.1:** 21 de las 26 constantes. `SESION_FALLO_LABEL` se cableó.
- **§5.2:** 7 de 10. **§5.3:** los 2 mocks. **§5.4:** 4 de 6.
- **§6:** 9 de 13 (4 eran CONSERVAR). **§7:** acciones muertas de `useGrabacionSesion`. **§8:** `@types/bcryptjs`.

Las 10 filas que 01-app mandaba CONSERVAR siguen igual, a propósito.

---

## (f) Mapa de archivos

### Qué toca cada propuesta

Rutas cortas: `_lib/` = `src/app/api/_lib/`, `cu/` = `src/app/api/_lib/casos-uso/`, `(d)/` = `src/app/(dashboard)/`.

| propuesta | archivos |
|---|---|
| H1 + H15 + H22 | `src/lib/sesion-clinica/aprobacion.ts` (nuevo), `src/lib/sesion-clinica/normalizar.ts`, `cu/sesion/aprobar.ts`, `cu/hilo/brief.ts`, `cu/progreso-clinico.ts`, `src/components/clinico/MencionesNota.tsx`, `src/components/grabacion/RiesgoDetectadoBanner.tsx`, `(d)/sesiones/[id]/_components/sesion-detail-view.tsx`, `src/lib/__tests__/aprobar.test.ts` |
| H2 | `src/lib/sesion-clinica/estados.ts`, `(d)/sesiones/[id]/_components/sesion-detail-view.tsx`, `(d)/pacientes/[id]/_components/sesiones-tab.tsx`, `(d)/_components/card-ahora.tsx`, `src/components/ui/session-row.tsx` |
| H3 | `src/lib/sesion-clinica/estados.ts`, `src/lib/notas-en-proceso.ts`, `cu/avisos-notas.ts`, `sesion-detail-view.tsx`, `sesiones-tab.tsx`, `card-ahora.tsx`, `(d)/agenda/_components/turno-detail-sheet.tsx` |
| H4 | `_lib/domain.ts`, `src/lib/constantes-turno.ts`, `cu/audio.ts`, `cu/pendientes-terapeuta.ts`, `cu/solapamiento-turnos.ts`, `cu/turnos.ts` (import de `ESTADOS_QUE_OCUPAN`), `(d)/pacientes/[id]/_components/paciente-detail-view.tsx`, `turno-detail-sheet.tsx` |
| H5 | `cu/hilo/base.ts`, `cu/iniciar-sesion.ts` |
| H6 | `_lib/auditoria-pura.ts` (catálogo) y, en cada emisor o lector: `cu/avisos-notas.ts`, `cu/auditoria-metricas.ts`, `cu/sesion/*.ts`, `cu/recordar-cobro.ts`, `cu/pacientes.ts`, `cu/consentimiento.ts`, `cu/iniciar-sesion.ts`, `cu/hilo/base.ts`, `cu/responder-ayuda.ts`, y las rutas de `api/sesion-clinica/**`, `api/pacientes/[id]/documentacion`, `api/cuenta/**` y `api/ayuda` |
| H7 | `cu/audio.ts`, `api/sesion-clinica/route.ts`, `api/sesion-clinica/[id]/route.ts`, `api/sesion-clinica/[id]/upload-url/route.ts`, `api/sesion-clinica/[id]/upload-confirmar/route.ts`, `api/sesion-clinica/[id]/volver-a-grabar/route.ts`, `api/pacientes/[id]/documentacion/route.ts` |
| H8 + H21 + H29 | `src/lib/sesion-clinica/estados.ts`, `cu/sesion/transicion.ts`, `cu/sesion/leer.ts`, `cu/sesion/eliminar.ts`, `cu/sesion/resultado.ts`, `cu/sesion/aprobar.ts` (solo la pre-lectura), `cu/audio.ts` (solo las pre-lecturas, `:122-130` y `:159-160`) |
| H9 (payload de `borrar_audio_r2`) | `cu/trabajos/crear.ts` (helper), `cu/trabajos/ejecutar-borrado-r2.ts` y, en los llamadores: `cu/sesion/aprobar.ts`, `cu/sesion/eliminar.ts`, `cu/sesion/abandonar.ts`, `cu/audio.ts` |
| H10 + H13 | `_lib/domain.ts`, `cu/recordar-cobro.ts`, `cu/texto-de-cobro.ts`, `cu/pendientes-terapeuta.ts`, `cu/obtener-dashboard.ts` |
| H11 + H12 + H14 | `cu/obtener-dashboard.ts`, `cu/turnos.ts` (`cobrosDelMes`), `cu/finanzas.ts` |
| H16 | `_lib/pacientes.ts`, `cu/hilo/base.ts`, `cu/consentimiento.ts`, `cu/crear-turno.ts`, `cu/recordar-cobro.ts`, `cu/hilo/exportar.ts` |
| H17 | `src/lib/constantes-turno.ts` (o un módulo nuevo en `lib`), `_lib/schemas.ts`, `src/types/domain.ts`, `cu/sesion/reclamar.ts`, `cu/trabajos/entregar.ts` |
| H18 + H19 | `cu/despachar-sms.ts`, `cu/envios-del-turno.ts`, `cu/sms-webhooks.ts` |
| H20 | `_lib/domain.ts`, `cu/turnos.ts`, `cu/cobrar-turno.ts` (solo si también usa la tabla) |
| H23 | `cu/sesion/reclamar.ts`, `cu/trabajos/reclamar.ts` |
| H25 | `cu/hilo/{base,brief,exportar,leer,trabajo,regenerar,escribir}.ts`, `src/lib/hilo/` (tabla nueva) |
| H26 | `cu/hilo/brief.ts`, `src/components/clinico/brief-corto.tsx`, `(d)/pacientes/[id]/_components/brief-pre-sesion.tsx` |
| H27 | `prisma/schema.prisma` y una migración (columnas), `cu/sesion/registrar-asr.ts`, `cu/sesion/registrar-transcripcion.ts`, `src/lib/sesion-clinica/estados.ts` (`esHuerfana`), `cu/mantenimiento.ts`, `cu/operacion.ts`, `_lib/tickets.ts`, `cu/hot-words.ts`, `cu/finanzas.ts`, `cu/trabajos/ejecutar-borrado-r2.ts` |
| H32 + H33 | `_lib/domain.ts`, `cu/pacientes.ts`, `cu/iniciar-sesion.ts`, `cu/registrar-cuenta.ts`, `cu/recuperar-cuenta.ts` |

### Reparto en lotes sin pisarse

Cada archivo compartido tiene **un solo dueño**. Los otros lotes esperan a que ese dueño integre.

| lote | propuestas | archivos que son SUYOS | depende de |
|---|---|---|---|
| **L1 · Estados de sesión** | H2 (salvo `sesion-detail-view`), H3, H8, H21, H29, esHuerfana (H27) | `src/lib/sesion-clinica/estados.ts`, `src/lib/notas-en-proceso.ts`, `cu/sesion/{transicion,leer,eliminar,resultado}.ts`, `cu/avisos-notas.ts`, `session-row.tsx`, `card-ahora.tsx`, `sesiones-tab.tsx` | — (va primero: exporta `puede` y `ESTADOS_EN_PROCESO`) |
| **L2 · Aprobación** | H1, H15, H22, y H2 y H3 **dentro de** `sesion-detail-view` | `src/lib/sesion-clinica/{aprobacion,normalizar}.ts`, `cu/sesion/aprobar.ts`, `cu/hilo/brief.ts`, `cu/progreso-clinico.ts`, `MencionesNota.tsx`, `RiesgoDetectadoBanner.tsx`, `sesion-detail-view.tsx`, `aprobar.test.ts`, más H26 (`brief-corto.tsx`, `brief-pre-sesion.tsx`) | L1, por `puede` y `ESTADOS_EN_PROCESO` |
| **L3 · Turnos, deuda y Hoy** | H4, H10, H11, H12, H13, H14, H20, H32, y H8 en `audio.ts` | `_lib/domain.ts`, `src/lib/constantes-turno.ts`, `cu/{audio,turnos,cobrar-turno,solapamiento-turnos,pendientes-terapeuta,obtener-dashboard,recordar-cobro,texto-de-cobro,pacientes,finanzas}.ts`, `paciente-detail-view.tsx`, `turno-detail-sheet.tsx` (incluida la línea de H3) | L1, solo para `turno-detail-sheet:242` |
| **L4 · Trabajos, SMS y hilo** | H9 (helper y `ejecutar-borrado-r2`), H17, H18, H19, H23, H25, restos de H27 en `tickets`, `hot-words`, `operacion` y `mantenimiento` | `cu/trabajos/**`, `cu/despachar-sms.ts`, `cu/envios-del-turno.ts`, `cu/sms-webhooks.ts`, `cu/sesion/reclamar.ts`, `cu/hilo/{base,exportar,leer,trabajo,regenerar,escribir}.ts`, `src/lib/hilo/`, `_lib/{schemas,tickets}.ts`, `src/types/domain.ts`, `cu/{hot-words,operacion,mantenimiento}.ts` | — (en paralelo con L1) |
| **L5 · Auditoría y guards transversales** | H5, H6, H7, H16, H33, y los llamadores de H9 (`aprobar`, `eliminar`, `abandonar`, `audio`) | `_lib/{auditoria,auditoria-pura,pacientes}.ts`, `cu/{iniciar-sesion,registrar-cuenta,recuperar-cuenta,consentimiento,crear-turno,auditoria-metricas,responder-ayuda}.ts`, `cu/sesion/abandonar.ts`, las rutas de `api/sesion-clinica/**`, `api/pacientes/[id]/documentacion`, `api/cuenta/**` y `api/ayuda` | **Último**: toca emisores de L1-L4. Las rutas se coordinan con el panel 02 |

Orden: **L1 y L4 en paralelo → L2 y L3 en paralelo → L5**. La migración de columnas (`asr_transcript_id`, `audio_clave_encrypted`, `audio_iv`) va aparte, con la marca DESTRUCTIVA y la decisión del dueño.

---

## Lo que no revisé

- No corrí ningún test ni la suite. Las afirmaciones de cobertura son por grep de nombres.
- No ejecuté las consultas de H11 contra una base: no sé si hoy los tres "cobrados" dan el mismo número.
- No revisé `src/lib/**` fuera de `sesion-clinica/` (por ejemplo `consentimiento.ts`, `fechas-montevideo.ts`, `sms/**`), salvo para confirmar un hallazgo.
- En la pantalla leí solo las líneas que confirman una copia de regla. No revisé los componentes enteros.
- `processor/` quedó fuera. Solo miré `enums-clinicos.json` (H17) y quién lee `asr_transcript_id` (H27).
- Encontré al pasar, fuera de la zona: `prisma/schema.prisma` dice en `ticketHash` que el ticket "vence con `leaseVenceEn`", y `_lib/tickets.ts:11-16` dice que "No vence por reloj". Uno de los dos comentarios miente. Por el código es el de `schema.prisma`: `autorizarTicketSesion` (`_lib/tickets.ts:77-80`) no mira el lease.
