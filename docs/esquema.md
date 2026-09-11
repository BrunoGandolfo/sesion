# El plano de la base de datos de Sesión

Fecha: 11 de septiembre de 2026 · Rama `esquema` · Archivos: `prisma/schema.prisma`,
`prisma/migrations/0_init/migration.sql`, `prisma/seed.ts`.

Este documento explica, en lenguaje llano, qué guarda la base de datos nueva de
Sesión, por qué está armada así, y qué decisiones tomé donde los seis diseños de
la Fase 1 no coincidían. Está escrito para que lo apruebe el dueño; los seis
agentes de la Fase 3 construyen sobre lo que dice acá y sobre el archivo
`prisma/schema.prisma`, que tiene el mismo contenido en forma técnica y con un
comentario en cada decisión que no sea obvia.

**Qué se descartó.** El esquema anterior y sus 13 migraciones desaparecen
enteros. No hay datos reales ni usuarias: no hay nada que conservar ni que
convertir. La base se crea desde cero con una sola migración inicial.

**Cómo se verificó.** `prisma validate` y `prisma generate` en verde. La
migración se aplicó desde cero contra un Postgres 17.10 real y limpio, se cargó
el seed dos veces (la segunda no duplica nada), y se probó con SQL que las
restricciones escritas a mano rechazan lo que tienen que rechazar (una duración
de 33 minutos, una segunda propuesta abierta de la IA para la misma paciente,
un término de vocabulario repetido sin paciente, una versión 0 del hilo).
`prisma migrate diff` entre la base aplicada y el esquema no detecta diferencias:
los índices parciales y los CHECK escritos a mano no rompen el control de drift
que el área 5 quiere poner en CI. Una nota honesta: la consigna pedía Docker; en
esta máquina Docker no está disponible en WSL y no hay permisos de
administrador, así que usé los binarios oficiales de Postgres 17.10 que trae el
paquete `embedded-postgres`, instalado fuera del repositorio. Es el mismo
Postgres, sin contenedor.

**Cómo correr el seed.** `DATABASE_URL=… node prisma/seed.ts` (Node 22.18 o
más nuevo quita los tipos solo; también sirve `npx tsx prisma/seed.ts`). Crea una
organización, una profesional (`profesional@sesion.test`, contraseña
`sesion-dev-1234`), tres pacientes, ocho turnos (tres pasados, uno futuro suelto
y una serie semanal de cuatro) y dos SMS programados. No escribe ninguna columna
cifrada: el seed no depende del código de cifrado de `src/`, que todavía habla
con el esquema viejo. Que `tsc` falle en esta rama es esperado.

---

## 1. Qué hay en la base, tabla por tabla

Convenciones que valen para todo: nombres en español; toda tabla con datos de un
consultorio lleva `organization_id`; todo estado es un tipo cerrado de Postgres
(un "enum": la base rechaza cualquier valor que no esté en la lista); los ids
son UUID que genera la app antes de escribir (ver §2, punto 12); y las columnas
que terminan en `_encrypted` guardan texto cifrado con el formato nuevo `ENC2`,
atado a su propia fila para que un blob copiado de una fila a otra no se pueda
abrir.

### Organización y cuenta

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `organizaciones` | El consultorio: nombre y fecha de alta. | Es la raíz de todo; hoy una profesional por organización. | El alta de cuenta. | Toda consulta filtra por ella. |
| `usuarios` | La profesional: email, hash de contraseña, nombre, **rol** (hoy un único valor, `titular`). | Entrar, y decidir quién puede invitar. | Alta, cambio de contraseña. | Entrar, invitaciones, auditoría. |
| `sesiones_acceso` | Cada dispositivo desde el que está entrada: hash del token de la cookie, cuándo se creó, último uso, vencimiento, cuándo y por qué se cerró, IP y navegador de la creación. | Reemplaza al token firmado de 30 días que no se podía apagar. Cerrar sesión cierra de verdad; cambiar la contraseña cierra todas. | Entrar (crea), salir, cambio o restablecimiento de contraseña (cierran), cron de mantenimiento (vence y purga a los 30 días). | Cada request (una consulta indexada), la pantalla "desde dónde estás entrada" (sin IP). |
| `intentos_acceso` | Cada intento **fallido** de entrar, cambiar contraseña o pedir recuperación, con la clave que se cuenta (email hasheado, IP, usuaria) e IP/navegador. | Bloqueo por intentos. Antes vivía mezclado en la auditoría clínica, con IPs adentro. | Las tres rutas de cuenta. | El contador de bloqueo; el cron purga a los 30 días. |
| `password_resets` | Enlaces de recuperación: hash del token, vencimiento, cuándo se usó y **cuándo salió el correo**. | Un enlace cuyo correo no salió no vale y no gasta el cupo. | Recuperar (crea y marca enviado), restablecer (marca usado), cron (purga). | Restablecer, el cupo de tres por hora. |
| `invitaciones` | Hash del token, vencimiento, cuándo se usó, quién la creó. | Que una colega abra su propio consultorio. Tope de vigentes por creadora (constante en el código, marcada temporal). Crear y usar dejan evento de auditoría. | Crear invitación, registro. | Registro, el tope. |
| `cupos_ayuda` | Por profesional y día: cuántas preguntas le hizo a Lupita. | Reservar el cupo **antes** de llamar al proveedor, en una sola operación atómica. Cortar una respuesta cuenta igual. | La ruta de ayuda. | La misma. |
| `configuraciones` | Nombre profesional, dirección, WhatsApp, tarifa por defecto, cuándo sale el recordatorio (`dia_anterior` / `dos_dias_antes` / `misma_manana`), plantilla del SMS, orientación teórica (`cbt_mi` / `gestalt`). | Una fila por organización. Sale `horasAnticipacion` (nadie la leía). | Pantalla de configuración. | Recordatorios, SMS, el worker (orientación). |

### Pacientes y agenda

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `pacientes` | Nombre, apellido, teléfono (E.164), tarifa, activa o no, y **notas privadas cifradas**. Sale `email` (nadie lo usaba). | La ficha. Nombre, apellido y teléfono quedan en claro a propósito: la búsqueda, el orden de la agenda y el envío de SMS en lote los necesitan en SQL. | Alta y edición de paciente. | Agenda, ficha, cobros, SMS, worker (id solamente). |
| `series_turno` | Un turno recurrente: paciente, frecuencia (`semanal` / `quincenal`) y la hora ancla (el instante del primer turno). | Generar los turnos de la serie y "cancelar el resto". Nada más: no hay `generadaHasta`, `activa` ni avisos. | Crear turno con repetición. | Cancelar el resto de la serie. |
| `turnos` | Fecha, duración (minutos: 30/45/50/60/90, restricción en la base), modalidad, estado (`programado` / `realizado` / `cancelado` / `ausente`), tarifa cobrada, estado y método de pago, fecha de pago, **nota privada cifrada**, y a qué serie pertenece (opcional). | La agenda y los cobros. Cada turno es independiente aunque venga de una serie. | Agenda, cobros, la generación de series, "cancelar el resto". | Agenda, Hoy, cobros, deudores, ficha, grabación. |

### SMS

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `envios_sms` | Cada SMS que la app decidió mandar: motivo (`recordatorio_turno` / `cambio_de_horario` / `recordatorio_cobro`), estado (ocho: `pendiente`, `enviando`, `aceptado`, `entregado`, `no_entregado`, `cancelado`, `fallido`, `desconocido`), paciente, turno, teléfono congelado, cuándo debía salir, próximo intento, intentos, el identificador que devuelve Twilio (`sid`), el código de error del proveedor, un motivo en palabras para la pantalla cuando no hay código, y cuántos segmentos cobró Twilio. Una **clave de idempotencia** única: dos pedidos con la misma clave son el mismo mensaje. **Nunca el texto** (decisión del dueño). | Reemplaza a `recordatorios`. "Aceptado" no es "llegó": la confirmación del operador escribe `entregado` o `no_entregado`. `desconocido` (se llamó a Twilio y no sabemos qué pasó) **nunca** se reenvía solo. Reprogramar un turno produce una clave nueva y un mensaje de cambio de horario. | Crear/mover/cancelar turno, el cron de despacho, el webhook de estado de Twilio, la conciliación. | Cron, pantallas de agenda y cobros, conteo mensual por consultorio. |
| `bajas_sms` | Teléfonos que respondieron "BAJA" (o que Twilio marcó como dados de baja), con motivo. | Obligación legal: se consulta antes de **todo** envío. Es por número, no por consultorio: la baja es del teléfono. | El webhook de SMS entrantes; el código 21610 de Twilio; a mano. | Todo envío. |

### Consentimiento

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `consentimientos_grabacion` | Paciente, cuándo firmó, cuándo revocó, versión del texto, y **texto íntegro y firma cifrados**. Sale la IP (decisión del dueño). | Autorizar la grabación. Vigente = sin revocación. | Firmar, revocar. | Grabar (exige vigente), ficha, exportación a PDF. |

### Sesión clínica y audio

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `sesiones_clinicas` | Una fila por turno grabado. **Estado** (`grabando`, `subiendo`, `procesando`, `revision`, `aprobada`, `fallida`; `aprobada` es el único terminal). **Audio**: dónde está (`sin_audio` / `en_r2` / `borrado`), la clave cifrada (el IV de cada segmento vive en `audio_segmentos`), duración, pausas, cuándo se borró. **Procesamiento**: número de intento (identidad de cada reclamo del worker, nunca se resetea), fallos seguidos, próximo intento, vencimiento del lease, hash del ticket del worker, código y detalle del fallo. **Resultado** (todo cifrado): transcripción, nota de la IA de la generación vigente, datos estructurados, "Para vos" con su propio estado (`no_pedido` / `pendiente` / `listo` / `fallido`), id del transcript en AssemblyAI, modelos, versión del prompt, consumo (`uso`). Métricas de habla en claro (números, no contenido). **Aprobación**: nota final (con las ediciones), comentarios, fecha. | La vida de una grabación hasta la nota aprobada. La clave del audio se destruye en la misma transacción que aprueba. La transcripción se guarda apenas termina el ASR (checkpoint): ningún reintento vuelve a transcribir. | La app (grabar, subir, aprobar, reprocesar, reintentar, eliminar) y el worker (reclamar, lease, checkpoint, resultado), siempre con el estado de partida y el intento en el `WHERE`. | Pantalla de la nota, ficha, "Ahora", brief, worker, salud. |
| `audio_segmentos` | Por sesión y por índice: el IV de 12 bytes con que se cifró ese segmento (en claro: no es secreto), tamaño en bytes, sha256, cuándo se confirmó en R2. | El inventario de los segmentos de ~60 s que el teléfono cifra y sube mientras graba. Un IV propio por segmento: nunca se repite nonce con la misma clave. La ubicación en R2 **no se guarda**: se calcula `organización/sesión/índice`. Ningún pedido del cliente trae una key. | Reservar y confirmar segmentos. | Finalizar la grabación (¿están todos?), el worker (qué bajar), el borrado. |

### Trabajo durable y worker

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `trabajos` | Cosas que hay que hacer afuera de la base, para hacerlas después y reintentar si fallan: tipo (`borrar_audio_r2`, `borrar_transcript_asr`, `generar_feedback`, `integrar_contexto`), quién lo ejecuta (`app` o `worker`), a qué sesión y paciente refiere, un payload **sin contenido clínico**, estado (`pendiente` / `en_curso` / `hecho` / `fallido`), intentos, próximo intento, lease, hash del ticket, último error, consumo. | El request solo escribe en la base; el borrado en R2, el borrado en AssemblyAI, "Para vos" y la propuesta al hilo se hacen después. `integrar_contexto` nace en la **misma transacción** que aprueba la nota: no hay fecha de corte ni recorrido de aprobadas. | Aprobar, eliminar, el worker (al crear el transcript), "pedir de nuevo", regenerar propuesta; el cron y el worker al ejecutarlos. | El cron de la app, el worker, salud. |
| `worker_estado` | Una sola fila: id del worker, versión, último poll, último trabajo. | Señal de vida sin ruta nueva: la app la actualiza en cada `GET /pendientes`. Sin poll en N minutos, alerta. | La ruta de pendientes, lease y resultados. | Salud y el monitor externo. |

### Vocabulario del ASR

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `hot_words` | Alcance (`global` / `profesional` / `paciente`), paciente si corresponde, **término cifrado**, hash del término normalizado (solo para unicidad), categoría, activa. | Mejorar la transcripción. El término va cifrado porque puede ser un nombre propio del entorno de la paciente. | Pantalla de vocabulario. | El reclamo del worker (los manda a AssemblyAI). |

### Recorrido (hilo longitudinal)

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `hilos` | Una fila por paciente: cuál es la versión vigente y el contador de versiones. | Es la fila que se bloquea para asignar números: no hay dos escritores que creen la misma versión. Mover el puntero es un solo `UPDATE`. | Editar, aceptar. | Recorrido, brief, la nota siguiente (solo la vigente). |
| `hilo_versiones` | Cada escritura es una fila nueva, nunca se edita: número de versión, sobre qué versión se escribió, actor (`profesional` / `ia`), estado (`aplicada` / `propuesta` / `desactualizada` / `rechazada`), **todo el contenido en un solo blob cifrado** (hipótesis, resumen, objetivos, intervenciones, temas, riesgos y la lista de cambios de la IA), qué sesión la motivó, versión del prompt y modelo, quién la creó, quién y cuándo la resolvió, de qué propuesta nació si fue "editar y aceptar". Índice en la base: **a lo sumo una propuesta abierta por paciente**. | La IA solo propone; la profesional acepta, edita y acepta, o rechaza (y rechazar cierra el tema para esa sesión). Nada de lo que ella escribió se pierde. Reemplaza a `paciente_contexto_clinico` y sus tres columnas JSON en claro. | Editar, proponer (resultado de `integrar_contexto`), aceptar, rechazar, restaurar. | Recorrido, historial, brief, la Llamada A (solo la vigente). |

### Auditoría

| Tabla | Qué guarda | Para qué | Quién escribe | Quién lee |
|---|---|---|---|---|
| `eventos_auditoria` | Quién hizo qué, cuándo, sobre qué; un detalle sin texto clínico, sin datos personales, **sin IP ni navegador**. | Rastro clínico, append-only, sin relaciones que puedan borrarlo en cascada. Vuelve a ser solo eso: los intentos de acceso se fueron a su tabla. Cada exportación a PDF (nota, ficha, estado de cuenta) deja su acción (`sesion.exportar_pdf`, `paciente.exportar_ficha_pdf`, `paciente.exportar_estado_cuenta_pdf`): no hace falta una tabla nueva. | Toda operación relevante. | El administrador; la ficha (historia de una entidad). |

### Lo que ya no existe

`recordatorios` (reemplazada por `envios_sms`), `paciente_contexto_clinico`
(por `hilos` + `hilo_versiones`), y estas columnas: `Configuracion.horasAnticipacion`,
`Paciente.email`, `Paciente.notas` en claro, `Turno.notas` en claro,
`Recordatorio.textoEnviado`, `Invitacion.email` y `organizationId`,
`ConsentimientoGrabacion.ipOrigen`, `HotWord.termino` en claro,
`SesionClinica.audioR2Key`, `hablanteTerapeuta`, `notaSoapOriginal`, `error`,
`intentos` (reemplazado por `intento` + `fallosSeguidos`), y la clave del audio
escondida dentro de `datosEstructurados`.

**Retención.** El esquema no lleva plazos de retención de nada clínico: no hay
borrado por antigüedad. Las únicas purgas son operativas y las hace un cron:
`intentos_acceso`, `sesiones_acceso` cerradas o vencidas, `password_resets` e
`invitaciones` usados o vencidos, todas a los 30 días.

---

## 2. Choques entre los diseños y cómo quedaron

Los once primeros los resolvió el dueño en la consigna; los aplico tal cual y
anoto cómo se ven en el esquema. Del 12 en adelante son los que encontré yo.

1. **Audio.** No se adopta el formato binario `SAP1` ni el manifiesto con hash
   del diseño 01. La sesión lleva la clave cifrada en columna propia,
   `audio_estado`, y la tabla `audio_segmentos` mínima más una columna `iv`
   por segmento (ver §5, punto 1, aceptado por el dueño). La key de R2 no
   existe como columna.
2. **Estados de la sesión.** El enum y las columnas de identidad del intento
   son los del 02, más `speech_analytics` y `uso` que pidió el 04.
3. **Trabajos.** La tabla genérica del 02 con los cuatro tipos; `integrar_contexto`
   nace en la transacción de aprobar (04 gana). Le agregué `paciente_id` porque
   la regla de encadenado del 04 ("una propuesta por paciente a la vez") es una
   consulta `NOT EXISTS` sobre trabajos por paciente, y sin la columna no se
   puede escribir.
4. **Identidad del worker.** Un solo mecanismo: `ticket_hash` en
   `sesiones_clinicas` y también en `trabajos`, porque el worker informa
   resultados de trabajos y necesita la misma credencial. No hay `ticketTipo`
   (el tipo es la tabla donde está el hash) ni `ticketVenceEn` (vence con el
   lease de la misma fila). El ticket de tipo `contexto` del 03 desaparece
   junto con el endpoint `aprobadas-sin-contexto` que el 04 elimina.
5. **Recorrido.** `hilos` + `hilo_versiones` como el 04, con el índice parcial
   escrito a mano en la migración. Se borra `paciente_contexto_clinico`.
6. **Identidad y cifrado.** Sesiones en base, intentos aparte, columnas
   cifradas nuevas (notas de paciente y turno, texto y firma del consentimiento,
   término del vocabulario con su hash), y los borrados del 03.
7. **SMS.** `envios_sms` con los ocho estados, clave de idempotencia, motivo,
   `sid`, código del proveedor, segmentos, sin texto; más `bajas_sms`. Se borra
   `recordatorios`.
8. **Latido del worker.** `worker_estado` del 04. No hay tabla `latidos` ni
   ruta nueva; la ruta pública `/api/estado-worker` del 05 lee esta fila.
9. **Cupo de Lupita.** `cupos_ayuda` del 04.
10. **Constantes.** Duraciones, modalidades y métodos de pago viven en
    `src/lib/constantes-turno.ts`; en la base, `modalidad`, `pago_metodo` y todos
    los estados son enums, y `duracion` es entero con CHECK. El 06 quería CHECK
    para los tres por coherencia; el dueño eligió enums y una sola excepción,
    y así está.
11. **Columnas muertas afuera.** Todas las de la lista, más `SesionClinica.intentos`
    (reseteable, reemplazado por `intento` monotónico + `fallos_seguidos`).
12. **UUID en vez de cuid.** El 03 pide uuid porque el cifrado ata cada blob a
    su fila y el id tiene que existir antes de escribir; la consigna decía
    "cuid como hasta ahora" y me pidió decidir. Elegí **uuid**: el navegador y
    el servidor lo generan con `crypto.randomUUID()` sin ninguna dependencia
    nueva, mientras que cuid obligaría a sumar una librería. Las columnas
    siguen siendo texto (no el tipo `uuid` de Postgres) para que los tests
    puedan usar ids de prueba legibles.
13. **Detalle del fallo.** El 02 lo quería texto libre; el 03 lo acota a 500
    caracteres. Queda acotado (`fallo_detalle`, `feedback_error`,
    `ultimo_error`, `motivo_no_envio`: todos `VARCHAR(500)`).
14. **Estado inicial de "Para vos".** El 02 arranca en `no_pedido`; el 04 dice
    que arranca en `pendiente` porque la app crea el trabajo al recibir la nota.
    Las dos cosas son ciertas en momentos distintos: la fila nace `no_pedido`
    (todavía no hay nota) y pasa a `pendiente` en la transacción que guarda la
    nota y crea `generar_feedback`.
15. **Serie de turnos.** El 06 pedía `duracion`, `modalidad`, `generadaHasta`,
    `activa`, renovación con aviso y un índice por paciente. El dueño la redujo
    a frecuencia, hora ancla y paciente. La hora ancla la modelé como el
    instante del primer turno (`hora_ancla`, fecha y hora), no como un texto
    "HH:mm": fija también el día de la semana y evita ambigüedades de zona
    horaria; las ocurrencias son ese instante más 7 o 14 días. Sin
    `generadaHasta`, la duración y la modalidad no hacen falta en la serie:
    la serie se genera completa al crearla con los valores del formulario, y
    cada turno ya los tiene.
16. **Índices de hot words.** El esquema viejo tenía tres índices sueltos
    (organización, alcance, paciente). La única lectura real (los términos de
    la organización por alcance más los de una paciente) la cubre el índice de
    unicidad. Se van los tres. Y agregué a mano un índice único parcial para
    las filas sin paciente: Postgres no considera iguales dos `NULL`, así que
    el UNIQUE de Prisma solo no impedía cargar dos veces el mismo término
    global. Se probó.
17. **Índice de consentimientos por organización.** Existía; ninguna consulta de
    los diseños lo usa. Queda solo el índice por paciente (vigente).
18. **`sesion_id` y `paciente_id` en trabajos y `sesion_origen_id` en versiones
    del hilo van sin clave foránea.** La sesión puede borrarse (eliminar) y el
    trabajo tiene que completarse igual; la versión del hilo es trazabilidad y
    no debe frenar ni cascadear borrados. Es la misma regla que ya seguía la
    auditoría.
19. **Borrado en cascada.** Solo donde un diseño lo dice o es evidente: lo que
    es de la usuaria se va con la usuaria (sesiones de acceso, enlaces,
    invitaciones, cupos); los segmentos se van con la sesión; las versiones se
    van con el hilo, y el hilo con la paciente. Todo lo demás queda con el
    comportamiento por defecto (la base impide borrar un padre con hijos).
    El "borrado por paciente" es de otra área y decidirá el resto.
20. **`hablanteTerapeuta`.** El 06 lo dejó como "cierto parcial" a confirmar
    por el área 2; el 02 lo confirma: es una constante del worker (`S0`), no
    una columna. Afuera.

---

## 3. Qué pidieron los diseños y NO incluí, con el motivo

Regla aplicada: si nadie lo lee hoy, no va. Cada uno se puede agregar el día
que aparezca el lector, con una migración aditiva.

| Pedido | Diseño | Por qué no está |
|---|---|---|
| `User.passwordCambiadaEn` | 03 ("informativo") | Ninguna pantalla ni regla la lee. El evento de auditoría del cambio de contraseña ya deja la fecha. |
| `Invitacion.usadaPor` | 03 | Sin lector. El evento `cuenta.invitacion_usada` registra quién la usó. |
| `EnvioSms.plantillaVersion` | 05 ("para saber qué versión de plantilla se usó") | Sin lector. La plantilla vigente está en `configuraciones`. |
| `HiloVersion.trabajoId` | 04 (trazabilidad) | Sin lector; el consumo del trabajo queda en `trabajos.uso` y la sesión origen ya está en la versión. |
| Tabla `Latido` y ruta `POST /api/latido` | 05 | Resuelto por el dueño a favor de `worker_estado` (04). |
| `AudioGrabacion`, `AudioParte`, manifiesto y hash, `consentimientoId` en el audio, `verificadoWorkerEn`, `revision`, `cierreId` | 01 | El dueño descartó el formato propio y el manifiesto. El consentimiento vigente se exige al iniciar y se audita; no se guarda como referencia en la sesión. |
| `SesionClinica.ticketTipo`, `ticketVenceEn` | 03 | Un solo mecanismo (§2, punto 4). |
| `SerieTurno.duracion`, `modalidad`, `generadaHasta`, `activa`, extensión con aviso, tope de 30 por lote | 06 | Modelo mínimo por decisión del dueño (§2, punto 15). El tope por lote es una constante del código, no del esquema. |
| `notaBorradorEncrypted` | 02 (§7, "si alguien diseña guardado durante revisión") | Nadie lo diseñó. |
| `PacienteContextoClinico` con seis columnas cifradas | 03 | El 04 lo reemplaza por versiones con un solo blob; el dueño lo resolvió así. |
| Tabla de claves de cifrado, historial de generaciones de nota, `rollback.sql` | consigna | Sobreingeniería descartada explícitamente. Las claves van en `CLAVES_CIFRADO`; la nota IA vigente más `generacion` alcanza. |
| Índice por `creado_en` en `intentos_acceso` para la purga | 03 (cron) | La tabla queda chica (30 días) y la purga es diaria: un recorrido completo es más barato que mantener el índice en cada escritura. |
| Estados de captura del cliente (`PREPARADA`, `CAPTURANDO`, `PAUSADA`, `INTERRUMPIDA`, `CERRADA`) | 01 | Son del teléfono (IndexedDB), no de la base. La base solo conoce `grabando` y `subiendo`. |

---

## 4. Preguntas al dueño

Ninguna bloquea el esquema; lo escribí completo con las decisiones que siguen.
Las dejo por si alguna está mal:

1. **`hora_ancla` de la serie como instante del primer turno** (fecha y hora)
   en vez de un texto "HH:mm". Si preferís que la serie guarde solo la hora,
   es un cambio de una columna.
2. **`bajas_sms` sin organización.** La baja es del teléfono: si el mismo
   número fuera paciente de dos consultorios, la baja vale para los dos. Me
   parece lo correcto legalmente; confirmalo.

---

## 5. Desacuerdos

Revisados por el dueño el 11-09-2026: el 1 se aceptó y se aplicó; el 2, el 3
y el 4 se aceptaron sin cambios. Las dos preguntas de §4 quedan como están.

1. **Un solo IV para un audio en segmentos** (aceptado por el dueño el
   11-09-2026 y ya aplicado). La resolución original ponía "la clave y el IV
   del audio" en la sesión, sin IV en los segmentos. Con AES-GCM, dos
   segmentos distintos cifrados con la misma clave y el mismo IV es la falla
   más grave que tiene el algoritmo: se recupera texto claro. Evitarlo con un
   solo IV obligaba a derivar el nonce de cada segmento del IV base más su
   índice y a que un mismo índice nunca se recifrara con contenido distinto,
   una regla que el área 1 tenía que cumplir a mano y contra la que el diseño
   01 ya había advertido. Lo que quedó: `audio_segmentos.iv`, 12 bytes
   aleatorios por segmento, obligatorio y en claro (no es secreto); la sesión
   guarda solo la clave (`audio_clave_encrypted`). Cuesta doce bytes por
   minuto de audio y no depende de ninguna regla.
2. **Nombre, apellido y teléfono en claro.** Es la decisión del 03 y la
   respeto porque la búsqueda y la agenda los necesitan en SQL. Dejo constancia
   de que es la única información que identifica a una persona y que queda sin
   cifrar en la base: Neon cifra el disco y la conexión, pero un volcado de la
   tabla los muestra. Si algún día hay más de un consultorio, el camino es un
   índice ciego (hash de los trigramas normalizados) y cifrar las columnas.
3. **`motivo_no_envio` como texto para la pantalla.** La consigna lista
   `sid`, `codigoProveedor`, `segmentos` y "sin texto". Interpreté "sin texto"
   como el cuerpo del SMS, y conservé este campo porque hay fallos sin código
   de Twilio (teléfono vacío, ventana útil agotada, paciente dada de baja) que
   la pantalla tiene que poder explicar. Si lo preferís como un código cerrado
   (enum) en vez de texto, es un cambio chico.
4. **Sobre `speech_analytics` en claro.** Son proporciones y silencios, no
   palabras; lo dejé sin cifrar como pide el 04 porque el worker lo necesita
   junto a la transcripción en el reclamo. Es un dato derivado de una sesión
   clínica: si querés que vaya cifrado, es una columna `Bytes` más y un campo
   lógico en la extensión.

---

## Anexo: contrato para los seis agentes

- **Campos lógicos que la extensión de cifrado tiene que exponer** (columna →
  campo): `pacientes.notas_encrypted` → `notas`; `turnos.notas_encrypted` →
  `notas`; `consentimientos_grabacion.texto_completo_encrypted` →
  `textoCompleto`, `firma_digital_encrypted` → `firmaDigital`;
  `hot_words.termino_encrypted` → `termino`; `sesiones_clinicas`:
  `audio_clave_encrypted` → `audioClave`,
  `transcripcion_encrypted` → `transcripcion`, `nota_ia_encrypted` → `notaIa`,
  `datos_encrypted` → `datos`, `feedback_encrypted` → `feedback`,
  `nota_final_encrypted` → `notaFinal`, `notas_edicion_encrypted` →
  `notasEdicion`; `hilo_versiones.contenido_encrypted` → `contenido`. AAD de
  cada blob: `<tabla>:<columna>:<id de la fila>` (para `audio_segmentos` no hay
  columnas cifradas; para `hilos` tampoco).
- **Key de cada segmento en R2:** `<organization_id>/<sesion_id>/<indice>`. El
  payload de `borrar_audio_r2` lleva `{ prefijo, indices }` calculado al
  crear el trabajo, porque los segmentos se borran de la base en la misma
  transacción que la sesión.
- **Escrituras del worker:** siempre `WHERE id = ? AND organization_id = ? AND
  estado = 'procesando' AND intento = ?`, y el ticket cuyo hash está en la fila.
- **Índices parciales y CHECK** están al final de `0_init/migration.sql` en un
  bloque marcado "A MANO". Si alguien regenera el archivo con `prisma migrate
  diff`, tiene que volver a pegar ese bloque. `prisma migrate diff` contra la
  base aplicada no los ve, así que el control de drift del área 5 pasa.
