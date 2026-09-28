# Forense 2 — Panel 3: pantallas

**Commit leído:** `main` = `8f2047b` (Merge origin/consentimiento-2-7), en `~/proyectos/sesion-arreglos`. `git status` quedó vacío antes y después: no se tocó nada.
**Zona:** `src/app/(dashboard)/**` y `src/app/(auth)/**`, con sus `_components`. `(d)` = `src/app/(dashboard)`.
**Fecha:** 28 de septiembre de 2026.

**Cómo se hizo:**
- El inventario se armó con un conteo mecánico por archivo: líneas, `useEffect(`, `useState`, `fetch(`, `useCallback` y `useMemo`.
- Para la duplicación se corrió `npx --yes jscpd "src/app/(dashboard)" --min-tokens 50 --reporters console --ignore "**/__tests__/**"`, con la salida en el scratchpad y nada instalado en el repo. Encontró 14 clones: 161 líneas, 0,99 %.
- La lectura en detalle la hicieron cuatro agentes de solo lectura, uno por grupo: Hoy+Agenda, Cobros+Finanzas, Pacientes+ficha y Sesión/Grabar/Config/Auth. Cada uno citó archivo:línea.
- Los hallazgos del top 10 y todos los que dicen "sigue vivo" los reverifiqué yo con `grep -n` y `sed -n` sobre 8f2047b. En una afirmación de un agente encontré un matiz que no se sostenía y lo corregí (ver §b-D6).
- No se corrió la suite ni el e2e.

**VERIFICADO** = leí las líneas o corrí el comando. **HIPÓTESIS** = el código está leído, pero el efecto en pantalla no se reprodujo.

**Premisa del encargo:** el patrón bueno es `(d)/_components/datos.ts` separado de `dashboard.tsx`. `datos.ts` no tiene React. Exporta una lectura pura, `leerHoy()` (`datos.ts:302-324`), y derivaciones puras (`repartirElDia`, `aplicarCobro`, `sesionesEnProceso`) que se prueban sin montar nada. El efecto de `dashboard.tsx:90-104` es solo el cable: `leerHoy().then(setEstado).catch(setFallo)` con cancelación. Después de Hoy, lo siguen a medias `card-ahora.tsx` (`leerContexto`) y `cobros-view.tsx` (`cargarCobros`, que vive adentro del componente). Las demás pantallas arman la URL, piden, parsean y hacen `setState` dentro del propio efecto.

---

## (a) Inventario por pantalla

Ninguna pantalla de la zona usa server actions (`"use server"` no aparece). Todo pasa por `@/lib/api-client` desde el cliente. Las únicas páginas que leen en el servidor son `(d)/page.tsx` (actor y estado de prueba) y `grabar/[turnoId]/page.tsx` (paciente, turno y consentimiento).

| Pantalla | Archivo principal (líneas) | Otros archivos propios | useState | useEffect | Llamadas a datos | Test de UI |
|---|---|---|---|---|---|---|
| **Hoy** | `_components/dashboard.tsx` (315) | `datos.ts` 357, `card-ahora.tsx` 340, `pendientes.tsx` 401, `agenda-del-dia` 121, `kpis` 79, `sheet-metodo-pago` 77, `sheet-nuevo-turno` 48, `estados-carga` 17, `saludo` 46, `titulo` 28 | 10 + 1 + 3 + 1 | 4 + 1 (card) | `leerHoy`: GET dashboard y config; GET pacientes y config al agendar; POST cobrar; POST turnos; GET sesión y brief en la card; POST abandonar | 10 archivos en `_components/__tests__` + `pendientes.test.tsx` |
| **Agenda** | `agenda/_components/agenda-view.tsx` (486) | `turno-detail-sheet.tsx` 678, `day/week/month-view` 120/149/149, `agenda-header` 137, `semana-tira` 64, `week-layout` 35 | 13 + 5 | 1 + 2 | GET turnos por rango; GET pacientes y config; POST turnos; en el detalle GET sesión y SMS, PATCH, 2 POST y DELETE | 9 archivos; el detalle está **mockeado** en `avisos-operaciones` |
| **Cobros** | `cobros/_components/cobros-view.tsx` (**1016**) | `tarjeta-finanzas` 116 | 12 + 1 | 2 + 1 | 5 GET al abrir (dashboard, deudores, turnos/cobros, config, finanzas/resumen); N POST cobrar en serie; POST recordar-cobro; GET de la ficha entera | 3 archivos |
| **Finanzas** | `finanzas/_components/finanzas-view.tsx` (323) | `bloques` 272, `barras` 152, `sheet-periodo` 177, `periodo.ts` 104 | 5 + 3 | 1 + 1 | GET resumen; GET turnos/cobros del mes | 5 archivos + fixture; es la pantalla más cubierta |
| **Pacientes (lista)** | `pacientes/_components/pacientes-view.tsx` (566) | `nuevo-paciente-form` 190 | 12 + 1 | 2 | GET pacientes; GET config (sin abort); PATCH activo; POST alta | 1 archivo (tarifa) |
| **Ficha** | `pacientes/[id]/_components/paciente-detail-view.tsx` (377) | `sesiones-tab` 684, `turnos-pagos-tab` 502, `ficha-tab` 384, `brief-pre-sesion` 323, `cabecera-ficha` 139, `editar-paciente-form` 141, `recorrido-tab` 50, `progreso-lecturas.ts` 273, `json-ficha.ts` 48, `graficos/*` (base 513, contenedor 383, más 7 chicos) | 7 + 5 + 6 + 8 + 2 + 3 | 4 + 2 + 0 + 1 + 2 + 1 (+1 en medidas) | GET ficha, config y consentimiento; GET documentación p1 y pN; POST y DELETE cobrar; PATCH notas y activo; GET brief; GET progreso. El Badge de consentimiento pide lo suyo aparte | 5 + 1 archivos; `FichaTab`, `CobrarSheet` y `ConsentimientoBadge` están **mockeados** |
| **Grabar** | `grabar/[turnoId]/_components/grabar-view.tsx` (**917**) | `medidor-audio` 59, `page.tsx` 114 (servidor) | 7 | 1 | GET y POST sesion-clinica; POST turnos; subirAudio; marcarTurnoRealizado; volverAGrabando | 2 archivos |
| **Sesión (nota)** | `sesiones/[id]/_components/sesion-detail-view.tsx` (654) | `transcripcion-view` 395, `mas-de-esta-sesion` 257, `nota-sesion-view` 164, `seccion-soap` 135, `barra-acciones` 121, `selector-vista` 107, `para-vos-view` 90, `textos.ts` 114, `transcripcion.ts` 103, `plegable.tsx` 3 | 16 + 4 + 2 + 1 + 1 | 3 + 2 + 1, más `useSesionClinicaPolling` | GET de la sesión en 4 lugares; POST aprobar, reprocesar, reintentar, eliminar y feedback; GET transcripción | 6 archivos |
| **Config** | `config/_components/config-view.tsx` (**1008**) | `editor-recordatorio` 253, `invitar-colega` 45, `mensaje-recordatorio` 61, `vocabulario-seccion` 52, `titulo-seccion` 17 | 16 + 1 + 5 + 1 | 4 + 1 | GET config; PATCH con debounce; `fetch` keepalive en `pagehide`; POST password y salir-todas; GET y POST invitaciones | 3 archivos |
| **Auth** | `login/page.tsx` (113) | `registro-form` 53, `restablecer-form` 40, `recuperar/page` 28, `portada` 99, `presencia` 78, `lupita-portada` 53, `entrada-marco` 21 | 4 + 4 + 4 + 4 + 1 | 1 + 1 | POST entrar, registro, recuperar y restablecer; `fetch` a limpiar | `login` (9), `portada-movimiento` (7), `recuperacion` (4), `registro` (7) |

**Totales de la zona** (contados sin tests): 34 `useEffect` en las pantallas, más 1 en `graficos/medidas.ts`. Cuatro archivos pasan de 900 líneas: `cobros-view` 1016, `config-view` 1008, `grabar-view` 917 y `turno-detail-sheet` 678 (este último, cerca). Otros diez pasan de 300.

---

## (b) Hallazgos

Esfuerzo: **S** = una tarde, **M** = uno o dos días, **L** = más. Están agrupados por las preguntas del encargo. Numeración P3-nn.

### 1. Componentes gigantes y mezcla de estado, presentación y datos

**P3-01 — `cobros-view.tsx` (1016) tiene cinco componentes, tres de ellos con mutaciones propias.** VERIFICADO. **M**
- Mapa del archivo:
  - 103-163: tipos más `cargarCobros()`, una lectura pura que ya existe pero vive adentro del componente.
  - 165-293: `CobrosView` (carga, toast, pestaña y orden de deudores).
  - 415-560: `TeDeben` (el bucle de cobro 458-479 y `alCerrarMetodo` 481-501).
  - 581-750: `FilaDeudor` (POST recordar-cobro).
  - 752-890: `RegistrarPago` (GET de la ficha entera y el filtro de deuda).
  - 909-959: `CobrosDelMes`.
  - 961-1012: `EstadoVacio`.
- Corte mínimo:
  - `cobros/_components/datos.ts` con `cargarCobros`, `leerSesionesImpagas`, `cobrarSesiones` y una función pura `desenlaceDelCobro(resultado)` que reemplace el árbol de 481-501.
  - `registrar-pago.tsx`, `fila-deudor.tsx` y `te-deben.tsx`.
  - `EstadoVacio` y `ListaCobros` pasan a compartidos.
- Queda en unas 250 líneas. Lo cubren los tests existentes.

**P3-02 — `config-view.tsx` (1008) tiene un motor de autoguardado a mano y cinco componentes.** VERIFICADO. **M**
- Mapa del archivo:
  - 166-392: autoguardado (7 refs, debounce de 1,5 s, cola en vuelo, `pagehide` keepalive en 329-345, guardado al desmontar en 316-325).
  - 640-764: `CambiarPassword`.
  - 774-818: `CerrarOtrasSesiones`.
  - 862-925: `SelectorEnfoque`.
  - 935-1008: `CuandoAvisar`.
- Corte mínimo:
  - `useAutoguardado` (166-392, la parte que ya prueba `config-firme`).
  - `cuenta-seccion.tsx`.
  - `OpcionesRadio<T>` para los dos selectores, que tienen el mismo markup.
- `vocabulario-seccion.tsx:6-9` ya lo pide en un comentario.

**P3-03 — `grabar-view.tsx` (917): orquestación de API, máquina de fases y siete pantallas en un solo archivo.** VERIFICADO. **M**
- Mapa del archivo:
  - 120-376: `GrabarView`, con `subir` 147-201, `asegurarSesion` 251-272, `empezar` 274-312 y los reintentos 343-371.
  - 378-479: JSX, con 6 ternarios en cadena en 404-469.
  - 482-917: siete `Pantalla*`.
- Corte mínimo:
  - `flujo-grabacion.ts` con `useFlujoGrabacion()`, que contiene 147-371.
  - `pantallas.tsx`.
- Los tests mockean las mismas fronteras (`api-client`, `useGrabacionSesion`), así que no cambian.

**P3-04 — `sesion-detail-view.tsx` (654): 16 `useState`, 3 efectos, un poller más y 7 llamadas a la API.** VERIFICADO. **M**
- Corte mínimo:
  - `sesiones/[id]/_components/datos.ts` con `leerSesion`, `notaDeSesion`, `mismaNota`, `versionDe` y `motivoBloqueo`, que hoy son 87-119 y 249-259.
  - `useRevisionNota()` con la edición, la revisión, el conflicto y aprobar (133-137, 262-324).
  - `useParaVos()` con 156-158 y 207-241.

**P3-05 — `turno-detail-sheet.tsx` (678) y `agenda-view.tsx` (486) piden los datos dentro del efecto.** VERIFICADO. **M**
- `turno-detail-sheet.tsx` tiene 2 lecturas (160-194), 5 mutaciones (270-309), un formulario RHF y 7 modos (354-650).
- `agenda-view.tsx` tiene 13 `useState`, una caché de rangos (162), la lectura en 169-210, `handlePrev` y `handleNext` idénticos salvo el signo (236-247 y 248-259) y la creación de turnos (305-320).
- Corte mínimo:
  - `agenda/_components/datos.ts` con `computeRange`, `leerTurnos(range, signal)` y `moverAncla`.
  - En el detalle, `leerSesion` y `leerRecordatorio` puras, más `accionesDelDetalle(turno, sesion, ahora)`, que reemplaza 217-243.

**P3-06 — `sesiones-tab.tsx` (684), `turnos-pagos-tab.tsx` (502), `pacientes-view.tsx` (566) y `graficos/base.tsx` (513).** VERIFICADO. **M**
- `sesiones-tab.tsx`:
  - Pasa a `sesiones-datos.ts` lo que hoy es 64-210, más un `leerDocumentacion` puro.
  - Pasa a `filas-sesion.tsx` lo que hoy es 422-684.
  - Queda en unas 200 líneas.
- `turnos-pagos-tab.tsx`:
  - `cobrar-sheet.tsx` junta 75-96 (un cliente HTTP propio), 187-243 y 448-502. Después se fusiona con `SheetMetodoPago` (P3-17).
  - Hoy `sesiones-tab` importa de otra pestaña (`:62`). Con este corte deja de hacerlo.
- `pacientes-view.tsx`: `pacientes-datos.ts` (37-84) y `lista-pacientes.tsx` (350-566).
- `graficos/base.tsx`:
  - `progreso-contrato.ts` sin `"use client"` (42-140 y 507-513).
  - `ejes.tsx`: `EjeY` en 281-302 ≈ 420-441 y `EjeX` en 349-362 ≈ 470-485 son la misma pieza.
  - Los colores `#E8E1D2` y `#627072` están a mano en 288, 296, 427 y 435.

**P3-07 — Las pantallas de sesión y de config no leen nada en el servidor, y cada cambio de vista vuelve a montar la sesión.** VERIFICADO (código). **M**
- `sesiones/[id]/page.tsx`, `para-vos/page.tsx`, `transcripcion/page.tsx` y `config/page.tsx` solo montan la vista cliente.
- Las tres vistas de la sesión montan componentes distintos (`selector-vista.tsx:73-75`). Por eso, al cambiar de cara se vuelve a pedir la fila, y la transcripción espera a la sesión antes de pedirse (dos esperas en cascada).
- Propuesta: un `layout.tsx` en `sesiones/[id]` que mantenga el contenedor montado, o leer la fila en el servidor como hace `grabar/[turnoId]/page.tsx`. **Antes hay que leer `node_modules/next/dist/docs/` (Next 16).**

### 2. Lógica de negocio en la UI que el servidor ya decide

**P3-08 — Tres reglas distintas de "grabar / procesando" para el mismo turno en fila, card y detalle.** VERIFICADO (código); lo que ve la profesional es HIPÓTESIS. **M**
- La fila (`src/components/ui/session-row.tsx:109-113,155-160`) oculta Grabar solo con procesando, "transcribiendo", revision y aprobada. Con `subiendo` reciente o con `fallida`, `grabable` sigue en true y ofrece **Grabar sesión**.
- La card de Ahora (`card-ahora.tsx:123-138`) trata `fallida` como "Ver qué pasó" y `subiendo` o `procesando` como "escribiendo", sin Grabar.
- El detalle de Agenda (`turno-detail-sheet.tsx:240-242,459-477`) no ofrece Grabar con cualquier sesión presente.
- `"transcribiendo"` (`session-row.tsx:85`) no es un estado del enum (`prisma/schema.prisma:574-581`).
- En Hoy, el mismo turno aparece arriba en la card y abajo en la fila. Con una subida en curso, arriba dice "Procesando" y abajo ofrece Grabar.
- Qué usar:
  - una función pura `accionClinicaDe(sesion, turno, ahora)` en `lib/sesion-clinica/`, apoyada en `ESTADOS_EN_PIPELINE` y `ESTADOS_SIN_TERMINAR` (`estados.ts:126,256`);
  - o exportar `accionDe` de la card y hacer que la fila y el detalle la llamen;
  - más un test de matriz fila = card = detalle por estado.

**P3-09 — Hoy congela `ahora`: Cobrar no aparece al pasar la hora.** VERIFICADO. **S**
- `ahora` se crea una sola vez en `leerHoy` (`datos.ts:322`: `ahora: new Date()`).
- En `(d)/_components/*` no hay `setInterval`, ni `visibilitychange`, ni `useHoy` (grep vacío). Agenda sí usa `useHoy` (`agenda-view.tsx:124`).
- `sePuedeCobrar(ahoraTurno, ahora)` (`datos.ts:147`) no se reevalúa. Con Hoy abierto, el turno de las 10:00 sigue diciendo "Enseguida" a las 10:30 y no ofrece Cobrar. Al día siguiente muestra el día anterior.
- Propuesta: un tic de 1 minuto que actualice solo `ahora`, y una recarga en `visibilitychange`.

**P3-10 — La card de Ahora puede mostrar a una paciente marcada "No vino".** VERIFICADO. **S**
- `repartirElDia` (`datos.ts:127-133`) elige `abierto` y `ahoraTurno` solo por hora, sin mirar `estado`.
- El servidor filtra `cancelado` pero no `ausente` (`obtener-dashboard.ts:88,104`).
- Propuesta: excluir `ausente` al elegir, o elegir por `sePuedeGrabar || sePuedeCobrar`.

**P3-11 — Grabar: la página no usa `sePuedeGrabar` y la subida trata cualquier error como reintentable.** VERIFICADO (código); el escenario de campo del segundo punto es HIPÓTESIS. **S**
- `grabar/[turnoId]/page.tsx:86-113` lee `estado` y `fecha`, pero solo calcula `turnoProgramado`. Con un turno de otro día o cancelado muestra el botón grande. El servidor lo rechaza recién al tocar (`audio.ts:95`, `MENSAJE_GRABAR_OTRO_DIA`) y la pantalla vuelve a ofrecer el mismo botón.
- `grabar-view.tsx:188-195`: el `catch` de la subida siempre pone `AUDIO_NO_GUARDADO` ("Está a salvo en tu teléfono. Probá de nuevo.") y ofrece Reintentar.
  - `ErrorSubida` trae `status` (`useGrabacionSesion.ts:46-55`), pero la UI no lo mira.
  - Con un 409 (la sesión ya no está en grabando, por ejemplo porque la abandonó el mantenimiento) o un 422 (grabación corta, que el servidor marca fallida y borra), cada Reintentar falla igual.
- Propuesta: `puedeGrabar = sePuedeGrabar(turno, ahora) || hay sesión en grabando` en `page.tsx`. Ante un 409 o 422, un estado terminal con "Volver a la ficha".

**P3-12 — La máquina de estados de la sesión existe y ninguna pantalla consulta sus operaciones.** VERIFICADO. **S-M**
- `lib/sesion-clinica/estados.ts:3-7` dice que la consumen "las pantallas (qué botón ofrecer)". Pero `operacion(` y `OPERACIONES` no aparecen en ningún `.tsx`.
- *Corrección a un agente:* varias pantallas sí importan de `estados.ts`, pero solo `esGrabacionSinTerminar` y `ESTADOS_EN_PIPELINE`.
- `sesion-detail-view.tsx:374,377-379,447,459,465,515-517` repite la tabla a mano. `para-vos-view.tsx:79` copia `FEEDBACK_REPEDIBLE` más el chequeo de `modeloAsr`. `grabar-view.tsx:87` `ADMITE_AUDIO` es literalmente `ESTADOS_SIN_TERMINAR` (`estados.ts:256`).
- Propuesta:
  - `accionesDeUsuaria(estado)` derivada de `OPERACIONES`;
  - `sePuedePedirFeedback(sesion)`;
  - un `Record<EstadoSesion, …>` tipado para el cuerpo de la pantalla, para que un estado nuevo no compile hasta ubicarlo.

**P3-13 — La ficha: un turno programado ya pasado se puede cobrar, pero se ve como que no debe nada.** VERIFICADO. **S**
- El botón está arreglado: `turnos-pagos-tab.tsx:328` usa `sePuedeCobrar`.
- En la misma fila, la columna de pago (373-383) dice "—" si `estado !== "realizado"`.
- El banner (137-147) y el contador "N sin cobrar" (`ficha-tab.tsx:87`) usan `esDeudaPendiente`. El `CobrarSheet` de la ficha no avisa que cobrar marca el turno como realizado; Agenda sí lo avisa (`turno-detail-sheet.tsx:542`).
- El resultado es un "—" al lado de un botón "Cobrar", y "0 sin cobrar".
- Propuesta: en la columna, `sePuedeCobrar ? PENDIENTE : …`, y en el sheet, el aviso de Agenda.

**P3-14 — Otras reglas recalculadas en pantalla.** VERIFICADO. **S cada una**
- `paciente-detail-view.tsx:197-207` (`turnoHoy`) es `sePuedeGrabar` escrito a mano.
- `sesiones-tab.tsx:541` repite `enProceso()`, que ya importa en la 31. Lo mismo `card-ahora.tsx:133` y `turno-detail-sheet.tsx:242`.
- `turnos-pagos-tab.tsx:144-147` suma la deuda aunque `paciente.deudaTotal` ya viene del servidor. Además la cabecera lo muestra: son dos fuentes para el mismo número.
- `brief-pre-sesion.tsx:128-133,216-229` es una copia casi literal de `hayRiesgo` y `textoRiesgo` (`components/clinico/brief-corto.tsx:74,86`).
- `datos.ts:151-161` `empezoSinCobrar` = `sePuedeCobrar && !esDeudaPendiente` escrito a mano. `aplicarCobro` (207-299) rehace la cuenta de deuda y mantiene `deudores` y `deudaAcumulada`, que Hoy no pinta.
- `cobros-view.tsx:776-786`: Registrar pago baja la ficha entera y filtra con `esDeudaPendiente`. El servidor ya tiene `buscarTurnosConDeuda`.
- `config-view.tsx:935-951` escribe "A las 20:00" y "A las 8:00". La regla real (`lib/recordatorios-programacion.ts:41,44,66-80,108`) dispersa hasta 14 minutos y tiene más excepciones, y el comentario en 932-933 promete "la hora real".
- Meses:
  - `kpis.tsx:13` y `cobros-view.tsx:309-312` sacan el mes con `fechaLarga(...).split(" de ")`; existe `formatearMesMvd`.
  - `tarjeta-finanzas.tsx:42-46,76` usa el mes del reloj del teléfono y recalcula el mes anterior que la respuesta ya trae.
- `paciente-detail-view.tsx:209-216`: "Próxima" se calcula con el `hoy` de `useHoy`, que solo cambia al cambiar el día.

**P3-15 — El orden de "Te deben" sigue con tres criterios.** VERIFICADO. **S**
- `cobros-view.tsx:230-233` ordena solo por monto.
- `/api/deudores` (`route.ts:52-56`) ordena por días de atraso y después por monto.
- Hoy ordena por `porMontoYAntiguedad` (`datos.ts`, `pendientes-terapeuta.ts:137`).
- Cobros desempata por casualidad del sort estable, y ningún fixture tiene más de una deudora.
- Propuesta: que `/api/deudores` use `deudoresDeHoy` y borrar el sort de la UI.

### 3. Duplicación entre pantallas hermanas

**jscpd:** 14 clones en 79 archivos, 161 líneas (0,99 %). El porcentaje es bajo porque las copias divergieron lo suficiente para que el detector no las vea; la duplicación real es semántica. Los clones, confirmados a ojo:

| Clon (jscpd) | Qué es |
|---|---|
| `dashboard.tsx:302-311` ≈ `agenda-view.tsx:473-482` | El pie `<ResultadoSerie/>` más `<Toast/>` |
| `agenda-view.tsx:476-484` ≈ `ficha-tab.tsx:267-275` ≈ `pacientes-view.tsx:311-319` ≈ `turnos-pagos-tab.tsx:163-171`; `cobros-view.tsx:283-291` ≈ `grabar-view.tsx:470-478` | `<Toast … onClose={() => setToast(c => ({...c, open:false}))}/>`. El estado `{open, message, variante}` se declara a mano en **9 archivos**; `sesion-detail-view` usa otra forma (`{open, mensaje}`). No existe `useToast`. |
| `day-view.tsx:102-118` ≈ `cobros-view.tsx:994-1010` ≈ `finanzas-view.tsx:308-321`; `cobros-view.tsx:957-985` ≈ `finanzas-view.tsx:273-296`; `cobros-view.tsx:1002-1012` ≈ `finanzas-view.tsx:313-323` | **Tres `EstadoVacio`** (`day-view.tsx:81`, `cobros-view.tsx:969`, `finanzas-view.tsx:282`). Ya divergieron: círculo de 132 o 128 px, título `<p>` en itálica contra `<h2>`, `Card` contra `div` punteado. |
| `agenda-view.tsx:68-76` ≈ `cobros-view.tsx:124-132` | `parseTurno`. Hay **4 copias**: `datos.ts:59` (exportada), `agenda-view.tsx:68`, `cobros-view.tsx:124` y `json-ficha.ts:40` |
| `cobros-view.tsx:182-191` ≈ `finanzas-view.tsx:73-81` | La cola `.then/.catch(abort)/return abort` del efecto de carga. Son 5 copias. |
| `sheet-metodo-pago.tsx:66-74` ≈ `turnos-pagos-tab.tsx:485-493` | El botón de método de pago con `CheckDibujado` |
| `ficha-tab.tsx:270-279` ≈ `pacientes-view.tsx:314-328` | El Toast (ídem) |
| `turnos-pagos-tab.tsx:401-407` ≈ `415-421` | Los dos `motion.button` de la fila, con las mismas props de animación |

**P3-16 — `useToast`, `EstadoVacio`, `parseTurno` y `parsePaciente`, compartidos.** VERIFICADO. **S cada uno**
- `parsePaciente` y `PacienteJson` están 3 veces: `pacientes-view.tsx:37-59`, `json-ficha.ts:12-38` y `datos.ts:43,69`.
- Los errores se dibujan de 4 maneras y los vacíos de 4 maneras (`pacientes-view`, `paciente-detail-view`, `sesiones-tab`, `graficos/contenedor`).
- Hay 5 plegables con el mismo botón.
- La ficha tiene su propio esqueleto y no tiene `loading.tsx`. Agenda no tiene `loading.tsx` ni esqueleto propio: pasa por `EsqueletoPantalla` y después por el texto "Cargando…" (`agenda-view.tsx:107-111`), justo el doble parpadeo que Hoy evita.

**P3-17 — Tres selectores de "¿Cómo pagó?" con tres políticas ante un error.** VERIFICADO. **M**
- `SheetMetodoPago` (`(d)/_components/sheet-metodo-pago.tsx`, lo usan Hoy y Cobros): ante un error cierra el sheet y avisa quien lo llamó.
- `turno-detail-sheet.tsx:535-569`: grilla con monto y el aviso "queda como realizado"; el error aparece en línea y el sheet queda abierto.
- `MetodoPagoSelector` y `CobrarSheet` en `turnos-pagos-tab.tsx:187-243,448-502`: toast, y el sheet queda abierto.
- Son tres títulos y tres textos de éxito: "Cobrado", "Cobro registrado" (`turno-detail-sheet.tsx:296`) y `COBRADO` ("Cobrado. Ese ya está.", que usan Hoy y Cobros).
- El POST `/cobrar` está escrito a mano en 4 lugares: `cobros-view.tsx:469`, `dashboard.tsx:165`, `turno-detail-sheet.tsx:292` y `turnos-pagos-tab.tsx:80`.
- Propuesta: un `SheetMetodoPago` en `components/`, con `monto` y `cierraElTurno` opcionales, más un único `cobrarTurno()`.

**P3-18 — Agendar desde Hoy y desde Agenda: el mismo flujo en dos copias que ya divergen.** VERIFICADO. **S**
- Si `/api/pacientes` falla una vez, Hoy hace `setPacientes([])` (`dashboard.tsx:143-146`) y la guarda `pacientes !== null` (132) impide pedirla de nuevo: **el formulario se abre sin pacientes hasta recargar la página.**
- Una paciente creada desde el formulario de Hoy no aparece la próxima vez, porque falta el `setPacientes(null)` que Agenda sí hace (`agenda-view.tsx:318`).
- Propuesta: `leerPacientesParaAgendar()` en `lib/agendar-turno.ts` y `SheetNuevoTurno` en las dos pantallas.

**P3-19 — Formularios de alta y edición de paciente, y ciclos de envío.** VERIFICADO. **M**
- La edición no tiene `type="tel"`/`inputMode="tel"` (`editar-paciente-form.tsx:98-103`): en el teléfono sale el teclado de letras.
- El error de tarifa no se anuncia, porque solo el alta tiene `role="alert"`.
- Propuesta: `CamposPaciente` compartido.
- Hay 7 copias del ciclo enviando/error/try-catch: en `(auth)` (4), en `CambiarPassword` y `CerrarOtrasSesiones`, y en `invitar-colega`. La contraseña se valida en dos órdenes distintos. Propuesta: `useEnvio(fn)`.

### 3 bis. useEffect

**Cuenta:** 34 en pantallas más 1 en `graficos/medidas.ts`.
- **Piden datos a mano dentro del efecto: 17.** Son los de agenda-view, turno-detail-sheet (2), cobros (2), tarjeta, finanzas, sheet-periodo, pacientes-view, paciente-detail-view (3), sesiones-tab, brief, contenedor, sesion-detail-view (2), transcripcion-view, config-view, grabar-view e invitar-colega.
- **Siguen el patrón "lectura pura + then": 3.** Son `dashboard.tsx:90`, `card-ahora.tsx:182` y, a medias, `cobros-view.tsx:176`.
- El resto son timers, scroll, foco, observers, `seguirNota` y sincronización de refs.
- Casi todos los que piden datos cancelan bien con `AbortController`. Las excepciones:
  - `invitar-colega.tsx:14` no tiene abort ni guardia, y `generar()` vuelve a leer en el `finally`. HIPÓTESIS de que dos lecturas se crucen.
  - `pacientes-view.tsx:113` (config al abrir el alta) no tiene abort. Si falla, `tarifaCargada = true` queda para siempre.
  - `sesiones-tab.tsx:311-332` `cargarMas` está fuera del efecto, sin abort y sin comparar página ni paciente.
- **El antecedente (el efecto que reseteaba el formulario de turnos mientras ella escribía) no aparece en ningún lado.**
  - `config-view.tsx:282-291` mezcla los campos ya escritos.
  - `sesion-detail-view` ata la edición a `versionDe`.
  - `seccion-soap` arma el borrador al abrir la edición.
  - `EditarPacienteForm` y `NuevoTurnoForm` solo usan `defaultValues`, y el `Sheet` monta los hijos al abrirse.

Los efectos que **sí pisan o muestran estado que no corresponde**:

**P3-20 — Guardar las notas privadas vuelve a montar la autorización de grabación y puede cerrar el sheet de firma.** VERIFICADO (mecanismo); el escenario exacto es HIPÓTESIS. **S**
- La cadena:
  - `ficha-tab.tsx:127-131` pasa `onSaved={onPacienteActualizado}` al editor de notas.
  - `onPacienteActualizado` es `refetchData` (`paciente-detail-view.tsx:172-174,331`), que cambia `reloadKey`.
  - `<ConsentimientoBadge key={reloadKey}>` está en `ficha-tab.tsx:138` y en `cabecera-ficha.tsx:112`, así que los dos se desmontan y se vuelven a montar.
  - El sheet de firma y el estado de "Revocar" viven dentro del Badge.
- Escenario: ella escribe una nota privada, toca "Firmar autorización" y le pasa el teléfono a la paciente. A los 1,5 s salta el autoguardado (`ficha-tab.tsx:335-347`), el sheet desaparece y se pierde lo que la paciente llevaba firmado.
- Un cobro desde Turnos y pagos (`onTurnoActualizado={refetchData}`) hace lo mismo con el Badge de la cabecera.
- Además, cada recarga pide `/consentimiento` hasta tres veces.
- Propuesta mínima: que las notas no llamen a `refetchData`, o sacar el `key={reloadKey}` y que el Badge relea sin desmontarse.

**P3-21 — Listas que muestran datos de otro momento.** VERIFICADO (código). **S cada una**
- `pacientes-view.tsx:188-192,272-284`: al cambiar de segmento, `archived` cambia enseguida, pero la lista sigue siendo la anterior. **Los pacientes activos aparecen con "Reactivar"** mientras carga, y un toque manda un PATCH.
- `sesiones-tab.tsx:241-269`: cuando llega la nota de hoy, el efecto (que depende de `notaDeHoy`) reemplaza la lista por la página 1 y **se pierde lo cargado con "Cargar más"**.
- `agenda-view.tsx:328` + `day-view.tsx:37-45`: al cambiar de rango se conservan los turnos del rango anterior. El día nuevo se dibuja como "sin turnos", con Lupita y "Agendar", hasta que llega la respuesta. HIPÓTESIS en lo visible.
- `turno-detail-sheet.tsx:141,235,470`: `sesion` arranca en `"sin-dato"` y la rama final ofrece **Grabar sesión antes de saber si ya se grabó**. El turno ya trae `sesionClinica`; se arregla con una línea: `sesion !== "sin-dato" ? sesion : turno.sesionClinica ?? null`.
- `dashboard.tsx:246` + `card-ahora.tsx:203`: `CardAhora` no tiene `key`, así que al pasar de un turno al siguiente muestra la sesión y el brief de la paciente anterior hasta que llega la respuesta nueva.
- `dashboard.tsx:174-181`: una relectura en vuelo puede pisar el cobro que se acaba de aplicar en pantalla. HIPÓTESIS (depende del orden de llegada).

**P3-22 — Errores de relectura que no se muestran.** VERIFICADO. **S**
- `cobros-view.tsx:185-188,209`: si la recarga que sigue a un cobro falla, la rama de error solo se dibuja sin datos previos. El toast dice "Cobrado" y **la paciente sigue en la lista con la deuda vieja**, sin aviso. Finanzas ya resuelve este caso (`finanzas-view.tsx:144-155`).
- `dashboard.tsx:217-218`: el mismo caso en Hoy, después de agendar o descartar.
- `paciente-detail-view.tsx:166-168`: si falla la lectura del consentimiento, queda `null` y el aviso "falta autorización" (`cabecera-ficha.tsx:110`, que exige `=== false`) no aparece nunca.
- `brief-pre-sesion.tsx:108-111,124`: si falla `/brief`, "Preparar sesión" desaparece sin decir nada, incluso cuando se llega con `?preparar=1`.

### 4. Ramificación: propuestas de tablas de estado

**P3-23 — Seis cadenas de ternarios que ya son máquinas de estado.** VERIFICADO. **S-M**

| Dónde | Forma de hoy | Tabla propuesta |
|---|---|---|
| `grabar-view.tsx:404-469` (y `:380` para esconder Volver) | 6 ternarios que mezclan `fase`, `grabador.estado` y `enviandoAhora` | `pantallaDe(fase, grabador) → "enviando"\|"llego"\|"reintentar-subida"\|"reintentar-turno"\|"grabando"\|"error-mic"\|"previa"` y `Record<Pantalla, render>` |
| `sesion-detail-view.tsx:430-531` (y `:256-259`, `:387-391`) | 9 bloques `cond ? … : null` hermanos, `motivoBloqueo` de 4 niveles, `a \|\| b && c && d` sin paréntesis | `CUERPO: Record<EstadoSesion, "escribiendo"\|"sin-nota"\|"fallida"\|"nota">` más `accionesDeUsuaria` (P3-12) |
| `turno-detail-sheet.tsx:448-477` y `354-650` | Ternario de 4 niveles; 6 bloques `modo === X`; 3 confirmaciones casi iguales (571-626) | Acción clínica de P3-08 con `switch`; `Record<Modo, render>`; tabla `{titulo, mensaje, accion, variante}` |
| `agenda-view.tsx:397-434` | 5 niveles (listo/cargando/error × vista) | `fase` calculada una vez y `VISTA = {día, semana, mes}` |
| `sesiones-tab.tsx:525-566,653-672` | Chip anidado, escalera if/else, combinaciones `hoy && …` | `filaDeSesion({estado, sinTerminar, esHoy, cobrable}) → {chip, accion}` pura |
| `cobros-view.tsx:826-865` ≈ `sheet-periodo.tsx:556-594`; `cobros-view.tsx:198-222` contra `finanzas-view.tsx:98-131` | Cadena null/error/vacío/lista, dos veces; carga × datos implementada a mano en cada pantalla | `Lectura<T>` más `<SegunLectura>`, y **una** tabla carga × datos (cargando sin datos → esqueleto; error sin datos → error; error con datos → aviso en línea; cargando con datos → `aria-busy`). Cobros no tiene la fila "error con datos" (P3-22) |

Menores: `card-ahora.tsx:274-325` (`accionDe` ya es la tabla; falta un `switch`), `pendientes.tsx:220-229,245-397` (tabla `FILAS`), `pacientes-view.tsx:205-212,262-286`, `ficha-tab.tsx:230-252,355-362` y `para-vos-view.tsx:83,85`.

### 5. Código muerto y textos fuera del glosario

**P3-24 — Código muerto.** VERIFICADO. **S**
- `RECORDATORIO_ESTADO` (`glosario.ts:305`) está protegido por `textos-integrados.test.ts`, pero ninguna pantalla lo importa. `turno-detail-sheet.tsx:395` tiene una copia literal. El test cuida una constante que nadie usa, y un estado nuevo de SMS aparecería con su clave cruda.
- `"transcribiendo"` en `session-row.tsx:85`.
- `lecturaRatioHabla` (`progreso-lecturas.ts:271-273`) siempre devuelve `null` y no tiene uso.
- `SeccionSoap.deshabilitado` (`seccion-soap.tsx:30,40,50`) no la pasa nadie.
- `sesiones/[id]/_components/plegable.tsx` es un reexport `@deprecated` que todavía importan `nota-sesion-view.tsx:15` y `mas-de-esta-sesion.tsx:12`.
- `kpis.tsx:24-25,34-35`: `href` y `acento` siempre vacíos, así que la rama `<Link>` y la clase terracota no se usan nunca.
- `DeudorItem.minutosTotales` (`cobros-view.tsx:109`) no se lee.
- Campos del contrato que Hoy recibe y no usa: `proximaSesion`, `deudores` y `kpis.deudaAcumulada`. `riesgoDelDia?` es compatibilidad hacia atrás (`datos.ts:54-56`), contra la premisa del proyecto.
- Exports que solo se usan dentro de su archivo: `JsonDashboard`, `DiaRepartido` y `SesionEnProceso` (`datos.ts`), `NuevoPacienteFormProps`, `EditarPacienteFormProps`, `topTemas`, `TemaFrecuente`, `PuntoAlianza`, `MAX_MARCADORES`, `FlagsRiesgoProgreso` y `BarraPorFecha`.
- **e2e vencido:** `pruebas/e2e/recorrido.mjs:590` espera que `/finanzas` redirija a `/cobros`, pero `finanzas/page.tsx` monta `FinanzasView`. Por lectura, ese paso tiene que fallar por timeout; no se corrió.

**P3-25 — Comentarios que ya no describen el código.** VERIFICADO. **S**
- `(auth)/login/_components/presencia.tsx:6-8` todavía menciona `signIn()` (Auth.js ya no existe) y dice que no viaja al navegador, cuando lo usan formularios con `"use client"`.
- `nota-sesion-view.tsx:68-73` dice que el borrador original se muestra solo si es "distinto", pero no compara. Si la nota se aprobó sin tocarla, se repite la misma nota.
- `cobros-view.tsx:3-5` dice "lo que antes vivía en /finanzas", y `:200` nombra un `/api/cobros` que no existe.
- `pendientes.tsx:3,5` dice "arriba de todo" y "Cuatro listas" (son seis).
- `card-ahora.tsx:160-161`.
- `esqueletos/cobros.tsx:11` cita una línea vencida.

**P3-26 — Textos fuera del glosario.** VERIFICADO. **S por archivo, mecánico**
- Literales que ya tienen constante:
  - `REINTENTAR`: `estados-carga.tsx:13`, `agenda-view.tsx:408,451`, `pacientes-view.tsx:343`, `paciente-detail-view.tsx:277`, `sesiones-tab.tsx:357`, `config-view.tsx:414,850`, `grabar-view.tsx:889`.
  - `VOLVER`: `turno-detail-sheet.tsx` ×5, `grabar-view.tsx:386`.
  - `COBRAR`: `turno-detail-sheet.tsx:431`, `turnos-pagos-tab.tsx:409`, `sesiones-tab.tsx:553,670`.
  - `PAGADO`, `CANCELADO`, `DEBE` y `VER_FICHA`.
  - `GUARDANDO`, usado como "Guardando…" en recuperar, registro y restablecer, donde no se guarda nada.
- "Online"/"Presencial" está escrito en 5 lugares sin constante: `card-ahora.tsx:226`, `session-row.tsx:232`, `turno-detail-sheet.tsx:359`, `turnos-pagos-tab.tsx:54-55` y `sesiones-tab.tsx:445`.
- **"Nota guardada" contra "Nota lista"** para el mismo estado: la ficha usa `NOTA_GUARDADA` (`sesiones-tab.tsx:153,644`); Hoy y Agenda usan `NOTA_LISTA` (`session-row.tsx:101`). Son dos constantes en `glosario.ts:80,466`.
- `brief-pre-sesion.tsx:179-180,199-200` usa "pendiente de aprobación", el nombre viejo, en lugar de `NOTA_SIN_INCORPORAR` y `PROPUESTA_SIN_INCORPORAR`. Además, en 313-317 el mismo aviso puede salir dos veces en el mismo panel.
- `sesion-detail-view.tsx:537-539` muestra **el borrador anterior como cuatro párrafos sin decir cuál es S, O, A o P**. Es un riesgo clínico menor al recuperar una corrección.
- Volumen: unos 40 literales en `config-view`, unos 10 en `grabar-view` y unos 25 en `turno-detail-sheet`, más los aria-labels armados en `cobros-view`.

### 6. Pantallas críticas sin test de UI

**P3-27 — Los cuatro flujos críticos tienen huecos, y dos no tienen ningún test de UI.** VERIFICADO (grep de constantes y rótulos en todos los tests). **S-M**

| Flujo | Qué hay | Qué falta |
|---|---|---|
| **Consentimiento** (se registra en `components/grabacion/ConsentimientoForm.tsx:61`, montado por `ConsentimientoBadge` en `ficha-tab.tsx:137` y `cabecera-ficha.tsx:111`) | Solo la ruta del servidor (`lib/__tests__/consentimiento.test.ts`). En **todos** los tests de UI el Badge está mockeado a `null` (`avisos-operaciones.test.tsx:40`, `guardado-campo.test.tsx:13`) | **Ningún test dibuja el Form ni el Badge.** Faltan: firmar → POST con la versión 2.7; revocar → DELETE; aviso de la cabecera con `vigente === false`; que no se vuelva a montar (P3-20); error de lectura (P3-22); `sugiereRefirmar` (P3-28). **M** |
| **Grabar** | `grabar-view.test` (14: wake lock, hueco, tope, Terminar → enviando → llegó, copia local, alGrabar), `grabar-muy-corta` | Falla de subida → "no-guardado" → Reintentar con el mismo blob (`AUDIO_NO_GUARDADO` no aparece en ningún test); `TURNO_NO_MARCADO` en UI; error de micrófono; Pausar → Reanudar y Descartar con click; `autorizacionVigente={false}`; turno de otro día (P3-11). **S** cada uno |
| **Aprobar nota** | `salida-con-cambios` cubre el cuerpo del POST, el 409 por generación y las menciones; `textos-acciones` cubre el texto | Qué queda en pantalla después de aprobar (`AvisoAprobada`, que la barra desaparezca); reprocesar; reintentar y eliminar una fallida (solo está el render del motivo). **S** |
| **Cobrar** | Piezas puras de Hoy (`hoy-cobros`, `card-ahora-*`); `cobros-registrar-pago` (1 deudora, falla en el medio, SMS); botón y toast de la ficha; matriz de botones en `reglas-turno-pantallas` | **De punta a punta desde Hoy** (sheet → POST → fila y total, y el fallo); **desde Agenda** (el detalle está mockeado); recarga fallida después de cobrar (P3-22); orden con 2 o más deudoras (P3-15); falla en el primer POST; Escape con el cobro en vuelo; columna y banner de la ficha para un programado pasado (P3-13); deshacer, "No vino" y cancelar uno solo desde Agenda. **S-M** |

El e2e tampoco cubre estos flujos. `capturas.spec.ts` solo captura `/login` (línea 29). `recorrido.mjs` abre una nota ya aprobada y cobra una sola vez, desde la ficha; no graba, no aprueba y no toca el consentimiento.

### Fuera de las seis preguntas, pero en la zona

**P3-28 — La ficha no avisa que conviene volver a firmar la versión 2.7.** VERIFICADO. **S**
- El servidor manda `sugiereRefirmar` (`api/_lib/casos-uso/consentimiento.ts:74`, `lib/consentimiento.ts:71`), pero ningún `.tsx` lo lee (grep vacío en `src/components` y `src/app`).
- Todas las pacientes que firmaron la 2.6 aparecen como "Grabación autorizada" sin ninguna indicación.
- Es el complemento de pantalla que le falta al merge 284bcb5 que se acaba de hacer.

---

## (c) VERIFICADO contra HIPÓTESIS

**VERIFICADO:** todo lo que cita archivo:línea, salvo lo que se lista abajo.
- Lo reverifiqué yo en 8f2047b: P3-08 (`session-row.tsx:109-113,155-160`), P3-09 (`datos.ts:322` y el grep sin `useHoy`), P3-10 (`datos.ts:121-133`), P3-11 (`grabar-view.tsx:180-198`, `page.tsx` sin `sePuedeGrabar`), P3-12 (sin `operacion(`/`OPERACIONES` en `.tsx`), P3-13 (`turnos-pagos-tab.tsx:373-383`), P3-15 (`cobros-view.tsx:230-233`, `route.ts:52-56`), P3-20 (`ficha-tab.tsx:138`, `cabecera-ficha.tsx:112`, `paciente-detail-view.tsx:172-174` y el `onSaved` de notas), P3-21 (`pacientes-view.tsx:188-192,272-284`; `turno-detail-sheet.tsx:139-143,233-236`), P3-22 (`cobros-view.tsx:175-215`), P3-24 (e2e `recorrido.mjs:590` contra `finanzas/page.tsx`), P3-26 ("Nota guardada"), P3-28 (grep de `sugiereRefirmar`) y todas las filas de §e.
- Los números de jscpd salen de la corrida. El conteo de `useEffect` y `useState` es mecánico, con `grep -c`.

**HIPÓTESIS:**
- P3-08: lo que ve la profesional en pantalla (la lógica está leída).
- P3-11: que en el uso real llegue un 409 o 422 a la subida.
- P3-20: el escenario exacto de firma durante el autoguardado.
- P3-21: el vacío visible en Agenda al cambiar de rango, y la relectura de Hoy que pisa un cobro (carrera).
- P3-24: que el paso del e2e falle (por lectura; no se corrió).
- `invitar-colega`: el cruce de dos lecturas.
- La equivalencia `ingresosMes` = `totales.cobrado`, que permitiría sacar el GET de `/api/dashboard` en Cobros. No se comparó contra `casos-uso/finanzas.ts`.
- `DURACION_SIN_TURNO = 50` (`grabar-view.tsx:83`): el impacto sobre una profesional con sesiones de otra duración.

---

## (d) Top 10

Ordenado por riesgo para la profesional o la paciente y por esfuerzo. Todos VERIFICADOS en el código; entre paréntesis, lo que es hipótesis.

1. **P3-20 — Guardar una nota privada cierra el sheet de firma de la autorización.** `ficha-tab.tsx:138`, `cabecera-ficha.tsx:112`, `paciente-detail-view.tsx:172-174`. Se puede perder una firma a medias. **S** (escenario exacto: hipótesis).
2. **P3-27 (consentimiento) + P3-28 — El consentimiento no tiene ningún test de UI, y la ficha ignora `sugiereRefirmar`.** El Badge está mockeado a `null` en todos los tests. Las pacientes que firmaron la 2.6 no muestran ninguna indicación de volver a firmar la 2.7. **M + S**.
3. **P3-11 — Grabar: botón grande para un turno que no se puede grabar, y un Reintentar sin salida ante errores definitivos.** `grabar/[turnoId]/page.tsx:86-113`, `grabar-view.tsx:188-195`. Es la pantalla con audio clínico. **S** (409/422 en el uso real: hipótesis).
4. **P3-08 — Tres reglas de "grabar / procesando": la fila ofrece Grabar con la subida en curso o con la nota fallida, mientras la card dice otra cosa.** `session-row.tsx:109-113,155-160` contra `card-ahora.tsx:123-138` contra `turno-detail-sheet.tsx:240-242`. **M**.
5. **P3-22 — Cobros muestra la deuda vieja sin aviso si falla la recarga después de cobrar.** `cobros-view.tsx:185-188,209`. Lo mismo en Hoy (`dashboard.tsx:217`), en el consentimiento (`paciente-detail-view.tsx:166-168`) y en el brief (`brief-pre-sesion.tsx:108-111`). **S**.
6. **P3-09 + P3-10 — Hoy congela `ahora` y puede poner en la card a una paciente que no vino.** `datos.ts:322`, `datos.ts:127-133`. Cobrar no aparece al pasar la hora. **S**.
7. **P3-21 — Estados que muestran lo que no corresponde:**
   - "Reactivar" sobre pacientes activos al cambiar de segmento (`pacientes-view.tsx:272-284`);
   - "Grabar sesión" en el detalle antes de saber si ya se grabó (`turno-detail-sheet.tsx:235`, arreglo de una línea);
   - la card con el brief de la paciente anterior (`dashboard.tsx:246`);
   - "Cargar más" que se pierde (`sesiones-tab.tsx:241-269`).

   **S** cada uno.
8. **P3-13 + P3-17 — Cobrar dice cosas distintas según la pantalla.** En la ficha, "—" y "0 sin cobrar" al lado de un botón Cobrar (`turnos-pagos-tab.tsx:373-383`, `ficha-tab.tsx:87`). Hay tres selectores de método con tres políticas ante un error y tres textos de éxito. **S + M**.
9. **P3-12 + P3-23 — Las operaciones de la máquina de estados de la sesión no las consulta ninguna pantalla; la UI la repite en ternarios.** `sesion-detail-view.tsx:374-531`, `grabar-view.tsx:87,404-469`, `para-vos-view.tsx:79`. `accionesDeUsuaria(estado)` más un `Record<EstadoSesion,…>` tipado. **S-M**.
10. **P3-01..P3-05 — Cortar los cuatro archivos de más de 650 líneas con el patrón `datos.ts`, después de los puntos 1-9.** `cobros-view` 1016, `config-view` 1008, `grabar-view` 917, `turno-detail-sheet` 678. Conviene hacerlo junto con `useToast`, `EstadoVacio`, `parseTurno` y `parsePaciente` compartidos (P3-16), que eliminan casi todos los clones de jscpd. **M** cada uno.

Por fuera del top, pero baratos y con efecto visible:
- P3-15, el orden de "Te deben" (S);
- P3-18, agendar desde Hoy con la lista vacía para siempre (S);
- el borrador anterior sin rótulos S/O/A/P (`sesion-detail-view.tsx:537-539`, S);
- el paso vencido del e2e `recorrido.mjs:590` (S).

---

## (e) Cruce con el forense anterior

No existe `~/forense-sesion/02-frontend.md`. El que corresponde es **`~/forense-sesion/01-app.md`** (24-sep, sobre 7f016ec), en sus §2 y §7 y en los ítems con `(d)/`. Estado de cada ítem en 8f2047b:

| Ítem de 01-app | Estado hoy | Evidencia |
|---|---|---|
| `APROBAR_MENSAJE` "Se destruye la clave del audio" (resumen 1) | **Muerto** | `glosario.ts:546-547` dice que el audio se borra, y es cierto |
| Comentarios de `useGrabacionSesion` con IV y `/clave` (resumen 5) | **Muerto** | `useGrabacionSesion.ts:38-41` |
| Agenda ofrece Cobrar antes de hora; la ficha no ofrece Cobrar en un programado pasado (resumen 3) | **Muerto en los botones**: `sePuedeCobrar` en `turno-detail-sheet.tsx:225`, `turnos-pagos-tab.tsx:328`, `session-row.tsx:155` y `datos.ts:147`. **Queda vivo el resto** de P3-13 | ver P3-13 |
| Grabar solo el día del turno: la agenda no lo miraba | **Muerto** en la agenda (`sePuedeGrabar`, `turno-detail-sheet.tsx:226`). **Vivo** en `paciente-detail-view.tsx:197-207` (a mano) y en `grabar/[turnoId]/page.tsx` (no lo mira) | P3-11, P3-14 |
| "Nota lista" contra "Nota guardada" | **Vivo** | `sesiones-tab.tsx:153,644` contra `session-row.tsx:101` |
| Orden de deudores de tres formas | **Vivo** | `cobros-view.tsx:230-233`, `route.ts:52-56`, `orden-deuda.ts` |
| Chip de estado del turno ×3 (`statusFor`, `chipDe`, `colorDelPunto`) | **Vivo**, y hay un cuarto en `turnos-pagos-tab.tsx:58-71` ("No vino" en gold contra neutral) | `session-row.tsx:115`, `turno-detail-sheet.tsx:111`, `month-view.tsx:83` |
| Estado fantasma "transcribiendo" | **Vivo** | `session-row.tsx:85` |
| "En proceso" a mano (6 copias) | **Vivo** en 4: `sesion-detail-view.tsx:447`, `sesiones-tab.tsx:541`, `card-ahora.tsx:133`, `turno-detail-sheet.tsx:242` | P3-14 |
| Estados que dejan grabar: la fila ofrece Grabar con `fallida` | **Vivo**, ampliado a `subiendo` reciente | P3-08 |
| `ESTADOS_ACTIVOS` a mano contra `ESTADOS_EN_PIPELINE` | **Muerto**: `useSesionClinicaPolling.ts:23` = `ESTADOS_EN_PIPELINE` | — |
| Rótulos "Presencial"/"Online" ×6 | **Vivo** (5 en pantallas más `turno-editar-campos`) | P3-26 |
| `RECORDATORIO_ESTADO` sin uso; literal en la hoja | **Vivo** | `turno-detail-sheet.tsx:395` |
| `sesion.falloDetalle` crudo a la profesional; `SESION_FALLO_LABEL` sin uso | **Muerto**: va a `console.warn` y la pantalla usa `SESION_FALLO_LABEL` | `sesion-detail-view.tsx:145-149` |
| `parseTurno` ×4 | **Vivo**, ×4 | `datos.ts:59`, `cobros-view.tsx:124`, `agenda-view.tsx:68`, `json-ficha.ts:40` |
| `api-ficha.ts` cáscara; `indicesConEtiqueta`; `CHIP_BORRADOR`/`CHIP_APROBADA` | **Muertos** (borrados) | `ls` y grep vacíos |
| Tres lectores de la nota en la pantalla de sesión | **Vivo a medias**: la carga propia, `useSesionClinicaPolling` y el poller de "Para vos" (`sesion-detail-view.tsx:207-223`) siguen. Ahora el de Para vos está hecho a propósito y testeado (`salida-con-cambios.test.tsx:293`) | P3-04 |
| Dos sondeos en la ficha | **Vivo**: `paciente-detail-view.tsx:221` (`useGrabacionSesion`) y `:229-237` (`seguirNota`) | — |
| Agendar Hoy contra Agenda contra Grabar | **Vivo**, y ya divergió más (P3-18) | `dashboard.tsx:130-147`, `agenda-view.tsx:220-234,318` |
| Tres selectores de método de pago, cuatro POST `/cobrar` | **Vivo** | P3-17 |
| `EstadoVacio` duplicado (×2) | **Vivo y creció a ×3**: se sumó `finanzas-view.tsx:282` | P3-16 |
| `EmptyState`/`ErrorState` con el nombre repetido | **Vivo**: `pacientes-view.tsx:328,512`, `graficos/contenedor.tsx:240,272` | P3-16 |
| Componentes de más de 450 líneas que mezclan carga, reglas y render | **Vivos todos**, y `cobros-view` creció de 1011 a 1016 | §a |
| Cobros pide todo `/api/dashboard` para los KPI | **Vivo** | `cobros-view.tsx:146` |
| "pestaña Ficha" en el comentario de `turnos-pagos-tab.tsx:3` | No reverificado en esta corrida | — |

**Balance:** del 01-app murieron los ítems de texto falso y cifrado, `falloDetalle`, `ESTADOS_ACTIVOS` y los archivos muertos. Siguen vivos casi todos los de "regla duplicada" y "componente que mezcla": la tanda `reglas-turno` unificó `sePuedeCobrar` y `sePuedeGrabar` en los botones, pero no en las etiquetas, los contadores ni los estados de sesión.

---

## (f) Mapa de archivos por propuesta

| Propuesta | Archivos que toca | Archivos nuevos |
|---|---|---|
| P3-20 Badge que no se vuelve a montar | `pacientes/[id]/_components/ficha-tab.tsx`, `cabecera-ficha.tsx`, `paciente-detail-view.tsx`; `src/components/grabacion/ConsentimientoBadge.tsx` | — |
| P3-28 aviso para volver a firmar | `ConsentimientoBadge.tsx`, `src/lib/glosario.ts` | — |
| P3-27 tests de consentimiento | — | `src/components/grabacion/__tests__/consentimiento-badge.test.tsx` |
| P3-11 grabar | `grabar/[turnoId]/page.tsx`, `grabar/[turnoId]/_components/grabar-view.tsx` | un test en `grabar/[turnoId]/_components/__tests__/` |
| P3-08 acción clínica única | `src/components/ui/session-row.tsx`, `(d)/_components/card-ahora.tsx`, `agenda/_components/turno-detail-sheet.tsx`, `src/lib/sesion-clinica/estados.ts` | `src/lib/sesion-clinica/accion-clinica.ts` (o exportar `accionDe`) y un test de matriz en `(d)/__tests__/` |
| P3-22 error con datos | `cobros/_components/cobros-view.tsx`, `(d)/_components/dashboard.tsx`, `paciente-detail-view.tsx`, `cabecera-ficha.tsx`, `brief-pre-sesion.tsx` | — |
| P3-09/P3-10 `ahora` vivo, sin ausentes | `(d)/_components/datos.ts`, `dashboard.tsx` (con `src/hooks/useHoy.ts` o un tic) | — |
| P3-21 estados cruzados | `pacientes/_components/pacientes-view.tsx`, `agenda/_components/turno-detail-sheet.tsx`, `agenda-view.tsx`, `day-view.tsx`, `(d)/_components/dashboard.tsx`, `pacientes/[id]/_components/sesiones-tab.tsx` | — |
| P3-13 cobrable en la ficha | `pacientes/[id]/_components/turnos-pagos-tab.tsx` | — |
| P3-17 un solo selector de pago y un solo POST | `(d)/_components/sheet-metodo-pago.tsx` (se mueve), `turno-detail-sheet.tsx`, `turnos-pagos-tab.tsx`, `sesiones-tab.tsx`, `dashboard.tsx`, `cobros-view.tsx` | `src/components/cobro/sheet-metodo-pago.tsx`, `src/lib/cobrar-cliente.ts` |
| P3-12/P3-23 tablas de estado de la sesión | `src/lib/sesion-clinica/estados.ts`, `sesiones/[id]/_components/sesion-detail-view.tsx`, `para-vos-view.tsx`, `grabar-view.tsx` | `sesiones/[id]/_components/datos.ts` |
| P3-15 orden de deudores | `src/app/api/deudores/route.ts`, `cobros-view.tsx` | un test con 2 o más deudoras en `cobros/_components/__tests__/` |
| P3-18 agendar compartido | `(d)/_components/dashboard.tsx`, `sheet-nuevo-turno.tsx`, `agenda/_components/agenda-view.tsx`, `src/lib/agendar-turno.ts` | — |
| P3-16 piezas compartidas | los 9 archivos con Toast; `day-view.tsx`, `cobros-view.tsx`, `finanzas-view.tsx` (EstadoVacio); `datos.ts`, `cobros-view.tsx`, `agenda-view.tsx`, `json-ficha.ts` (parseTurno); `pacientes-view.tsx`, `json-ficha.ts`, `datos.ts` (parsePaciente) | `src/hooks/useToast.ts` (o en `components/ui/toast.tsx`), `src/components/ui/estado-vacio.tsx`, `src/lib/json-turno.ts`, `src/components/esqueletos/agenda.tsx`, `agenda/loading.tsx` |
| P3-19 formularios | `pacientes/_components/nuevo-paciente-form.tsx`, `pacientes/[id]/_components/editar-paciente-form.tsx`; `(auth)/*`, `config-view.tsx`, `invitar-colega.tsx` | `src/components/forms/campos-paciente.tsx`, `src/hooks/useEnvio.ts` |
| P3-01 corte de Cobros | `cobros/_components/cobros-view.tsx`, `finanzas/_components/sheet-periodo.tsx` (ListaCobros) | `cobros/_components/datos.ts`, `te-deben.tsx`, `fila-deudor.tsx`, `registrar-pago.tsx`, `src/components/cobro/lista-cobros.tsx` |
| P3-02 corte de Config | `config/_components/config-view.tsx` | `config/_components/useAutoguardado.ts`, `cuenta-seccion.tsx`, `opciones-radio.tsx` |
| P3-03 corte de Grabar | `grabar/[turnoId]/_components/grabar-view.tsx` | `flujo-grabacion.ts`, `pantallas.tsx` |
| P3-04 corte de Sesión | `sesiones/[id]/_components/sesion-detail-view.tsx` | `datos.ts` (compartido con P3-12), `useRevisionNota.ts`, `useParaVos.ts` |
| P3-05 corte de Agenda | `agenda/_components/agenda-view.tsx`, `turno-detail-sheet.tsx` | `agenda/_components/datos.ts`, `datos-turno.ts` |
| P3-06 cortes de la ficha | `sesiones-tab.tsx`, `turnos-pagos-tab.tsx`, `pacientes-view.tsx`, `graficos/base.tsx`, `ficha-tab.tsx` (NotasEditor) | `sesiones-datos.ts`, `filas-sesion.tsx`, `cobrar-sheet.tsx`, `pacientes-datos.ts`, `lista-pacientes.tsx`, `graficos/progreso-contrato.ts`, `graficos/ejes.tsx`, `notas-editor.tsx` |
| P3-07 sesión sin volver a montar | `sesiones/[id]/page.tsx`, `para-vos/page.tsx`, `transcripcion/page.tsx`, `selector-vista.tsx` | `sesiones/[id]/layout.tsx` (leer antes la documentación de Next 16) |
| P3-14 reglas sueltas | `paciente-detail-view.tsx`, `sesiones-tab.tsx`, `card-ahora.tsx`, `turno-detail-sheet.tsx`, `turnos-pagos-tab.tsx`, `brief-pre-sesion.tsx`, `datos.ts`, `config-view.tsx`, `kpis.tsx`, `tarjeta-finanzas.tsx`, `cobros-view.tsx` | — |
| P3-24/25/26 limpieza mecánica | `session-row.tsx`, `turno-detail-sheet.tsx`, `progreso-lecturas.ts`, `seccion-soap.tsx`, `sesiones/[id]/_components/plegable.tsx` (se borra), `nota-sesion-view.tsx`, `mas-de-esta-sesion.tsx`, `kpis.tsx`, `presencia.tsx`, `pendientes.tsx`, `brief-pre-sesion.tsx`, `sesion-detail-view.tsx:537-539`, `pruebas/e2e/recorrido.mjs:590`, `src/lib/glosario.ts` | — |

---

## Lo que no se hizo

- No se corrió la suite, ni el e2e, ni un navegador: todo lo visual es lectura de código.
- No se leyeron enteros los componentes compartidos fuera de la zona (`session-row`, `ConsentimientoBadge`, `nuevo-turno-form`, `HotWordsManager`). Se leyeron solo las líneas citadas.
- No se revisó `src/components/**` como zona propia; corresponde al panel 04.
