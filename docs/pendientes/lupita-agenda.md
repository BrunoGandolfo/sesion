# Lupita: consulta mínima de agenda

Base: `origin/main` en `ffd31cf`. Rama: `lupita-agenda`.

## Qué cambia

- La ruta existente `POST /api/ayuda` ofrece una consulta de agenda. No hay rutas nuevas.
- La IA puede pedir `consultar_agenda({ periodo })`, con `hoy`, `manana` o
  `esta_semana`. El servidor valida el argumento y fija el consultorio desde la
  sesión autenticada. No acepta columnas, SQL, IDs de pacientes ni organizaciones.
- Devuelve nombre de pila, día, hora, duración y modalidad. No lee el apellido:
  se eligió el mínimo del alcance autorizado. El listado incluye los turnos sin
  cancelar del período, también los ya realizados, como la agenda de la app.
- Todo se calcula en Montevideo, con intervalos que incluyen el principio y
  excluyen el final. La semana va de lunes a domingo.
- El servidor muestra el listado completo, sin pedir a la IA que vuelva a
  escribir las horas. Una lectura fallida produce error; nunca agenda vacía.
- La otra herramienta, `fuera_de_alcance`, devuelve un límite explícito. Una
  herramienta desconocida, argumentos extra, llamadas múltiples o truncadas
  también se rechazan antes de consultar. No existe herramienta de escritura.
- La ayuda normal conserva su respuesta incremental. Se hace una sola llamada
  al proveedor por pregunta. Las listas no se recortan por el límite de tokens;
  el historial que se reenvía respeta el máximo de 4000 caracteres por mensaje.

## Permisos y privacidad

`ayuda/agenda.ts` tiene su propio `select`; no reutiliza `listarTurnos`, que
carga teléfono, tarifas y otros datos. La consulta filtra la organización tanto
del turno como de la paciente, incluso ante una relación inconsistente.

El resultado tiene exactamente cinco campos. No hay acceso a teléfonos,
tarifas, deudas, cobros, notas, transcripciones, Recorrido, consentimientos ni
fichas. Los límites de lectura los impone código del servidor; la decisión de
si una pregunta pide agenda o ayuda la toma el modelo mediante herramientas.

El modelo no recibe la respuesta de la consulta para redactarla. **Si sigue la
conversación, puede recibir los nombres y horarios en el historial del chat.**
También recibe lo que la profesional escriba: por eso los textos piden evitar
pegar información clínica o personal. La app no puede impedir que alguien
escriba voluntariamente esa información.

No hay escrituras sobre agenda, pacientes ni datos clínicos. Se conservan las
escrituras de control existentes: reserva/devolución del cupo diario y auditoría
de metadatos, sin preguntas, respuestas ni nombres. El cupo sigue siendo 40 por
usuaria y día de Montevideo, reservado antes del proveedor. “No escribe nada en
la base” no puede ser literal y mantener a la vez ese cupo; se interpreta como
no modificar los datos del consultorio.

## Textos integrados en esta rama

Por pedido explícito del dueño, se actualizan juntos glosario, presentación del
panel, portada, prompt, README y ayuda. Los textos definitivos están en
`AYUDA_BIENVENIDA`, `AYUDA_PRIVACIDAD`, `AYUDA_FUERA_DE_ALCANCE` y `PORTADA_LUPITA`.

El consentimiento pasa de **2.4 a 2.5** y exige **refirma de las versiones
anteriores, incluida 2.4**. Los hechos viven en `consentimiento-hechos.ts`.
Se agrega una sección sobre Lupita: los cinco datos de agenda, ausencia de
escrituras y posible envío en el historial a Anthropic. La enumeración de
registros clínicos de “¿Qué queda guardado?” no cambia: Lupita no los consulta.
La API sigue sugiriendo refirma por versión; no se modifica la regla de vigencia.

## Verificación

- PostgreSQL 17 propio en Docker: hoy, mañana, semana, bordes de Montevideo,
  cambio de año, cancelados, dos consultorios y enlace inconsistente.
- Lectura real bajo `SET TRANSACTION READ ONLY`, sin cambios de filas. Datos
  prohibidos sembrados, incluidos campos cifrados deliberadamente inválidos:
  leerlos/descifrarlos haría fallar la prueba.
- Intentos de ampliar campos, elegir otro consultorio, pedir ficha, notas,
  Recorrido, SQL y operaciones de escritura: rechazados sin lectura.
- Ruta autenticada: el consultorio del cuerpo no se usa; 401 sin sesión;
  cupo antes de la lectura/proveedor y 429 antes de ambos.
- SDK real con transporte SSE simulado: selección de herramienta, listado,
  métricas, cancelación y ayuda incremental. No se llama a Anthropic real en
  estas pruebas; no se afirma que un modelo acierte cualquier formulación.
- Panel: presentación precisa y lista larga completa sin romper el siguiente
  pedido. Consentimiento, ayuda y portada verificados por sus pruebas.
- En el recorrido del navegador se agrega una espera de navegación al pasar
  de entrada a recuperación: ambos formularios tienen Email y el test podía
  seleccionar el de entrada justo antes de que desapareciera.

Resultados locales: tipos, lint, build y suite completa en verde (1963 pruebas
aprobadas, una omitida que ya existía). La revisión final de
`codex review --uncommitted` no encontró regresiones. El recorrido completo pasó
en 59,43 segundos, con datos ficticios y el proveedor simulado en localhost.
Además se verificaron hoy, mañana, semana y tres intentos de ampliar permisos
por HTTP real, atravesando autenticación, SDK, consulta de Postgres y cupo.
El panel se comprobó a 390 y 1440 px en Chromium y WebKit; el campo de pregunta
queda visible y no hay desborde horizontal. No hubo prueba con Anthropic real:
el entorno local no dispone de su clave.

## Fuera de alcance

No se construyen filtros por paciente, fechas arbitrarias, búsquedas clínicas,
un motor de agentes, índices nuevos ni almacenamiento de conversaciones. Tampoco
se cambian esquema, migraciones, worker, políticas de retención ni publicación.
