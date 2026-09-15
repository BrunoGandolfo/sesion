# Reconstrucción del Recorrido

## Alcance y decisiones

Rama `recorrido`, desde `origin/main` (`13b26f5`). Sin cambios de esquema.
El contenido clínico vive exclusivamente en `hilo_versiones.contenido_encrypted`,
cifrado con `cifrarHiloVersion`. Cada edición inserta una fila. Las resoluciones
solo actualizan estado, autora de resolución y fecha; el contenido anterior no
se vuelve a escribir. El puntero vigente y la numeración se actualizan bajo el
bloqueo de la fila del paciente en `hilos`.

La aprobación de una sesión ya creaba `integrar_contexto` en su transacción:
se conservó ese contrato y se completaron `ADJUNTOS` y `APLICADORES`. El claim
fija `basadaEnVersion` en el payload existente, sin texto clínico ni nueva
columna. El adjunto lee esa versión inmutable y la nota aprobada. Resolver el
trabajo y guardar la propuesta son una única transacción: una forma inválida
revierte ambas escrituras y repetir un resultado resuelto devuelve 409.

La propuesta no cambia lo vigente. Si la base cambió mientras la IA trabajaba,
queda desactualizada. Si la profesional edita mientras existe una propuesta,
la desactualiza en la misma transacción. Aceptar con ediciones crea una versión
profesional con `propuestaOrigenId`. Rechazar termina el asunto sin regeneración
automática. Regenerar y reintentar son pedidos explícitos.
Una sesión ya incorporada mediante una propuesta aceptada no vuelve a
integrarse desde una propuesta vieja rechazada; se corrige mediante edición.

Las intervenciones referencian sesiones por UUID en `sesiones`, no por números
calculados al contar aprobaciones. Así aprobar una nota vieja después de otra
nueva no cambia ni duplica referencias. La pantalla permite elegir las notas
por fecha y abrirlas desde el Recorrido. Toda referencia debe pertenecer a una
nota aprobada de esa paciente. Esto cambia la forma del JSON cifrado, sin
columnas nuevas ni migraciones; no existía un escritor vivo del Recorrido en la
base de esta rama.

Los claims del mismo paciente se serializan con el mismo lock, desempatan por
fecha e identificador, y esperan una propuesta anterior sin revisar. La cola
se pagina para que pacientes bloqueadas no oculten trabajos de otras pacientes.
El orden de locks es siempre hilo y luego trabajo.

## Contratos HTTP

Todas las respuestas humanas usan `{ data }`, errores `{ error }`. Las lecturas
del Recorrido llevan `Cache-Control: no-store`. Las escrituras exigen sesión y
origen propio dentro de la ruta: `/hilo` ya estaba excluida del proxy para el
worker, por lo que esa protección no puede depender del proxy.

| Ruta | Contrato |
|---|---|
| `GET /api/pacientes/:id/hilo` | Vigente, propuesta, desactualizadas, historial paginado, cantidad de aprobadas y trabajos pendientes/fallidos |
| `GET .../hilo/versiones?antes=N` | Hasta 30 metadatos de versiones y `hayMas` |
| `GET .../hilo/versiones/:version` | Contenido y metadatos de una versión |
| `POST .../hilo/versiones` | `{ basadaEnVersion, contenido }`, inserta una versión profesional |
| `POST .../hilo/propuestas/:id/aceptar` | `{ basadaEnVersion, contenido? }`; con contenido inserta edición propia |
| `POST .../hilo/propuestas/:id/rechazar` | `{ basadaEnVersion }` |
| `POST .../hilo/regenerar` | `{ basadaEnVersion, propuestaId }` o `{ basadaEnVersion, trabajoId }` para un fallo; devuelve `trabajoId` |
| `GET /api/pacientes/:id/brief` | Última nota aprobada, solo hilo vigente, próximo turno y avisos de nota/propuesta pendientes |

La versión esperada es **la de la vigente**, no el contador que también incluye
propuestas. Una pantalla que guardó sobre otra versión obtiene 409. Conserva
su borrador y exige leer la nueva vigente antes de continuar.

La lectura de máquina es `GET .../hilo?format=llm&sesionId=...`, autenticada
con el ticket de esa sesión en procesamiento. Solo permite la paciente y la
organización de esa sesión. Responde JSON:

```json
{"data":{"tipo":"hilo_vigente","pacienteId":"...","version":0,"contenido":null}}
```

`version: 0, contenido: null` es la única representación del hilo vacío.
Con versión positiva el contenido debe validar completo. El cliente no sigue
redirecciones, exige HTTP 200 y `application/json`, valida identidad, envoltura,
campos, tipos anidados, enums, fechas civiles y límites. HTML, 404, JSON inválido
o una estructura distinta son errores: no se llama al modelo sin historia por
haber fallado la lectura. Los fallos de red se reintentan por la política de la
sesión y su checkpoint, sin volver a transcribir.

El worker ahora ejecuta `integrar_contexto`: valida el adjunto, usa
`update_context_v2.1.md` y devuelve `{ ok, propuesta, promptVersion, modeloLlm }`.
El servidor vuelve a validar. La fecha viene ya como día de Montevideo desde
`fechas-montevideo.ts`; Python solo comprueba su formato, no decide el día.

## Pantalla y textos pendientes de incorporar al glosario

- Vigente: «El Recorrido», «Revisado por vos el …» o «Propuesta aceptada el …».
- Vacío: «Todavía no hay un Recorrido revisado». Permite comenzar una edición.
- Propuesta: «Hay una propuesta nueva», cambios resumidos, nota de origen,
  comparación de las seis secciones y «Aceptar», «Editar y aceptar»,
  «Descartar propuesta».
- Conflicto: «El Recorrido cambió en otra pantalla. Tu borrador se conserva
  abajo. Revisá la versión vigente antes de continuar».
- Vieja: «Hay una propuesta vieja: el Recorrido cambió después», lectura,
  descarte o «Volver a generar sobre el Recorrido actual».
- Fallo: «No se pudo preparar una propuesta» y «Volver a intentar».
- Historial: lectura completa; «Usar como borrador de una versión nueva»
  restaura mediante una nueva inserción, nunca sobrescribiendo.
- Edición: hipótesis, resumen, objetivos y fechas, intervenciones y sesiones,
  temas y cantidades, corrección o retiro de señales existentes. Las señales
  conservan el identificador de su sesión de origen.
- Nota: «Frases para revisar» y «Estas menciones de la transcripción necesitan
  tu lectura. Por sí solas no constituyen una evaluación de riesgo».
  Se reutiliza el texto existente «Leí las menciones», ligado a la generación
  de nota. La aprobación envía `confirmoMenciones` cuando el servidor lo exige.
- Brief: «Hay una propuesta del Recorrido sin revisar. Este resumen usa la
  versión vigente» y aviso separado por notas pendientes de aprobación.

No se modificaron `glosario.ts` ni `docs/ayuda`. El worker produce las menciones
con la lista literal versionada de `processor/riesgo_lexico.py`, incluyendo cita
y timestamp. No interpreta negaciones ni cubre todas las expresiones posibles:
tener cero coincidencias no constituye una evaluación. Permanecen dentro de la
nota y se excluyen del adjunto longitudinal; no alimentan riesgos históricos
ni etiquetas del sistema.

## Lupita

`cupos_ayuda` ya existía. Una única sentencia `INSERT ... ON CONFLICT ... WHERE
usadas < 40 RETURNING` reserva antes de llamar al proveedor. El día es texto de
Montevideo. Un fallo anterior al primer fragmento devuelve la reserva. Recibir
texto o cancelar conserva el consumo. La auditoría conserva métricas sin texto
clínico y ya no funciona como contador del cupo.

## Eliminado y conservado

Se retiraron `ContextoGoldenThreadView`, `contexto_worker.py`, el prompt 2.0
que escribía el contexto directamente, `CALLBACK_URL`, `APROBADAS_URL` y el
conteo no atómico de Lupita sobre auditoría. No quedan llamadas ejecutables a
`contexto-clinico`. El acceso de progreso pasó a un caso de uso y se retiró solo
su excepción del guardián de rutas.

No se agregaron barridos de sesiones, fechas de corte, contenedores nuevos,
migraciones, dependencias o mecanismos paralelos de jobs. El registro de
auditoría vincula trabajo y versión; no hizo falta `hilo_versiones.trabajoId`.
No se tocaron grabación, unión de audio, consentimiento, release ni publicación.

## Verificación y límites

- Integración real contra Postgres 17 propio en Docker: aprobación y job,
  aplicación y rollback, cifrado, resoluciones, obsolescencia, simultaneidad,
  encadenado, aislamiento entre organizaciones, cola detrás de pacientes
  bloqueadas y regeneración explícita.
- 60 reservas de Lupita simultáneas: exactamente 40 aceptadas y 20 respuestas
  429; borde de medianoche de Montevideo y devolución de una reserva.
- Pantalla en DOM: aceptación, edición, descarte, conservación ante 409,
  restauración como versión nueva y aprobación con menciones.
- Worker: redirects, login con 200, content type, JSON roto, identidad, tipos
  anidados y error antes de llamar al proveedor; ejecución del trabajo nuevo
  y menciones léxicas independientes de la respuesta del modelo.
- No se llamó a Anthropic con una paciente real. Las pruebas del proveedor
  usan respuestas controladas; no equivalen a una validación clínica de las
  propuestas. La calidad clínica necesita la revisión de la profesional.

Diferencia deliberada respecto del diseño: `format=llm` devuelve JSON validado
en lugar de Markdown. El worker lo serializa después de validarlo para el
prompt. Esto permite distinguir inequívocamente el contexto de una página de
login o de cualquier otro contenido exitoso. No se cambió el principio de que
solo se lee la versión aceptada.
También se reemplazó el número de sesión derivado por el identificador estable
ya existente: el número variaba al aprobar fuera de orden y podía atribuir dos
encuentros a la misma referencia. No se agregó un contador paralelo.

No hicieron falta columnas ni decisiones adicionales de otras áreas. El
resultado de CI y el SHA se reportan al entregar la rama; esta tarea no incluye
fusión ni publicación.
