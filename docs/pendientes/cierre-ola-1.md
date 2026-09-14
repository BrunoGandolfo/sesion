# Cierre de la Ola 1: qué se borró para la Ola 2 y qué queda abierto

Fecha: 14 de septiembre de 2026 · Rama `f3-cierre` sobre `main` en `18daff2`.

Después de fusionar Operación, Identidad, Estados y Estructura, `main` tenía
150 errores de `tsc`, cuatro archivos de tests en rojo y rutas que hablaban
con tablas que ya no existen. Este documento dice qué se borró (git guarda
la historia: `git log --diff-filter=D -- <ruta>`), por qué, y qué le toca a
la Ola 2 reconstruir desde sus diseños.

## 1. Borrado: el Recorrido (Ola 2, diseño 04)

Todo esto leía o escribía `paciente_contexto_clinico`, que el esquema nuevo
reemplazó por `hilos` + `hilo_versiones` (docs/esquema.md §1). No compila
contra la base y arreglarlo era rehacerlo.

| Borrado | Qué era | Quién lo llamaba y qué pasa hoy |
| --- | --- | --- |
| `src/app/api/_lib/contexto-clinico/{cargar,actualizar,formato-llm,tipos}.ts` | Cargar, actualizar y formatear el contexto longitudinal | Sólo la ruta de abajo y su test |
| `src/app/api/pacientes/[id]/contexto-clinico/route.ts` | GET/PATCH del contexto, y `?format=llm` para el worker | `src/components/clinico/ContextoGoldenThreadView.tsx` (pestaña Recorrido de la ficha) sigue existiendo y compila; hoy recibe 404 y muestra su estado de error. `processor/contexto_worker.py` apuntaba acá y ya no tiene importadores. El reemplazo es `GET/PATCH /api/pacientes/[id]/hilo` (excluido del proxy, todavía sin ruta). |
| `src/app/api/pacientes/[id]/brief/route.ts` | El brief pre-sesión (contexto + últimas notas) | `card-ahora.tsx` (Hoy), `brief-corto.tsx` (detalle del turno) y `brief-pre-sesion.tsx` (ficha) lo piden y reciben 404; los tres tienen estado de error y compilan. |
| `src/app/api/sesion-clinica/aprobadas-sin-contexto/route.ts` y `casos-uso/sesiones-sin-contexto.ts` | El recorrido de sesiones aprobadas sin integrar al contexto (`CONTEXTO_DESDE`) | Nadie: el diseño 04 lo reemplaza por el trabajo `integrar_contexto`, que nace en la transacción de aprobar (ya existe en `trabajos`). |
| `src/lib/__tests__/contexto-clinico.test.ts` | Test de lo anterior | — |

`src/app/api/pacientes/[id]/progreso/route.ts` (los gráficos de la ficha)
**no** se borró: lee sesiones, no el contexto. Se adaptó al esquema nuevo
(`estado: "aprobada"`, campo lógico `datos`) y queda en las excepciones del
guardián como "Ola 2 (recorrido)" porque sigue llamando a Prisma desde la
ruta.

## 2. Borrado: la subida del grabador (Ola 2, diseño 01)

| Borrado | Por qué |
| --- | --- |
| `src/app/api/sesion-clinica/[id]/upload-url/route.ts` | Guardaba clave + IV del audio en `datosEstructurados._audioCifradoTemporal` y una `audioR2Key` que no existen; usaba `assertTransicionValida` y `conClaveTemporal`, borrados por el Área 2. El diseño 01 sube por segmentos (`audio_segmentos`, key calculada `org/sesión/índice`, un IV por segmento): es otra ruta. |
| `src/app/api/sesion-clinica/[id]/upload-confirmar/route.ts` | Ídem: verificaba una key que ya no se guarda y escribía columnas borradas (`error`, `audioR2Key`). El reemplazo es la operación `audio_listo` de `estados.ts` con los segmentos confirmados. |
| `src/lib/sesion-clinica-utils.ts` | Módulo de compatibilidad (`ensamblarNotaSOAP`) que sólo importaban los de arriba y la UI vieja; la UI ya lee `notaIa`/`notaFinal`. |

Lo que sigue en pie del grabador y compila contra el esquema nuevo, sin
rediseñar: `src/components/grabacion/**`, `src/app/(dashboard)/grabar/**`,
`src/hooks/useGrabacionSesion.ts` (sólo cambió de dónde importa un tipo),
`src/lib/grabacion-*.ts`. `useGrabacionSesion` y `grabar-view.tsx` siguen
llamando a `POST …/upload-url` y `…/upload-confirmar`, que ya no existen: la
grabación **no funciona de punta a punta** hasta la Ola 2, y eso es
deliberado. `POST /api/sesion-clinica` (crear) sigue con el código viejo,
mínimamente adaptado: la sesión nace en `grabando` y el `turnoId` se valida
como UUID (era `cuid`, y todo POST real daba 400).

## 3. Hallazgos de Codex sobre el código fusionado

Codex no pudo correr en esta rama: su token OAuth está revocado
(`codex login` es interactivo y lo tiene que hacer el dueño). Los cuatro
detalles de despacho y horario de SMS se buscaron a mano en los mismos
archivos; los que se encontraron y arreglaron, con su test:

1. **`misma_manana` con dispersión caía después del turno.** Un turno de las
   8:05 con corrimiento de 10 minutos avisaba a las 8:10, y el despachador lo
   cancelaba por "turno pasado". Ahora, si el aviso de la mañana no cae
   antes del turno, va la tarde anterior (`recordatorios-programacion.ts`;
   test "misma_manana con dispersión"). Cambia un caso viejo: un turno a
   las 8:00 en punto ya no avisa a las 8:00 (un SMS que nunca salía).
2. **Reprogramar dos veces perdía el cambio de horario.** `A → B → C` con el
   aviso de A entregado y el de B todavía sin salir programaba para C un
   "te recordamos" en vez de un "cambió el horario": sólo se miraba la
   clave de la fecha inmediatamente previa. Ahora cuenta cualquier aviso
   del turno que pudo llegar (`envios-del-turno.ts`; test "movido dos
   veces").
3. **Motivo equivocado para un aviso de cobro vencido.** La ventana útil del
   cobro es un día, y el motivo decía "antes de la sesión"
   (`backoff.ts`, `MOTIVO_VENTANA_AGOTADA_SIN_TURNO`; test).
4. **Relojes sueltos.** `cancelarEnviosDelTurno` cerraba con `new Date()`
   aunque el caso de uso recibiera `ahora`, y el texto del aviso de cobro
   calculaba la deuda con su propio reloj en vez del de la corrida. Ahora
   los dos reciben el instante (`envios-del-turno.ts`, `texto-de-cobro.ts`).

Los otros hallazgos de la consigna: no quedaba ningún importador de módulos
borrados fuera de lo listado arriba; ningún fixture usaba ya
`__resetKeyCacheForTests` (el Área 3 los había migrado a
`__resetLlaveroForTests`; `recordar-cobro.test.ts` no fijaba
`CLAVES_CIFRADO` y se corrigió); `/login?sesion=` llama a
`/api/cuenta/limpiar` en vez de `/api/cuenta/salir`.

## 4. Guardián de rutas

`EXCEPCIONES_TEMPORALES` en `src/lib/__tests__/rutas-sin-prisma.test.ts`
quedó con cinco rutas, todas con dueño: `cuenta/password` y
`pacientes/[id]/consentimiento` (Área 3), `pacientes/[id]/documentacion` y
`sesion-clinica` (crear) y `pacientes/[id]/progreso` (Ola 2). Las cinco del
Área 5 (`health`, `estado-worker`, `sms/callback`, `sms/entrante`,
`cron/recordatorios`) migraron a `casos-uso/operacion.ts`,
`casos-uso/sms-webhooks.ts` y `casos-uso/texto-de-cobro.ts`.

## 5. Para el cierre de textos (glosario y ayuda)

Nada nuevo acá: los textos pendientes siguen en `02-estados.md` §1,
`03-identidad.md` §1, `05-operacion.md` §4 y `06-estructura.md`. La UI de la
sesión clínica se adaptó al contrato nuevo conservando los textos que
tenía ("Descartar la nota" sigue diciendo eso aunque ahora llame a
`POST …/reprocesar`): renombrar los botones es parte de ese cierre.

## 6. Lo que la Ola 2 tiene que saber

- `docs/pendientes/02-estados.md` §3 describe la costura del grabador con
  `transicionar` y los segmentos; `03-identidad.md` §3 el proxy y CSRF;
  `05-operacion.md` §3 la pantalla del turno y cobros.
- La pestaña Recorrido, el brief y los tres consumidores del brief están en
  el código y compilan, pero no tienen backend: se reconstruyen con
  `hilos` + `hilo_versiones`, no se "arreglan".
- `processor/contexto_worker.py` y `callback.py` no tienen importadores y
  `obtener_contexto_clinico_llm` apunta a una ruta borrada: repuntar a
  `/hilo` (contrato del 04).
