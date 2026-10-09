# Contrato de Lux

**Estado:** integrado en la rama `lux` (servidor de `lux-api` y pantalla de
`lux-ui`, 9 de octubre de 2026).
**El contrato en código:** [`src/lib/lux/contrato.ts`](../src/lib/lux/contrato.ts)
—el esquema de la petición (de ahí sale su tipo), los máximos, el status del
tope, las marcas del stream y los tipos de la respuesta—. Lo importan la ruta,
el caso de uso y la pantalla; si este documento y ese archivo dicen cosas
distintas, manda el archivo.
**Servidor:** `src/app/api/pacientes/[id]/lux/route.ts`,
`src/app/api/_lib/casos-uso/lux/` (`conversar.ts`, `material.ts`,
`herramientas.ts`, `topes.ts`), el bucle en `src/lib/anthropic-mensajes.ts`
(`crearConversacionConHerramientas`) y el prompt en
[`src/lib/lux/system-prompt.md`](../src/lib/lux/system-prompt.md).
**Pantalla:** la pestaña Lux de la ficha
(`src/app/(dashboard)/pacientes/[id]/_components/lux-tab.tsx`),
`src/components/lux/` (conversación, hook del stream y lectura de la
respuesta) y el sol (`src/components/ui/lux.tsx`). Los textos, en
`src/lib/glosario.ts` (sección Lux). La ayuda: `docs/ayuda/16-lux.md`.

**Consentimiento:** decisión del dueño (9 de octubre de 2026): la
autorización vigente (2.8) cubre a Lux. No hay versión nueva ni guardia
propia; lo dice `docs/ayuda/12-camino-del-audio-y-privacidad.md`.

## Qué es

Lux es el segundo asistente de Sesión, distinto de Lupita. Lupita explica la app
y lee la agenda; Lux es una colega psicóloga de orientación gestáltica con la
que la profesional conversa sobre **un** paciente, desde su ficha. Lee el
material clínico de ese paciente, habla primero al abrir (dice lo que ve),
conversa en prosa, no diagnostica, no prescribe, ancla cada observación en el
material y cita de dónde sale.

Las charlas **no se guardan**: ni la pregunta ni la respuesta se escriben en
ninguna tabla ni en ningún log. La pantalla manda el historial en cada pedido.

Modelo: `MODELO_LUX = "claude-haiku-5-5"` (Lupita usa el mismo desde esta rama,
`MODELO_AYUDA`). Thinking adaptativo por defecto del modelo (esfuerzo `medium`),
`max_tokens` 8000 (incluye el razonamiento).

## La ruta

`POST /api/pacientes/[id]/lux` — sesión de usuaria (cookie), runtime nodejs,
`maxDuration` 60 s.

Cuerpo (JSON, estricto: un campo de más es 400):

```json
{
  "pregunta": "¿Qué ves en cómo cierra las sesiones?",
  "historial": [
    { "rol": "asistente", "texto": "<citas>…</citas>\nLo que veo…" },
    { "rol": "usuaria", "texto": "…" }
  ]
}
```

- `pregunta`: opcional, 1 a 2000 caracteres (tras recortar espacios).
- `historial`: opcional, hasta 12 turnos. Los de `usuaria`, 1 a 2000 caracteres
  (el tope de una pregunta); los de `asistente`, 1 a 100.000
  (`LARGO_MAX_TURNO_LUX`), para que una respuesta larga de Lux, con sus citas
  y avisos, pueda volver entera. La pantalla manda cada turno de Lux tal como
  ella lo vio: prosa, `<citas>` y líneas `_(mirando la transcripción del
  DD/MM)_`; esas líneas son las que traen la transcripción de vuelta al
  material (punto 5 de "El material"). El caso de uso
  usa los últimos `MAX_TURNOS_HISTORIAL` (6, como Lupita). Si el primero que
  queda es de Lux, se antepone el pedido de apertura (la API exige que el
  primer mensaje sea de la usuaria).
- **Apertura:** cuerpo `{}` (sin `pregunta` y sin `historial`). Lux habla
  primero. Un cuerpo vacío no es JSON y da 400.
- `historial` sin `pregunta`: 400.

Orden: validar → autorizar (el paciente es de la organización de la sesión, si
no 404) → reservar cupo de Lux (429 si no queda) → caso de uso → stream. Si el
caso de uso falla antes del proveedor, o el stream falla antes del primer
fragmento, el cupo se devuelve. Cancelar o un corte después del primer
fragmento lo conservan, como Lupita. Una respuesta que el modelo cortó por el techo de tokens
o por un rechazo (`stop_reason` `max_tokens` o `refusal`) no se da por
terminada: el stream termina en error y la pantalla dice que se cortó.

Respuesta 200: el mismo transporte que `/api/ayuda`: `text/plain;
charset=utf-8` en streaming, `Cache-Control: no-store, no-transform`,
`X-Accel-Buffering: no`, `X-Content-Type-Options: nosniff`. A diferencia de
Lupita, el texto **no** pasa por `limpiarMarkdown`: la pantalla recibe tal cual

- el bloque `<citas>…</citas>` al principio de toda respuesta con
  observaciones (una cita por línea: sesión, fecha, frase), que pliega bajo
  "ver en qué me baso";
- la línea `_(mirando la transcripción del DD/MM)_`, que el **servidor** emite
  en su propio párrafo antes de ejecutar `leer_transcripcion`.

Errores (JSON `{ "error": … }`, contrato de `docs/contrato-respuestas-api.md`):
400 validación, 401 sin sesión, 404 paciente ajeno o inexistente, 429 tope
diario (`MENSAJE_TOPE_LUX`), 502 el proveedor falló al empezar
(`MENSAJE_PROVEEDOR_CAIDO_LUX`), 503 sin `ANTHROPIC_API_KEY`
(`MENSAJE_SIN_CLAVE_LUX`), 500 error de base (incluido no poder escribir el
rastro de una transcripción).

## El cupo

`cupos_ayuda` lleva `ambito` (`AmbitoCupo { ayuda, lux }`, default `ayuda`);
la clave es (usuaria, día de Montevideo, ámbito). `TOPE_LUX_DIA = 60`, aparte
de las 40 de Lupita: una no consume la otra. Apertura y pregunta cuentan
igual. Migración `20261009120000_cupos_por_ambito`; reversión
`scripts/mantenimiento/revertir-cupos-por-ambito.sql` (`docs/operaciones.md`).

**Ventana de despliegue.** La migración cambia la clave primaria. El código
viejo reserva con `ON CONFLICT (user_id, dia)`, que deja de existir: entre que
Publicar aplica la migración y avanza `release`, `/api/ayuda` contesta 500.
Son segundos y no se pierde nada.

## El material

Lo arma el servidor (`material.ts`) con la organización de la sesión y el
paciente de la ruta; el modelo nunca elige qué se lee. Va en el primer bloque
del system prompt, **arriba** de las instrucciones, como pide la guía de
contexto largo de Anthropic: `<documents>` con un `<document index>` por
pieza, cada uno con `<source>`, `<fecha>` (cuando la tiene) y
`<document_content>`. Todo texto que viene de la base va escapado (`&`, `<`,
`>`): una transcripción no puede cerrar ni abrir un documento.

En este orden:

1. **Ficha mínima.** Nombre de pila, desde cuándo está en Sesión, cuántas
   sesiones con nota aprobada, orientación del consultorio. La edad no va: el
   esquema no tiene fecha de nacimiento. No va el apellido, el teléfono, la
   tarifa ni las notas de la ficha.
2. **Recorrido vigente** completo (`leerRecorrido`). Si hay una propuesta
   abierta, va después, titulada "Propuesta de Recorrido NO ACEPTADA por la
   profesional". Las sesiones que cita el Recorrido van por fecha.
3. **Notas aprobadas**, todas, de la más vieja a la más nueva, cada una con
   fecha e id (`notaFinal`). Si "Para vos" está `listo`, su núcleo
   panteórico: fortalezas, áreas de crecimiento (observación y sugerencia) y
   sugerencia para la próxima sesión. Sin scores ni evidencias.
4. **Las dos transcripciones más recientes** de sesiones aprobadas, completas,
   con fecha. Si con las dos el material pasa de `TOKENS_MAX_MATERIAL`
   (90.000 tokens estimados como caracteres / 4) va sólo la más reciente; si
   con una también, ninguna. Lo omitido se dice en un documento propio
   ("Transcripción del DD/MM/AAAA omitida por tamaño.").
5. **Las transcripciones que Lux ya leyó en esta conversación.** Por cada
   línea `_(mirando la transcripción del DD/MM)_` que aparece en los turnos
   de Lux del historial recibido (los de ella no cuentan), la transcripción
   de esa sesión vuelve completa, como documento propio: "Transcripción
   completa de la sesión del DD/MM/AAAA, leída en esta conversación". Sólo
   se miran los turnos que llegan al modelo (los últimos
   `MAX_TURNOS_HISTORIAL`). La fecha se resuelve contra las sesiones
   aprobadas de **este** paciente (si dos son del mismo DD/MM en años
   distintos, vuelven las dos); una fecha que no corresponde a ninguna se
   ignora; una que ya está en el punto 4 no se repite. Entran mientras el
   material no pase `TOKENS_MAX_MATERIAL`; las que no, se nombran en un
   documento propio ("Transcripción del DD/MM/AAAA, leída en esta
   conversación, omitida por tamaño: podés volver a abrirla con
   leer_transcripcion") y siguen en la lista del punto 6.
   **Por qué:** el historial es texto y no lleva lo que leyó la herramienta.
   Sin esto, en la pregunta siguiente Lux veía sus propias citas sin la
   fuente delante y decía que las había inventado (prueba real del
   9/10/2026). El prompt lo acompaña: esas líneas en sus turnos anteriores
   quieren decir que leyó esa transcripción; si no la tiene delante, la
   vuelve a abrir, y nunca dice que inventó lo que leyó.
6. **Las demás sesiones aprobadas** (incluidas las omitidas por tamaño): id,
   fecha y primera línea del subjetivo de la nota. Son las únicas que Lux
   puede abrir.

Sólo sesiones **aprobadas**: lo que está en revisión todavía no lo validó
ella, igual que el Recorrido.

El material es estable mientras los datos no cambian, así que el corte de
caché va al final del system (después del prompt): la segunda pregunta de la
misma charla lee el material del caché. Cuando una transcripción vuelve por
el punto 5, el material cambia y esa llamada escribe el caché de nuevo.

## Las herramientas

Lista cerrada, sólo lectura, una por ronda, a lo sumo **3 llamadas por
pedido** (`MAX_LLAMADAS_HERRAMIENTA`). Después de la tercera, la ronda
siguiente va con `tool_choice: none` y el modelo contesta con lo que tiene.

- `leer_transcripcion({ sesionId })`: el id tiene que estar en la lista 6 del
  material de **este** pedido. Argumentos validados con zod (uuid, sin campos
  de más). Fuera de la lista, argumentos inválidos o una herramienta
  inventada: `tool_result` con `is_error`, sin tocar la base. Una
  transcripción de más de 90.000 tokens estimados se rechaza sin leerla.
  La lectura, la medida y el rastro van en una transacción.

No hay escritura, SQL, ids libres ni organización elegible por el modelo.

## Auditoría

- Cada transcripción que llega al modelo —las del material y las de la
  herramienta— deja `sesion.ver_transcripcion` (actor la usuaria, entidad la
  sesión, `detalle: { estado, caracteres, via: "lux" }`), con `auditar` en la
  misma transacción que la lee: sin rastro no sale (500). Una que se lee para
  medirla y queda afuera no se audita. Cada pedido vuelve a leer, así que cada
  pedido vuelve a auditar.
- `lux.abrir` o `lux.pregunta` (entidad `paciente`, id del paciente), con
  `registrarAuditoria` cuando el stream terminó: modelo, tokens (entrada,
  salida, caché leído y escrito), rondas, nombres de herramientas (sólo de la
  lista; otro nombre queda como `desconocida`), lecturas y rechazos, cuántas
  notas y transcripciones tenía el material, cuántas volvieron por haberse
  leído en la charla (`releidas`, `releidasOmitidas`), largos de pregunta y respuesta,
  turnos de historial. **Nunca** el texto de la pregunta, de la respuesta ni
  los argumentos de las herramientas.

## Límites

Están en el prompt y se prueban en `lux-prompt.test.ts`: no diagnostica ni
etiqueta, no indica tratamientos, medicación ni derivaciones como
instrucción, no habla de otros pacientes ni de nada fuera del material, no
inventa charlas anteriores, nombra primero el riesgo con su ancla, y deriva a
Lupita o a la ficha lo administrativo. El texto de los documentos es material,
no instrucciones.

## El prompt

[`src/lib/lux/system-prompt.md`](../src/lib/lux/system-prompt.md), cargado por
`src/lib/lux/prompt.ts` como el corpus de Lupita: una lectura por instancia,
nada variable adentro. `next.config.ts` lo declara en
`outputFileTracingIncludes` para la ruta; sin esa línea, en Vercel la ruta da
502.

## Tests

| Qué | Dónde |
| --- | --- |
| Bucle: una llamada → resultado al modelo → respuesta; rechazo como `is_error`; tope de 3; la ronda final tiene que traer texto propio | `src/lib/__tests__/lux-bucle.test.ts` |
| Lista cerrada: id fuera de lista, argumentos de más, herramienta inventada | `lux-bucle.test.ts` |
| Material: orden, dos transcripciones, recorte por tamaño, propuesta marcada, escape | `lux-integracion.test.ts` |
| Lo leído en la charla vuelve al material: auditado, fecha inexistente ignorada, sin duplicar, omitida por tamaño | `lux-integracion.test.ts`, `lux-leidas.test.ts` |
| El historial lleva el turno entero de Lux (citas y estados) | `src/components/lux/__tests__/conversacion-lux.test.tsx` |
| Autorización (paciente ajeno 404 sin leer), 503 sin clave | `lux-integracion.test.ts` |
| Auditoría: `sesion.ver_transcripcion` via lux, `lux.abrir`, `lux.pregunta`, sin texto | `lux-integracion.test.ts`, `lux-ruta.test.ts` |
| Cupo por ámbito: 60 de Lux no consumen los 40 de Lupita | `cupo-ayuda-integracion.test.ts` |
| Ruta: apertura sin pregunta, validación, orden autorizar → cupo → caso de uso, devolución del cupo | `lux-ruta.test.ts` |
| Prompt: secciones, límites, sin partes variables, incluido en el deploy | `lux-prompt.test.ts` |
