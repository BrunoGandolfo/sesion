# Auditoría de arquitectura y calidad — Sesión

**Fecha:** 7 de septiembre de 2026
**Commit auditado:** `7024dcd` (merge del PR #21, rama `main`)
**Alcance:** todo el repositorio — app Next.js (`src/`) y worker Python (`processor/`).
Fuera: `node_modules`, `.next`, `dist`, `coverage`, carpetas generadas.
**Naturaleza:** solo lectura. No se modificó, refactorizó ni borró nada. El único
archivo escrito es este.

---

## 1. Resumen ejecutivo

Sesión es un sistema sano. No encontré nada que esté roto en producción, ni una
decisión de arquitectura que haya que dar vuelta. La separación entre pantallas,
API y worker está bien trazada, el cifrado y el multi-tenant tienen tests de
verdad, y el código explica sus decisiones mejor que el 95% de los repositorios
que se auditan. Eso hay que decirlo antes que nada, porque el resto del informe
es una lista de problemas y una lista de problemas siempre parece peor de lo que
es.

Lo que sí hay son tres cosas que van a doler si no se tocan. La primera: hay una
funcionalidad entera —el vocabulario clínico para mejorar la transcripción— que
está construida de punta a punta (base, tres endpoints, una pantalla de 578
líneas) y **no está conectada a nada**; nadie la puede usar y el worker ni la
consulta. Son unas 900 líneas que hay que decidir si se enchufan o se borran. La
segunda: **firmar o revocar la autorización de grabación de una paciente no deja
rastro en el registro de auditoría**, siendo que es exactamente el acto que más
rastro necesita. La tercera: el contrato de lo que el modelo de IA devuelve está
escrito dos veces —una en Python y una en TypeScript— y nada verifica que las dos
copias digan lo mismo; el día que se desincronicen, un campo clínico va a
desaparecer sin que ningún test se ponga en rojo.

Después hay un patrón que se repite y que vale la pena nombrar: en varios lugares
**se creó la fuente de verdad única y no se migraron los duplicados**. La regla de
"qué es una sesión impaga", las etiquetas de los métodos de pago, el nombre del
estado de un turno: en los tres casos existe el lugar correcto donde vivir, y en
los tres casos hay dos o tres copias sueltas conviviendo con él. No es desprolijidad,
es trabajo empezado y no terminado. Es lo más barato de arreglar de todo el informe.

**Veredicto: bueno con deuda acotada.** Nada urgente, nada que impida seguir
construyendo. Con unas 25-30 horas de trabajo dirigido se resuelve todo lo
importante de este documento.

---

## 2. Cómo investigué (y por qué así)

El repositorio no tiene `node_modules` instalado en este entorno y la auditoría
es de solo lectura, así que no podía correr ESLint, `tsc` ni la suite de tests.
En vez de renunciar a las mediciones o instalar dependencias (prohibido), escribí
tres analizadores propios en Node que trabajan sobre el texto de los archivos:

1. **Grafo de imports** (267 archivos `.ts`/`.tsx`): resuelve `@/`, rutas
   relativas, `index.ts` e imports dinámicos, y detecta ciclos por DFS.
2. **Detector de código muerto**: cruza cada `export` con todos los archivos que
   importan su módulo, separando "usado en producción", "usado solo por tests" y
   "sin uso alguno", y filtrando los exports que Next exige por convención
   (`runtime`, `dynamic`, `GET`, `metadata`…).
3. **Complejidad ciclomática por función**: quita comentarios y strings,
   balancea llaves para delimitar cada cuerpo, y cuenta puntos de decisión
   (`if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `??`, ternario) + 1. Es el
   mismo criterio de la regla `complexity` de ESLint.

**Dos advertencias sobre el método, para que los números se lean bien:**

- En archivos `.tsx` el conteo **infla los componentes**, porque el `&&` y el
  ternario del JSX (`{x && <Cosa/>}`) cuentan como decisión aunque sean render
  condicional y no lógica. Por eso separé el ranking en "complejidad máxima de
  una función" y "suma del archivo", y verifiqué a mano los diez peores.
- El detector de código muerto **no distingue "función que nadie usa" de
  "función usada solo dentro de su propio archivo pero exportada de más"**. Los
  separé a mano en la sección 6, porque son dos arreglos distintos: uno es borrar,
  el otro es sacar la palabra `export`.

Todo lo que aparece abajo con archivo:línea lo verifiqué leyendo el código, no
solo con la herramienta.

**Tamaño del objeto auditado:**

| Área | Líneas |
| --- | ---: |
| `src/` sin tests | 35.729 |
| `src/lib/__tests__/` | 15.396 |
| `processor/` sin tests | 2.428 |
| `processor/tests/` | 1.478 |
| **Total** | **55.031** |

Ratio test/código: **43%** en TypeScript, **61%** en Python. Son buenos números.

---

## 3. Tabla de hallazgos

Severidad: **crítico** = compromete un dato clínico, un requisito legal o una
funcionalidad entera; **importante** = cuesta caro cada vez que se toca esa zona;
**menor** = prolijidad.
Esfuerzo: **S** ≤ 2 h · **M** = medio día · **L** = 1-3 días.

| # | Sev. | Archivo:línea | Problema | Impacto | Esf. |
| --- | --- | --- | --- | --- | --- |
| C1 | crítico | `src/components/grabacion/HotWordsManager.tsx:1`<br>`src/app/api/hot-words/route.ts:1`<br>`src/app/api/hot-words/[id]/route.ts:1`<br>`src/app/api/hot-words/paciente/[pacienteId]/route.ts:1`<br>`prisma/schema.prisma:271` | La funcionalidad de vocabulario clínico (HotWords) está completa y desconectada: ninguna pantalla monta `HotWordsManager`, y `processor/asr_assemblyai.py:154` no manda `word_boost` ni `keyterms_prompt` en el payload. La cadena entera —modelo, 3 endpoints, componente— no tiene un solo camino de ejecución. | ~900 líneas de app que se mantienen, se tipan y se buildean sin servir a nadie. Tres endpoints autenticados que escriben en base sin consumidor. Y la mejora de transcripción que la feature prometía no está ocurriendo. | M (decidir) / L (conectar) |
| C2 | crítico | `src/app/api/pacientes/[id]/consentimiento/route.ts:101` (POST)<br>`:175` (DELETE) | Firmar y revocar la autorización de grabación no llaman a `registrarAuditoria`. La tabla guarda `ipOrigen` "para auditoría" (`prisma/schema.prisma:181`) pero el evento no entra en `eventos_auditoria`. | Es el acto legal que habilita grabar a una persona. Sin evento, el rastro de quién autorizó qué y cuándo depende de una sola fila mutable, no del registro append-only que el sistema construyó justamente para eso. | S |
| C3 | crítico | `processor/schemas_llm.py:97`<br>`src/lib/sesion-clinica/schema.ts:122` | El contrato de la nota SOAP y de `datosEstructurados` está definido dos veces: JSON Schema en Python (lo que se le pide al modelo) y Zod en TypeScript (lo que la app acepta). No hay generación desde una fuente ni test cruzado. | Zod hace *strip* de claves desconocidas: un campo nuevo agregado del lado Python llega a la app y **se descarta en silencio**, sin error ni log. Es la costura por donde pasa todo el dato clínico generado por IA. | M |
| I1 | importante | `src/app/api/turnos/[id]/route.ts:39-222`<br>`src/app/api/turnos/route.ts:87-172` | Alta y edición de turnos orquestan transacción, lock de agenda, reglas de reapertura y recordatorios **dentro del route handler**, mientras existe `src/app/api/_lib/casos-uso/` con 14 casos de uso para todo lo demás. | La lógica más compleja del CRUD (complejidad 20, la 5ª del repo) solo se puede probar por HTTP contra Neon. Un lector nuevo no sabe si la regla de turnos vive en `casos-uso/` o en la ruta: la respuesta es "depende". | L |
| I2 | importante | `src/app/api/_lib/domain.ts:75` | `toTurno` hace `turno as unknown as Turno`: afirma sin validar que `estado: string → TurnoEstado`, `pagoMetodo: string → MetodoPago`, `duracion: number → Duracion`. | Un valor inesperado en la base viaja al cliente tipado como válido y explota lejos del origen. Contrasta con `toConfiguracion` (`:159`), que en el **mismo archivo** sí narrowea con fallback. Dos criterios opuestos a diez líneas de distancia. | M |
| I3 | importante | `src/hooks/useSesionClinicaPolling.ts:63`<br>`src/lib/sesion-clinica-utils.ts:256` | Dos implementaciones de la misma transformación fila-API → forma-UI: `normalizarSesionClinica` (viva, en un hook) y `normalizeSesionClinica` (muerta, en lib), con semánticas distintas (`parseDatosEstructurados` vs `coerceDatosEstructurados`) y nombres es/en. | La conversión del contrato de la sesión clínica —el objeto más importante de la app— vive dentro de un hook de React, capa equivocada. Y hay una segunda versión esperando que alguien la use por error. | M |
| I4 | importante | `src/app/api/_lib/domain.ts:183` (fuente)<br>`:59-62`<br>`src/app/(dashboard)/_components/datos.ts:132`<br>`src/app/(dashboard)/pacientes/[id]/_components/turnos-pagos-tab.tsx:149`<br>`:333` | `esDeudaPendiente` se creó como fuente única y su propio comentario (`:180`) lista los lugares que la repiten. Esos lugares **siguen repitiéndola**, incluida `toPacienteConDeuda` en el mismo archivo. | Cambiar qué cuenta como deuda (por ejemplo, incluir "ausente" cobrable) exige tocar 5 lugares y acordarse de los 5. Es plata: si uno queda viejo, el KPI y la lista de deudores dicen cosas distintas. | S |
| I5 | importante | `src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx:74`<br>`src/app/(dashboard)/_components/sheet-metodo-pago.tsx:18`<br>`src/app/(dashboard)/cobros/_components/cobros-view.tsx:71` | La lista de métodos de pago con sus etiquetas está escrita **tres veces**, idéntica, dos como array y una como `Record`. `src/lib/glosario.ts` existe justamente para esto. | Agregar un método de pago son tres ediciones y ninguna falla si se olvida una: aparece el valor crudo (`mercadopago`) en una pantalla y la etiqueta linda en las otras. | S |
| I6 | importante | `src/components/ui/session-row.tsx:47`<br>`src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx:126` | El mismo estado del turno se rotula distinto según la pantalla: "Pagado"/"Pendiente" en la fila, "Cobrado"/"Sin cobrar" en el sheet. Dos funciones equivalentes con literales sueltos fuera del glosario. | Contradice frontalmente la regla escrita en `src/lib/glosario.ts:1-8` ("una palabra por concepto, para toda la app"). Es el problema que el glosario se creó para eliminar, reaparecido. | S |
| I7 | importante | `src/types/domain.ts:387`<br>`src/lib/sesion-clinica/normalizar.ts:13` | Ciclo de imports real (no solo de tipos): `domain.ts` re-exporta valores de `normalizar.ts`, que importa tipos de `domain.ts`. | `types/domain.ts` es el módulo más importado del repo. Cualquier archivo que quiera *un tipo* arrastra `normalizar.ts` y su import de Zod al bundle. Los ciclos con re-export de valores son la clase que rompe en runtime con `undefined` según el orden de evaluación. | M |
| I8 | importante | `src/app/(dashboard)/_components/kpis.tsx:17`<br>`datos.ts:8`<br>`pendientes.tsx:25` | Tres componentes de presentación importan tipos de `@/app/api/_lib/domain` — el `_lib` privado de la carpeta API. | La dirección de dependencias apunta al revés: la UI conoce el interior de la API. Y existe `src/types/domain.ts` declarado como "fuente de verdad para toda la aplicación", que es donde deberían vivir `DashboardData` y `PendientesTerapeuta`. | S |
| I9 | importante | `src/components/forms/nuevo-turno-form.tsx:1` (467 L)<br>`src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx:1` (658 L) | Dos formularios de alta de turno. El segundo documenta en su encabezado las tres cosas que el primero no hacía, pero el primero sigue montado desde `sheet-nuevo-turno.tsx:8`. | 1.125 líneas para el mismo acto, con dos schemas Zod, dos manejos de teclado (complejidad 14 cada uno) y dos comportamientos distintos según desde dónde se agende. La versión vieja no propone día/hora ni crea paciente inline. | L |
| I10 | importante | `src/hooks/useGrabacionSesion.ts:141,166,200,208,231,305,340,351,400,446,466`<br>`src/hooks/useSesionClinicaPolling.ts:180`<br>`src/components/grabacion/HotWordsManager.tsx:77,213,247,267,279` | 17 llamadas con `fetch` crudo y manejo de errores ad hoc, mientras `src/lib/api-client.ts` encapsula el contrato `{data}`/`{error}` y `ApiClientError`. | El camino de la grabación —el más crítico de la app— es justo el que no usa el cliente compartido. Cada sitio reimplementa "leer `.data`", "detectar 401", "distinguir abort", y lo hace con criterios distintos. | M |
| I11 | importante | `src/app/api/pacientes/[id]/brief/route.ts:1`<br>`src/app/api/pacientes/[id]/progreso/route.ts:1`<br>`src/app/api/pacientes/[id]/contexto-clinico/route.ts:47` (GET) | Tres rutas devuelven PHI densa (hipótesis diagnóstica, riesgos históricos, resumen acumulativo) **sin registrar auditoría**, mientras `documentacion/route.ts` sí la registra y `contexto-clinico` la registra en el PATCH pero no en el GET. | La política de "auditar acceso a datos clínicos" está aplicada en dos rutas de cuatro. No es una regla, es una costumbre. Con un solo usuario importa poco; con dos, el registro no sirve para responder "quién leyó la ficha de X". | S |
| I12 | importante | `src/lib/deudas.ts:1` | Único módulo puro de reglas de negocio del repo **sin ningún test**. Contiene `zonaDeuda` (umbrales 15/31 días), `textoAtraso`, `interpolarTemplateCobro` (dos regex) y `buildWhatsAppUrl`. | `interpolarTemplateCobro` arma el mensaje que se le manda a una paciente por su deuda. Si la regex falla, sale un texto mal formado a una persona real, y no hay red que lo agarre. | S |
| I13 | importante | `src/app/(dashboard)/config/_components/config-view.tsx:153` (905 L, cx 36)<br>`src/app/(dashboard)/agenda/_components/agenda-view.tsx:119` (449 L, cx 58) | Los dos componentes más pesados del repo: `ConfigView` mezcla carga, formulario de 6 campos, cambio de contraseña (7 `useState` propios), selector de enfoque y editor de recordatorio; `AgendaView` es la función de mayor complejidad del proyecto. | Son las pantallas donde un cambio chico requiere leer 400 líneas para saber qué se rompe. Sin tests de UI, la única verificación es abrir el navegador. | L |
| I14 | importante | `eslint.config.mjs:5` | La config es `next/core-web-vitals` + `next/typescript` y nada más. No hay `complexity`, `max-lines`, `max-lines-per-function`, `import/no-cycle` ni `no-restricted-imports`. | Todo lo de la tabla —el ciclo I7, el cruce de capas I8, los componentes de I13— es exactamente lo que esas cuatro reglas atajan en el PR y no en una auditoría seis meses después. El repo ya demostró (test guardián del middleware) que sabe convertir una regla en un test; acá falta hacerlo. | S |
| I15 | importante | `vitest.config.ts:33` (`environment: 'node'`) | Cero tests de componentes: no hay `jsdom` ni `@testing-library`, y `find src -name "*.test.tsx"` devuelve 0. | 73 archivos con `"use client"` sin una sola verificación automática. `GrabadorSesion.tsx:14` lo reconoce explícitamente. La grabación —lo único irrepetible del sistema, porque una sesión no se vuelve a grabar— se verifica a mano. | L |
| I16 | importante | `src/app/api/_lib/domain.ts:157-174` | `startOfDay`, `endOfDay`, `startOfMonth`, `endOfMonth`, `addDays` son envoltorios de una línea sobre `fechas-montevideo`, con nombres en inglés. | Dos vocabularios para la misma operación conviviendo en la capa API. Un lector que busca "dónde se calcula el inicio del día" encuentra dos respuestas y tiene que verificar que son la misma. | S |
| M1 | menor | `src/app/(dashboard)/cobros/page.tsx:3` | `dynamic = "force-dynamic"` redundante: `(dashboard)/layout.tsx:5` ya lo declara para todo el grupo. | Ruido. Pero sugiere duda sobre si el layout alcanza —y esa duda es legítima: `global-error.tsx`, `icon.tsx`, `apple-icon.tsx` y `manifest.ts` quedan **fuera** de los dos grupos que AGENTS.md dice que cubren todo. | S |
| M2 | menor | `src/types/domain.ts:383,396,442,466,472,480,489,497,508` | Nueve bloques `@deprecated`, seis de ellos marcados "sin consumidor" o "desactualizado". Confirmado: 16 tipos exportados sin ningún uso. | El archivo declarado "fuente de verdad" es en un 15% documentación de cosas que ya no existen. El lector tiene que filtrar. | S |
| M3 | menor | `src/components/ui/session-row.tsx`, `week-view.tsx`, `month-view.tsx`, `day-view.tsx`, `turno-detail-sheet.tsx`, `sheet-metodo-pago.tsx`, `card-ahora.tsx` | Nomenclatura mixta es/en en nombres de archivo, a veces dentro del mismo nombre (`turno-detail-sheet`, `sheet-metodo-pago`, `card-ahora`). En código: `statusFor`, `borderLeftClass`, `handleKeyDown`, `money`, `initials`, `sendSms` conviven con `zonaDeuda`, `esDeudaPendiente`, `programarRecordatorio`. | Bajo, pero real: hay que recordar en qué idioma se nombró cada cosa para encontrarla. La convención dominante es español; el inglés queda en la capa de UI genérica, lo cual es defendible **si se escribe la regla**. Hoy no está escrita. | M |
| M4 | menor | `src/app/api/_lib/contexto-clinico/formato-llm.ts:18` | `formatearParaLLM`: 125 líneas, complejidad 25, `lines.push(...)` secuencial con condicionales intercalados. | Es lineal y está testeado, así que el riesgo es bajo. Pero es el texto exacto que ve el modelo: una sección que se agrega en el lugar equivocado cambia la nota clínica. Un mapa sección→renderizador lo haría evidente. | M |
| M5 | menor | `src/components/forms/index.ts:1` | Barrel de una línea que reexporta un único componente, que además es el duplicado de I9. | Indirección sin beneficio. | S |
| M6 | menor | ~100 exports (ver §6.2) | Símbolos exportados que solo se usan dentro de su propio archivo. | La "API pública" de cada módulo es más ancha de lo que su autor quiso. Cada export de más es una promesa de estabilidad que nadie pidió. | M |

---

## 4. Top 15 a resolver primero

Ordenados por impacto dividido esfuerzo. Los primeros seis son de una sesión de
trabajo cada uno y cierran la mayor parte del riesgo real.

| # | Qué | Ref. | Por qué primero | Esf. |
| --- | --- | --- | --- | --- |
| 1 | Auditar firma y revocación de consentimiento | C2 | Es el requisito legal más caro de no tener y el arreglo son dos llamadas a una función que ya existe. | S |
| 2 | Adoptar `esDeudaPendiente` en los 4 lugares que la repiten | I4 | La fuente única ya está escrita y comentada; falta solamente migrar los consumidores. Toca plata. | S |
| 3 | Unificar métodos de pago y chips de estado en `glosario.ts` | I5, I6 | Dos reglas del propio proyecto incumplidas, borrables en una tarde. | S |
| 4 | Agregar `complexity`, `max-lines-per-function`, `import/no-cycle` y `no-restricted-imports` a ESLint | I14 | Convierte cinco hallazgos de este informe en errores de CI. Es la única línea del top que evita que la lista vuelva a crecer. | S |
| 5 | Tests de `src/lib/deudas.ts` | I12 | Regla de negocio pura, sin dependencias, que le habla a una paciente. Media hora de tests. | S |
| 6 | Mover `DashboardData` y `PendientesTerapeuta` a `src/types/domain.ts` | I8 | Corta la dependencia UI → interior de la API con tres cambios de import. | S |
| 7 | Decidir el destino de HotWords: conectar o borrar | C1 | 900 líneas y una tabla en juego. La decisión es de producto (¿mejora la transcripción o no?), pero mientras no se tome, el costo se paga todos los meses. | M/L |
| 8 | Test de contrato cruzado Python ↔ TypeScript | C3 | Un test que compare las claves de `SCHEMA_NOTA` contra las de `datosEstructuradosSchema` y falle ante una divergencia. Protege el dato clínico generado por IA. | M |
| 9 | Una sola `normalizarSesionClinica`, en `lib/`, y borrar la de `utils` | I3 | Saca lógica de contrato de un hook de React y elimina la copia muerta. | M |
| 10 | Reemplazar el cast de `toTurno` por narrowing con fallback | I2 | El patrón correcto ya existe diez líneas abajo (`toConfiguracion`). Es copiarlo. | M |
| 11 | Extraer `crear-turno.ts` y `editar-turno.ts` a `casos-uso/` | I1 | Lo más caro de la lista, y lo que más ordena: deja las rutas como capa de transporte, permite testear la regla sin HTTP y baja la función de complejidad 20. | L |
| 12 | Migrar los 17 `fetch` crudos a `api-client` | I10 | El camino de grabación deja de tener manejo de errores propio. | M |
| 13 | Romper el ciclo `domain.ts` ↔ `normalizar.ts` | I7 | Borrar el re-export deprecado de `domain.ts:387` y arreglar los importadores. | M |
| 14 | Partir `config-view.tsx` y `agenda-view.tsx` | I13 | Alto valor, alto costo, y sin tests de UI el riesgo de la partición es real. Después de #15. | L |
| 15 | Sumar `jsdom` + `@testing-library` y cubrir grabación y aprobación | I15 | Es la inversión que habilita tocar la UI con confianza. Va última porque es la que más tiempo pide, no porque importe menos. | L |

**Los seis primeros suman menos de un día de trabajo** y cierran los dos hallazgos
críticos baratos más cuatro importantes.

---

## 5. Top 15 de complejidad

Complejidad ciclomática de la peor función de cada archivo (puntos de decisión + 1),
criterio de la regla `complexity` de ESLint. Recordá la advertencia de §2: en
`.tsx` el JSX condicional infla el número. Verifiqué a mano los diez primeros.

| # | Cx | Archivo:línea | Función | Largo | Lectura |
| ---: | ---: | --- | --- | ---: | --- |
| 1 | 58 | `src/app/(dashboard)/agenda/_components/agenda-view.tsx:119` | `AgendaView` | 331 L | Mitad JSX condicional, mitad estado real (5 fetch, modo de vista, ancla del día, sheet). Igual es la peor del repo. |
| 2 | 36 | `src/app/(dashboard)/config/_components/config-view.tsx:153` | `ConfigView` | 391 L | Formulario + guardado optimista + 8 subcomponentes en el mismo archivo. |
| 3 | 34 | `src/hooks/useSesionClinicaPolling.ts:125` | `useSesionClinicaPolling` | 153 L | Complejidad genuina: timers, abort, estado atado al id. Candidato a máquina de estados explícita. |
| 4 | 25 | `src/app/api/_lib/contexto-clinico/formato-llm.ts:18` | `formatearParaLLM` | 125 L | Lineal (`lines.push` + condicionales). Ver M4. |
| 5 | 20 | `src/app/api/turnos/[id]/route.ts:68` | `PATCH` / `ocupa` | 144 L | **Complejidad genuina y en el lugar equivocado.** Ver I1. |
| 6 | 17 | `src/app/api/seed/route.ts:89` | `POST` | 162 L | Script de datos de prueba dentro de una ruta de producción. Tolerable, pero es la ruta más grande del repo. |
| 7 | 16 | `src/app/api/hot-words/route.ts:88` | `POST` | 68 L | Doble contrato (item suelto o array) en una ruta que nadie llama (C1). |
| 8 | 16 | `src/lib/anthropic-mensajes.ts:138` | `crearMensaje` | 67 L | Cliente HTTP con clasificación de errores. Justificada y testeada. |
| 9 | 15 | `src/lib/csp-reportes.ts:146` | `normalizarReportes` | 33 L | Tres formatos de reporte CSP distintos. Justificada: el navegador manda lo que quiere. |
| 10 | 14 | `src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx:279` | `onBusquedaKeyDown` | 28 L | Navegación por teclado del combo de pacientes. |
| 11 | 14 | `src/components/forms/nuevo-turno-form.tsx:174` | `handleKeyDown` | 34 L | **La misma función que #10, en el formulario duplicado** (I9). |
| 12 | 14 | `src/lib/format.ts:96` | `fechaRelativa` | 34 L | Cadena de rangos (hoy/ayer/días/semanas/meses/años). Bien testeada; una tabla de rangos la aplanaría. |
| 13 | 14 | `src/lib/recordatorios-sms.ts:76` | `sendSms` | 80 L | Twilio + clasificación de fallos. Justificada. |
| 14 | 13 | `src/app/(dashboard)/_components/dashboard.tsx:36` | `Dashboard` | 163 L | Mayormente JSX condicional; la derivación ya está afuera en `datos.ts`. Buen patrón. |
| 15 | 8 (suma 104) | `src/components/grabacion/GrabadorSesion.tsx:157` | `useGrabador` | 1.063 L | **Ninguna función pasa de 8**, pero es el archivo de mayor complejidad acumulada. Es el ejemplo a imitar: lo testeable ya se extrajo a cuatro módulos con tests. |

Del lado Python, nada preocupa: los peores son `app_client.enviar_callback` (13),
`clinical_analyzer._llamar_anthropic` (13) y `speech_analytics.compute` (13), todos
por debajo de 100 líneas y con tests.

---

## 6. Código muerto

### 6.1 Para borrar (nadie los usa, ni producción ni tests)

**Archivos cáscara ya marcados por el propio proyecto** — el repo documenta su
deuda, lo cual está muy bien; solo falta ejecutar el borrado:

| Archivo | Línea | Nota |
| --- | ---: | --- |
| `src/lib/prompts.ts` | 1-18 | "BORRAR ESTE ARCHIVO". Los prompts vivos están en `processor/prompts/`. |
| `prompts/` (raíz: `README.md`, `clinical_note_v1.0.md`, `v2.0.md`, `v2.1.md`) | — | Copia huérfana congelada en v2.1 mientras el pipeline va por v3.1.1. Se borra junto con el anterior. |
| `src/components/grabacion/NotaClinicaView.tsx` | 1-25 | "BORRAR ESTE ARCHIVO". Reemplazado por `/sesiones/[id]`. |
| `src/components/grabacion/SesionHuerfanaBanner.tsx` | 1-23 | "BORRAR ESTE ARCHIVO". Reemplazado por el bloque de error de `sesion-detail-view`. |
| `src/app/(dashboard)/pacientes/[id]/_components/api-ficha.ts` | 1-3 | `export {}` vacío a propósito. |

**Reexports y alias sin consumidor:**

| Archivo:línea | Símbolo | Nota |
| --- | --- | --- |
| `src/app/(dashboard)/agenda/_components/brief-corto.tsx:1` | `BriefCorto` | Alias de `BriefCortoDePaciente` que nadie importa; el original se usa directo. Archivo entero. |
| `src/app/(dashboard)/sesiones/[id]/_components/plegable.tsx:1-3` | `Plegable` | `@deprecated`, apunta a `@/components/ui`. Archivo entero. |
| `src/app/(dashboard)/sesiones/[id]/_components/textos.ts:23,37,40,42,47,48,52,54,58,61` | `CTSR`, `GTFS`, `LO_QUE_DIJO`, `MITI`, `PARA_REVISAR`, `PARA_VOS`, `REVISE_ESTA_SENAL`, `SENAL_DE_RIESGO`, `VER_DETALLE`, `pluralizar` | Reexports del glosario que ningún componente de la ruta importa. |
| `src/lib/recordatorios-sms.ts:31` | `buildReminderMessage` | Alias de `buildSmsMessage`, sin consumidor. |
| `src/lib/recordatorios-sms.ts:22,23,24` | `contarLongitudSms`, `LINEA_CONTACTO`, `TEMPLATE_SMS_SUGERIDO` | Reexports sin consumidor. |
| `src/components/forms/index.ts:1` | barrel | Ver M5. |

**Funciones y constantes sin ningún uso:**

| Archivo:línea | Símbolo |
| --- | --- |
| `src/app/api/_lib/domain.ts:127` | `minFecha` |
| `src/lib/sesion-clinica-utils.ts:238` | `RawSesionClinica` |
| `src/lib/sesion-clinica-utils.ts:256` | `normalizeSesionClinica` (ver I3) |
| `src/app/api/_lib/auditoria.ts:19` | `hashTexto` (reexport) |
| `src/app/(dashboard)/pacientes/[id]/_components/graficos/base.tsx:193` | `indicesConEtiqueta` |
| `src/app/(dashboard)/pacientes/[id]/_components/graficos/base.tsx:207` | `MAX_MARCADORES` |
| `src/app/(dashboard)/pacientes/[id]/_components/progreso-lecturas.ts:184` | `topTemas` |
| `src/app/(dashboard)/config/_components/editor-recordatorio.tsx:36` | `FICHAS` |
| `src/app/(dashboard)/_components/datos.ts:16` | `SIN_PENDIENTES` |
| `src/app/api/_lib/contexto-clinico/tipos.ts:15,18,27,30,37,43` | `estadoObjetivoSchema`, `objetivoSchema`, `eficaciaSchema`, `intervencionSchema`, `temaSchema`, `riesgoHistoricoSchema` — schemas Zod definidos y nunca aplicados (`cambiosContextoSchema` los compone; verificar caso por caso antes de borrar) |
| `src/app/api/_lib/schemas.ts:46,56,76` | `emailOpcionalSchema`, `telefonoSchema`, `tarifaSchema` |

**Tipos muertos en `src/types/domain.ts`** (16 en total; los declarados sin
consumidor por el propio archivo): `IniciarGrabacionRequest:468`,
`SubirAudioRequest:474`, `AprobarNotaRequest:483`,
`FirmarConsentimientoRequest:492`, `ConsentimientoResponse:499`,
`ResultadoProcesamientoCallback:511`, `PagoEstado:26`, `RecordatorioEstado:52`,
`IntervencionTerapeuta:197`, `SpeechAnalytics:217`, `MITIGlobales:259`,
`MITICounts:267`, `BenchmarkMITI:280`, `RatiosDerivadosMITI:282`,
`CTSRSubset:290`, `SpeechAnalyticsInferido:297`.

**Y la funcionalidad completa de C1**, que no listo símbolo por símbolo porque la
decisión es de producto, no de limpieza.

### 6.2 Exports de más (la función se usa, el `export` no)

Unos 100 símbolos se exportan pero solo se consumen dentro de su propio archivo,
o solo desde los tests. Los que solo usan los tests son legítimos y no los cuento
como problema (es el precio razonable de testear constantes de mensajes). Los que
**nadie** consume desde afuera y sí se usan adentro son los que conviene
desexportar: entre otros `esEstadoSesion` y `UMBRAL_HUERFANA_HORAS`
(`sesion-clinica-utils.ts:50,141`), `maxFecha` (`domain.ts:119`),
`coerceDatosEstructurados` (`sesion-clinica-utils.ts:201`), `LOCK_MAX_WAIT_MS` y
`LOCK_TIMEOUT_MS` (`intentos-serializados.ts:58,59`), `registrarLoginOk` y
`registrarLoginFallido` (`login-eventos.ts:252,231`), `clavePassword`
(`password-eventos.ts:82`), `ORG_DESCONOCIDA` y `claveIp` (`login-eventos.ts:76,96`).

No es urgente. Vale hacerlo cuando se toque cada archivo por otro motivo.

---

## 7. Cobertura de tests

### 7.1 Lo que está bien cubierto

54 archivos de test en TypeScript (11 de integración contra una rama Neon
dedicada) y 6 en Python. Fuerte y con buenos casos de borde en:

- **Cifrado en reposo** — `prisma-encryption.test.ts` (782 L), `encryption.test.ts`,
  `crypto.test.ts`. Incluye el guard que impide usar columnas cifradas en `WHERE`.
- **Multi-tenant** — `multi-tenant.test.ts` (716 L): 9 rutas de **escritura** con
  el caso "otra organización recibe 404 y la fila no se toca".
- **Cobro** — `cobrar-turno.test.ts`, `deshacer-cobro.test.ts`, `turno-realizado.test.ts`.
- **Recordatorios** — seis archivos: programación, reprogramación al mover el turno,
  cierre al cancelar, reintentos, texto del SMS, lease del cron.
- **Pipeline de sesión** — `casos-uso-sesion.test.ts` (1.277 L), `casos-uso-worker.test.ts`,
  incluyendo que la clave del audio nunca sale por la API (16 aserciones sobre
  `_audioCifradoTemporal`).
- **Fechas de Montevideo** — `fechas-montevideo.test.ts`, `agenda-zona-dispositivo.test.ts`.
  Fue una fuente real de bugs y quedó blindada.
- **La regla de AGENTS.md sobre módulos de Node** — `middleware-edge.test.ts` camina
  el grafo de imports desde `src/middleware.ts`. Verifiqué el estado actual: los
  siete usos de `node:*` del repo (`auth.ts:1`, `auditoria-pura.ts:5`,
  `eliminar-sesion.ts:36`, `prisma-encryption.ts:1`, `encryption.ts:6`,
  `ayuda-corpus.ts:40,41`) están todos fuera del alcance del middleware. **La regla
  se cumple.**
- **Worker** — 1.478 líneas de pytest sobre ASR, schemas, cripto y orquestación.

### 7.2 Huecos, priorizados

| Prio | Hueco | Dónde | Por qué duele |
| --- | --- | --- | --- |
| 1 | **`src/lib/deudas.ts` sin ningún test** | `src/lib/deudas.ts:1-79` | Único módulo puro de negocio sin red. `interpolarTemplateCobro` arma el mensaje de cobro que le llega a una paciente. Media hora de trabajo. |
| 2 | **Consentimiento: la ruta no tiene test propio** | `src/app/api/pacientes/[id]/consentimiento/route.ts` | `consentimiento.test.ts` cubre el texto legal y `esConsentimientoVigente` (funciones puras), y `multi-tenant.test.ts:513` cubre que sin consentimiento no se graba. Pero **firmar, revocar y refirmar** —incluida la revocación implícita de la firma anterior en `:146`— no tienen test. Es la puerta legal de todo el pipeline. |
| 3 | **Aislamiento multi-tenant solo en escrituras** | `multi-tenant.test.ts` | Las 9 pruebas son PATCH/POST/DELETE. Ninguna ruta de **lectura de PHI** (`brief`, `progreso`, `documentacion`, `contexto-clinico` GET) tiene su caso "otra organización recibe 404". En una fuga, la lectura es lo que importa. |
| 4 | **Contrato Python ↔ TypeScript sin verificación** | `processor/schemas_llm.py` ↔ `src/lib/sesion-clinica/schema.ts` | Ver C3. Un test de claves cruzadas cuesta poco y protege el dato clínico. |
| 5 | **Auditoría: se verifica en 4 flujos de 8** | — | Hay aserciones sobre `eventoAuditoria` en login, cambio de contraseña, asistente de ayuda y sesión clínica. No las hay para consentimiento (que ni siquiera audita, C2), cobro/descobro, alta y edición de pacientes, ni edición de turnos. |
| 6 | **Cero tests de UI** | 73 archivos `"use client"` | Ver I15. El orden de detención de la grabación, la recuperación de una grabación huérfana desde IndexedDB y la pantalla de aprobación de nota se verifican a mano. Notá que la parte testeable de la grabación **ya se extrajo** a `grabacion-cronometro`, `grabacion-microfono`, `grabacion-cifrado` y `grabacion-storage`, todas con test: el hueco es el hook y el render, no la lógica. |
| 7 | **`intentos-serializados.ts` sin test directo** | `src/lib/intentos-serializados.ts:1` | Se ejercita indirectamente desde `login-atomico.test.ts` y `password-atomico.test.ts`, que sí son buenos. Prioridad baja justamente por eso. |

---

## 8. Filosofía del proyecto: dónde se cumple y dónde no

El proyecto declara convención sobre configuración y "sin abstracciones
prematuras". Mi lectura:

**Se cumple, y bien:**

- `src/lib/api-client.ts:8` dice explícitamente "sin reintentos, sin cache, sin
  interceptores: si mañana hacen falta, se agregan cuando haya tres consumidores
  que lo pidan". Eso es exactamente la regla, escrita.
- `intentos-serializados.ts` se extrajo **después** de tener dos consumidores
  reales (login y cambio de contraseña). Abstracción ganada, no anticipada.
- `vitest.config.ts:15` explica por qué la lista de tests de integración es
  explícita y no un glob: "hoy son pocos y una lista explícita se lee mejor que
  una convención que hay que recordar". Criterio correcto.
- `components/ui/movimiento.tsx`: verifiqué los siete componentes de animación y
  **todos tienen consumidores reales**. No es una biblioteca "por las dudas".
- `GrabadorSesion.tsx` es el mejor ejemplo del repo: la lógica testeable se sacó
  a cuatro módulos y quedó solo lo que no se puede probar sin renderizar.

**No se cumple:**

- **HotWords (C1)** es el caso de manual de "construido por las dudas": tres
  endpoints, un modelo y una pantalla sin un solo consumidor real. No es
  abstracción prematura, es *funcionalidad* prematura, que sale más cara.
- **Los seis tipos de contrato de request** en `types/domain.ts:468-511`
  (`IniciarGrabacionRequest`, `SubirAudioRequest`, …) son una capa de tipos que
  nunca tuvo consumidor: las rutas validan con Zod desde el principio.
- **`src/app/api/_lib/schemas.ts:46,56,76`**: tres schemas Zod definidos y nunca
  aplicados.
- El lado opuesto, `if`/`else` a mano donde correspondería una tabla:
  `fechaRelativa` (`format.ts:96`, siete rangos encadenados), `statusFor` y
  `borderLeftClass` (`session-row.tsx:47,55`), `chipDe`
  (`turno-detail-sheet.tsx:126`), `zonaDeuda` (`deudas.ts:13`). Ninguno es grave
  y todos son legibles; los menciono porque son los candidatos naturales a mapa
  de estrategias si crecen.

---

## 9. Consistencia con AGENTS.md

| Regla escrita | ¿Se cumple? | Evidencia |
| --- | --- | --- |
| Nunca importar módulos de Node desde algo alcanzable por el middleware | **Sí** | Los 7 usos de `node:*` cuelgan de rutas API con `runtime = "nodejs"`. El test guardián (`middleware-edge.test.ts:1`) camina el grafo real y usa `builtinModules`, no una lista a mano. Es el mejor mecanismo de cumplimiento del repo. |
| CSP en Report-Only hasta ganarse el enforce | **Sí** | `src/middleware.ts:35` sigue emitiendo `Content-Security-Policy-Report-Only`; `next.config.ts:43` mantiene aparte el `frame-ancestors 'none'`, tal como el documento explica. |
| Toda página fuera de los dos layouts debe declarar `force-dynamic` | **Con un matiz** | `(dashboard)/layout.tsx:5` y `(auth)/layout.tsx:23` lo declaran. Pero `src/app/global-error.tsx`, `icon.tsx`, `apple-icon.tsx` y `manifest.ts` viven **fuera de ambos grupos**. `global-error.tsx` es el único con `"use client"` y por lo tanto el único candidato a aparecer en el "montón 1" de reportes CSP. Vale la pena mirarlo antes de dar por cumplida la condición de "cero reportes propios". Y `cobros/page.tsx:3` declara `force-dynamic` de más (M1). |
| Leer los docs de Next antes de escribir código | No verificable desde el código | — |

---

## 10. Dato sensible: dónde vive cada cosa

No es una auditoría de seguridad; es lo que salta a la vista mirando arquitectura.

**El mapa está bien trazado:**

| Dato | Dónde vive | Protección |
| --- | --- | --- |
| Audio de la sesión | R2, cifrado en el navegador antes de subir | AES-GCM con clave por sesión; se borra al aprobar y la clave se destruye (crypto-shredding) |
| Transcripción, nota SOAP, nota original | Postgres, columnas `*_encrypted` | AES-256-GCM vía extensión de Prisma; el schema documenta que no se pueden usar en `WHERE` y la extensión lo enforza en runtime |
| Hipótesis diagnóstica, resumen acumulativo, riesgos históricos | Postgres, `*_encrypted` | Igual |
| Objetivos, intervenciones, temas | Postgres, JSON **sin cifrar** | Decisión deliberada y documentada (`prisma/schema.prisma:317`): son datos consultables, la PHI densa va cifrada |
| Nombre, teléfono, email, notas del paciente | Postgres, en claro | Estándar; el aislamiento es por `organizationId` |
| Clave e IV del audio | Dentro de `datosEstructurados._audioCifradoTemporal`, cifrado en reposo | Se borra al aprobar; `sinClaveTemporal` la quita en la respuesta y el strip de Zod la descarta en las rutas de lectura. **Verificado: hay 16 aserciones de test sobre esto.** Bien resuelto. |
| Registro de auditoría | `eventos_auditoria`, append-only | `detalleSeguro` tiene una lista negra amplia de claves y trunca strings a 120 chars. Buen diseño. |

**Lo que observo:**

1. **El hueco de C2** (consentimiento sin auditar) y **el de I11** (tres rutas que
   devuelven PHI sin registrar el acceso) son los dos únicos puntos donde la
   política declarada y el código no coinciden.
2. **El worker tiene el alcance justo**: `GET /api/pacientes/[id]/contexto-clinico`
   con Bearer le da hipótesis diagnóstica, riesgos y las tres últimas notas —todo
   lo que necesita para el prompt y nada más—, y `processor.py:75` hace `del audio`
   apenas transcribe. Los logs del worker son explícitamente solo ids y códigos.
   Está bien dimensionado.
3. **Un matiz sobre la extensión de cifrado**: descifra automáticamente en toda
   lectura, así que cualquier ruta que importe `db` obtiene texto clínico en claro
   sin pedir permiso. Es la decisión correcta para una app de una sola usuaria
   —la alternativa sería una capa de permisos que hoy no tiene a quién distinguir—
   pero conviene tenerla anotada: **el día que haya un segundo rol** (una
   secretaria que agenda y cobra, por ejemplo), el control de acceso a PHI hay que
   construirlo desde cero, porque hoy no existe ningún punto donde apoyarlo.
4. `hablanteTerapeuta`, `pausas` y `duracionAudioSeg` sin cifrar: correcto, no son
   contenido clínico y el schema lo justifica.

---

## 11. Lo que no hay que cambiar

Porque una auditoría que solo señala problemas miente sobre el estado real:

- **Los comentarios de decisión.** `solapamiento-turnos.ts:1-50` explica por qué
  la transacción no alcanza contra la doble reserva (READ COMMITTED no bloquea la
  ausencia de filas), por qué el lock de asesoría, y qué sería la solución de
  fondo (restricción de exclusión GiST). Eso es documentación que no se puede
  reconstruir leyendo el código. Vale más que la mayoría de los tests.
- **Cero `any`, cero `@ts-expect-error`, cero `eslint-disable`** en todo `src/`.
  El único escape de tipos es `toTurno` (I2) y los dos `globalThis` de los
  singletons de Prisma, que son idiomáticos.
- **El CI.** Cinco jobs, concurrency separada para el job que toca la base
  compartida, y un comentario que explica honestamente que el mecanismo **no** es
  una cola FIFO y qué modo de falla se acepta a cambio. Eso es madurez operativa.
- **`glosario.ts`.** La idea de un módulo puro de vocabulario, con la regla
  clínica escrita arriba (se simplifica el camino, nunca el contenido), es lo
  mejor del diseño de este proyecto. Los hallazgos I5 e I6 no son críticas al
  glosario: son el recordatorio de terminar de mudarse a él.
- **`fechas-montevideo.ts`.** Una zona horaria, una fuente, y los bugs que
  justificaron cada función anotados en el código.

---

*Auditoría de solo lectura. Ningún archivo del repositorio fue modificado fuera de
`docs/auditoria/`.*
