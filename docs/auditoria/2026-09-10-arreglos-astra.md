# Arreglos de la auditoría — 10 de septiembre de 2026

Repositorio: `BrunoGandolfo/sesion`. Rama local: `arreglos-auditoria`. Base: `204290ddae2f8871f306310da2ee6b29a183be49`, `main` al iniciar esta ejecución. La fecha del título y del archivo es la solicitada; la ejecución comenzó el 9 de septiembre.

`5c6577a` ya incorpora limpieza de Markdown por fragmento, `no-transform`, Sonnet 5 y la regla final de voz. `204290d` ya incorpora Lupita a 72 px y su ciclo. Se conservan: B.1/B.2/B.3 y F.1/F.2/F.4 siguen parcialmente abiertos hasta comprobar respuestas reales, transporte y percepción en teléfono. La corrección de un ejemplo factual del prompt no rehace esos cambios.

## Clasificación completa

Los rótulos B, C.2, E y F remiten al informe del 9 de septiembre. Algunos mezclaban varios problemas y F repetía propuestas para resolverlos: se separan abajo por cambio concreto, con una sola categoría por pieza. Corregir una frase sobre cifrado pertenece a A; cambiar el cifrado pertenece a C. Las referencias compartidas no significan que se haya cerrado el hallazgo completo. En C.2 se numeran sus ocho filas de arriba abajo.

### A) Se puede arreglar ahora dentro del alcance autorizado

- **A01 — B.4 / F.1, canal del recordatorio de cobro:** enseñar SMS y su confirmación corrige la ayuda sin modificar envíos; prueba sobre el corpus que lee Lupita.
- **A02 — B.4 / F.1, deshacer cobros:** documentar la acción existente y que no reabre el turno corrige una instrucción falsa; prueba de ambas entradas de ayuda.
- **A03 — B.4 / F.1, superposición de turnos:** documentar el rechazo ya existente y los turnos consecutivos no cambia la agenda; prueba del texto publicado.
- **A04 — B.4 / F.1, bloqueo y garantías de recuperación:** retirar el consejo de bloquear y la promesa del ejemplo de Lupita evita una indicación riesgosa sin tocar captura; prueba del corpus y del prompt efectivo.
- **A05 — B.4 / F.1, duración máxima:** informar 150 minutos y aviso a los 135 refleja constantes existentes; prueba que compara el documento con esas constantes.
- **A06 — C.2 fila 3 / F.1, ubicación de Grabar:** enseñar la cabecera evita buscar un flotante inexistente; prueba en los dos documentos que lo ubicaban mal.
- **A07 — B.4 / C.2 fila 2 / F.1, navegación de Para vos y aprobación:** explicar la vista separada, disponibilidad condicionada y permanencia en la nota actualiza la ayuda; prueba de esos recorridos documentados.
- **A08 — B.4 / E.5, documentación de configuración / F.1:** explicar que un campo inválido frena todo el lote corrige la contradicción sin cambiar el guardado; prueba del documento y de la espera de confirmación.
- **A09 — B.4 / E.3 / E.9–E.12 / E.14 / F.1 / F.10, promesas de privacidad y conservación:** aclarar copia local sin cifrar, cifrado parcial, borrado intentado y límites de nota, hilo y brief solo cambia textos; pruebas de entrada y corpus, sin intervenir los mecanismos.
- **A10 — F.1, desvío adicional en Cobros:** describir dos importes con cantidades debajo coincide con la pantalla vigente; prueba que impide volver a los cuatro indicadores antiguos.
- **A11 — C.2 fila 8 / E.17 / F.3, errores con tilde de éxito:** indicar la variante visual en los consumidores afectados conserva sus operaciones; pruebas de rechazo y confirmación en las pantallas.
- **A12 — F.3, conflicto de horario genérico en Hoy:** mostrar el mensaje del conflicto 409 ya recibido conserva contrato y formulario; pruebas de conflicto, reintento aceptado y errores generales.

Los ocho errores factuales del corpus se cubren con A01/A02/A03/A04/A05/A07/A08 y la copia local de A09. La fila que mezclaba bloqueo y cifrado local se divide en esas dos correcciones. A06 viene además de C.2; A10 apareció al cotejar el corpus completo. Las garantías absolutas adicionales se reúnen en A09.

### B) Requiere un diseño previo aprobado

- **B01 — E.1 / F.7, recuperar sin identificador de sesión:** hay que resolver la identidad y los estados existentes antes de subir; no corresponde iniciar otra grabación para repararlo.
- **B02 — E.2 / F.7, pisar el pendiente y esconder otro turno pendiente:** bloquear el reemplazo y buscar por turno cambia las decisiones de recuperación; necesita aprobar descarte y convivencia de pendientes.
- **B03 — E.6 / F.9, borrar antes de consolidar:** hay que aprobar el orden entre nota consolidada y limpieza posterior para que una caída no vuelva irrecuperable el audio.
- **B04 — E.12 / F.10, sesiones tras cambiar contraseña:** revocar afecta accesos vigentes y puede interrumpir trabajo; requiere acordar transición de tokens y qué sucede con el equipo actual.
- **B05 — F.5 / E.11, Para vos ausente, incompleto o fallido:** requiere definir estados visibles, evidencia y cuándo se ofrece reintento independiente sin reemplazar una nota aprobada.
- **B06 — E.5 / F.3 / F.8, salir con cambios y avisos que desaparecen:** confirmar salida y conservar un error pendiente cambia navegación y guardado; hace falta acordar qué salidas se bloquean y cómo seguir trabajando.
- **B07 — E.9 / F.9, selección de veinte candidatas y corte diario:** ampliar la búsqueda sin cambiar el DTO puede activar trabajo histórico y costos; hay que acordar el alcance temporal y el presupuesto por consulta.
- **B08 — E.11 / F.5 / F.9, riesgo desconocido y fuente del brief:** distinguir falta de evaluación y nota no aprobada afecta la lectura clínica y la aprobación; requiere decisión de producto validada por la profesional.
- **B09 — B.5 / C.2 fila 6 / E.17 / F.6, jornada, frescura, navegación y listas:** priorizar Ahora/Pendientes, revalidar y conservar posición debe responder a un recorrido acordado, con límites para no agregar esperas o quitar información.
- **B10 — B.4 / F.1, contexto mínimo de ayuda:** adjuntar la tarea o ruta modifica lo que recibe la ayuda y necesita definir campos permitidos y exclusión de datos clínicos.
- **B11 — E.17 / F.1, cuota de Lupita sin reserva atómica:** reservar antes de llamar al modelo cambia cuándo se consume cupo y cómo se tratan fallas; necesita aprobar esa política y probar concurrencia real.

### C) No tocar todavía

- **C01 — B.1 / B.4 / F.1, salida real y tono del modelo después de `5c6577a`:** falta evaluar respuestas y fragmentos reales; las cadenas de un prompt y las pruebas del corpus no prueban utilidad ni cumplimiento del modelo.
- **C02 — B.2 / F.4, crecimiento visible del texto:** `no-transform` ya está; falta medir cada tramo y verlo en el teléfono y despliegue servido antes de cambiar transporte, cancelación o tratamiento del final truncado.
- **C03 — B.3 / C.2 fila 1 / F.2, percepción del ciclo de Lupita:** `204290d` ya cambió tamaño y estados; faltan pruebas a tamaño real, movimiento reducido y superficies clínicas antes de otra intervención.
- **C04 — C.2 fila 4, marca elegida A frente a recomendación B:** hay una elección explícita de producto; no es un defecto que autorice sustituirla.
- **C05 — C.2 filas 5 y 7 / B.5 / F.6, transiciones, esqueletos y doble espera:** faltan mediciones de tarea y dispositivo; cambiar duraciones o carga por intuición no acredita rapidez.
- **C06 — E.2 / F.7 / F.10, partición de respaldos por cuenta:** requiere diseño de almacenamiento local y compatibilidad con pendientes anteriores, más pruebas de cambio de cuenta en dispositivo.
- **C07 — E.3 / F.7 / F.10, cifrado local, almacenamiento degradado y memoria:** exige tocar grabador/cifrado y probar cuota denegada, fallo de cifrado y sesiones largas en teléfonos reales.
- **C08 — E.4 / F.7, segmentos, formato MIME y duración recuperada:** afecta captura y reconstrucción de audio; faltan pruebas audibles de codecs e interrupciones en iPhone y Android.
- **C09 — E.7 / F.3 / F.7, subida incierta, espera ilimitada e integridad:** exige intervenir el hook de subida y reconciliar estados con pruebas de pérdida de respuesta y red en dispositivo.
- **C10 — E.8 / F.9, resultados viejos, reserva de lote e intentos:** requiere identidad de intento compartida con el worker y pruebas de ejecución concurrente; no alcanza con rechazar por estado general.
- **C11 — E.9 / F.9, reintentos de contexto en memoria y cola durable:** persistencia, reinicio y coordinación entre workers requieren otro diseño de contrato y, según la solución, migración.
- **C12 — E.10 / F.8 / F.9, sobrescritura humana y pérdida de arrays históricos:** exige versión esperada en navegador/API/worker y conservación de versiones; no se resuelve cambiando el prompt.
- **C13 — E.11 / F.5, validez clínica de hablantes, citas e instrumentos:** faltan evaluación profesional y casos de referencia; validar JSON o agregar un aviso no acredita la exactitud del análisis.
- **C14 — E.12 / F.10, cifrado de campos y custodia/rotación de claves:** exige inventario, migración de datos protegidos y restauración con claves; queda fuera del alcance de A.
- **C15 — E.12 / F.10, claves de máquina y endurecimiento de CSP:** necesita evidencia operativa y manejo autorizado de credenciales; CSP requiere las condiciones de uso y reportes de `AGENTS.md`, que no están acreditadas.
- **C16 — E.13 / F.7 / F.10, autorización revocada y sesión reutilizada:** requiere separar nueva captura de conservación de audio previamente autorizado y probar revocación/reanudación en dispositivo.
- **C17 — E.14 / F.10, borrados en proveedores y capturas públicas:** faltan evidencias de retención, limpieza y origen sintético; no corresponde afirmar eliminación ni borrar historial público sin resolver esa incertidumbre.
- **C18 — E.15 / F.9 / F.10, SMS ambiguo o duplicado:** necesita identidad persistente de envío, conciliación con proveedor y pruebas de entrega; cambia el contrato operativo y puede requerir migración.
- **C19 — E.16 / F.10, auditoría durable, alertas, costos y restauración:** depende de persistencia y comprobaciones con canales y respaldos reales; un unitario no certifica operación ni recuperación.
- **C20 — B.5 / F.6, concisión de la nota y prueba completa de primer uso:** cambiar generación afecta contenido clínico del worker y la prueba micrófono → nota → aprobación todavía requiere dispositivo y validación profesional.
- **C21 — E.5 / F.8, borradores recuperables tras recarga y conflictos:** requiere decidir almacenamiento cifrado, versiones y persistencia; el aviso previo de B06 no garantiza conservar texto ante cierre forzado.
- **C22 — F.7, protección de navegación durante captura y subida:** requiere intervenir el ciclo de vida del grabador y probar Atrás, cambio de app y cierre; no se mezcla con las guardias de edición de B06.

## Propuestas de B — cinco líneas por cambio

### B01 — Recuperar con identidad de sesión (E.1)

1. Al tocar «Guardarla ahora», buscar la sesión del turno y obtener su id antes de enviar el mismo pendiente; no iniciar ni descartar audio para conseguirlo.
2. Si el servidor ya está procesando, en revisión o aprobado, conciliar y mostrar ese estado sin reiniciarlo ni volver a subir; aprobar qué hacer si no existe sesión.
3. Archivos: `src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx`, su `page.tsx` y pruebas de recuperación; cualquier necesidad de cambiar el grabador se revisa dentro de este diseño.
4. Test: recarga con pendiente e id local ausente, sesión existente o ausente, error de lectura y confirmación perdida; asegurar mismo turno/audio y una sola subida aceptada.
5. Si sale mal: puede asociar audio al turno equivocado, duplicar procesamiento o impedir guardar; probar con audio sintético y conservar el pendiente ante cualquier duda.

### B02 — No reemplazar el pendiente (E.2)

1. Con audio pendiente del mismo turno, ofrecer recuperar o descartar explícitamente y deshabilitar el inicio de otra captura hasta resolverlo.
2. Buscar pendientes por turno antes de elegir el más reciente; conservar los de otros turnos y no convertir un cambio de pantalla en descarte.
3. Archivos: `grabar-view.tsx`, `src/components/grabacion/GrabadorSesion.tsx`, `src/lib/grabacion-storage.ts` y sus pruebas; la partición por cuenta es C06.
4. Test: dos turnos con dos pendientes, doble toque en Grabar, recuperación fallida, cancelar descarte y descarte confirmado solo del turno elegido; después, prueba en teléfono.
5. Si sale mal: puede ocultar un pendiente válido o bloquear una nueva sesión; la guardia no debe eliminar datos y su salida debe estar visible.

### B03 — Aprobar antes de borrar (E.6)

1. Consolidar estado, correcciones y tratamiento actual de la clave en la escritura condicionada de aprobación; borrar R2 solamente si esa escritura ganó.
2. Mantener `audioR2Key` hasta confirmar el borrado y usar aprobadas con clave remota pendiente como trabajo de limpieza reintentable; aprobar plazo y visibilidad de ese pendiente.
3. Archivos: `src/app/api/_lib/casos-uso/aprobar-sesion.ts`, nuevos `src/app/api/_lib/casos-uso/limpiar-audios-aprobados.ts` y `src/app/api/cron/limpiar-audios/route.ts`, `vercel.json` y pruebas; reutilizar los campos existentes.
4. Test: DB falla antes de aprobar, dos aprobaciones, descarte concurrente, R2 rechaza, reinicio y reintento de limpieza; nunca borrar cuando la aprobación no se consolidó.
5. Si sale mal: pueden quedar objetos remotos retenidos o marcarse un borrado que no ocurrió; conservar el puntero y comprobar estado antes de cada limpieza, sin alterar la nota aprobada.

### B04 — Revocar accesos al cambiar contraseña (E.12)

1. Asociar cada nuevo JWT a un marcador interno de la credencial vigente y comprobarlo al autorizar en servidor; cambiar contraseña invalida los marcadores anteriores.
2. Aprobar cierre de todos los accesos, incluido el actual, y una activación fuera de atención: los JWT antiguos sin marcador requieren ingreso otra vez; no usar un log de auditoría como fuente de verdad.
3. Archivos: `src/lib/auth.ts`, `src/app/api/_lib/auth.ts`, `src/app/api/cuenta/password/route.ts`, guardias de páginas y pantalla de contraseña; aislar comprobación de DB del bundle Edge.
4. Test: dos accesos, cambio aceptado/rechazado, token viejo sin marcador, ingreso nuevo, fallo de DB y todas las rutas protegidas; repetir el guardián de imports de middleware.
5. Si sale mal: puede dejarla sin acceso, revocar tarde o permitir una ruta sin chequeo; el diseño debe cerrar esas rutas y acordar el reingreso antes de activar nada.

### B05 — Para vos visible y recuperable (F.5)

1. Mantener el acceso y mostrar disponible, incompleto, pendiente, fallido o no disponible, sin deducir «pendiente» de un campo ausente ni ocultar la nota.
2. Ofrecer reintento solo del feedback si queda transcripción utilizable; aprobar estados y ciclo primero: la ejecución independiente que exija nuevo contrato con el worker permanece fuera de esta tanda.
3. Archivos: `sesion-detail-view.tsx`, `para-vos-view.tsx`, `src/components/grabacion/FeedbackTerapeutaView.tsx` y diseño de `reintentar-sesion.ts`/`processor/processor.py`; no reutilizar a ciegas «reprocesar sesión».
4. Test: completo, parcial, legado sin estado, fallido con/sin transcripción, doble reintento y nota aprobada; la nota y su aprobación deben quedar idénticas.
5. Si sale mal: puede prometer un análisis que nadie procesa, gastar dos veces o sobrescribir la nota; no habilitar un botón hasta contar con una operación exclusiva, verificable e idempotente.

### B06 — Proteger ediciones y mostrar qué falta guardar (E.5 / F.3)

1. Mostrar cambios pendientes y error persistente junto al campo, con guardar/reintentar y una confirmación antes de abandonar ediciones sin guardar.
2. Acordar menú, pestañas, enlaces y Atrás; esperar el guardado ya existente antes de continuar cuando sea posible, sin guardar ni aprobar contenido clínico implícitamente.
3. Archivos: `sesion-detail-view.tsx`, `ficha-tab.tsx`, `config-view.tsx`, `ContextoGoldenThreadView.tsx` y enlaces de navegación; sin intervenir el grabador.
4. Test: escribir y salir antes del debounce, red fallida, cancelar/aceptar salida, reintentar y guardar; el texto exacto permanece mientras la usuaria decide.
5. Si sale mal: puede atrapar la navegación o duplicar guardados; no garantiza recuperación ante cierre forzado, que exige la persistencia de C21.

### B07 — No esconder la candidata 21 (E.9)

1. Recorrer páginas de candidatas hasta reunir trabajo no integrado o alcanzar un presupuesto explícito; conservar una sesión por paciente y el DTO actual del worker.
2. Aprobar desde qué fecha buscar trabajo histórico y evitar que el corte diario descarte pendientes al cruzar medianoche; no ampliar silenciosamente a todo el historial.
3. Archivos: `src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts`, `src/app/api/sesion-clinica/aprobadas-sin-contexto/route.ts` y sus pruebas; la cola/reanudación del worker queda en C11.
4. Test: primeras veinte integradas y la 21 pendiente, varias páginas, fechas iguales, cambio de día, aislamiento de organización y límite de consultas.
5. Si sale mal: puede reprocesar historial, incrementar costos o exceder el tiempo de la función; conservar el filtro de integración y un límite acordado de trabajo.

### B08 — Explicitar riesgo desconocido y origen del resumen (E.11)

1. Mostrar «Sin evaluación disponible» cuando falte evidencia y etiquetar si el brief viene de una nota aprobada anterior o un borrador reciente.
2. Aprobar si exige confirmación adicional para aprobar una nota sin evaluación y qué fuente priorizar; mantener los controles actuales de riesgo moderado/alto.
3. Archivos: `src/lib/sesion-clinica/normalizar.ts`, lectores/DTO correspondientes, `aprobar-sesion.ts`, `pacientes/[id]/brief/route.ts`, `brief-corto.tsx` y `card-ahora.tsx`; cualquier nuevo contrato del worker vuelve a C.
4. Test: datos ausentes, inválidos y legados; aprobada antigua más revisión nueva; borrador único; riesgo alto/moderado y desconocido con la política aprobada.
5. Si sale mal: puede ocultar una señal, dar tranquilidad falsa o bloquear notas antiguas; validar las etiquetas y reglas con la profesional antes de activarlas.

### B09 — Continuidad del recorrido diario (B.5 / E.17 / F.6)

1. Acordar con una tarea entre pacientes si Ahora precede a Pendientes; mantener acceso claro a ambos y recordar pestaña/posición al volver.
2. Revalidar al recuperar foco y al cambiar el tramo del día sin tapar datos ya visibles; acordar paginación de listas y acceso al historial completo, sin modificar contenido clínico.
3. Archivos: `dashboard.tsx`, `src/hooks/useHoy.ts`, `agenda-view.tsx`, `paciente-detail-view.tsx`, listado/API de turnos del paciente y navegación de `nota-sesion-view.tsx`.
4. Test: reloj que cruza un turno, modificación desde otra pestaña, vuelta del fondo, red fallida, historial largo y regreso a la misma posición; comparar luego la tarea en teléfono.
5. Si sale mal: puede saltar la pantalla mientras trabaja, duplicar lecturas o esconder turnos; conservar datos visibles hasta validar la respuesta nueva y no reiniciar ediciones.

### B10 — Ayuda con contexto de tarea (B.4 / F.1)

1. Adjuntar solo un identificador de pantalla y acción de producto para que Lupita ubique el botón pertinente y responda con una acción breve.
2. Aprobar una lista cerrada de campos: sin nombres, notas, audio, ids clínicos ni URL completa; conservar las reglas de voz y limpieza ya incorporadas en main.
3. Archivos: `src/components/ayuda/panel-ayuda.tsx`, `src/app/api/ayuda/route.ts`, `src/app/api/_lib/casos-uso/responder-ayuda.ts` y `src/lib/ayuda-corpus.ts`.
4. Test: pantalla permitida/desconocida, rechazo de campos extra, compatibilidad sin contexto y preguntas sintéticas que requieren ubicaciones distintas; evaluar después respuestas reales.
5. Si sale mal: puede enviar contexto indebido o dar una instrucción de otra pantalla; validar la lista en servidor y degradar a ayuda general sin contexto.

### B11 — Reservar el cupo antes de consultar (E.17 / F.1)

1. Contar y reservar la consulta en una transacción serializada por organización antes de invocar al modelo; no depender del registro final de auditoría para consumir cupo.
2. Aprobar si una falla de proveedor devuelve cupo y qué hacer con reservas inciertas; usar eventos persistidos existentes solo si permiten distinguir reserva y resultado sin modificar el esquema.
3. Archivos: `src/app/api/_lib/casos-uso/responder-ayuda.ts`, `src/app/api/ayuda/route.ts` y nuevo caso de uso de reserva; no cambiar la auditoría clínica general ni las dependencias.
4. Test: más solicitudes concurrentes que el cupo, reserva fallida, modelo fallido, desconexión y reintento; integrar contra DB aislada para verificar que el límite no se excede.
5. Si sale mal: puede consumir cupo sin respuesta o rechazar ayuda disponible; limitar el cambio a Lupita y no iniciar la llamada externa cuando la reserva sea incierta.

## Commits de A y verificaciones

| Arreglo | Commit local | Qué cambia para ella | Test protector | Unitarios antes del commit |
|---|---|---|---|---:|
| A01 | `a34c5cf999d185a17fa6986f32dee9974d10018c` | Lupita explica que recordar un cobro manda un SMS cuando lo confirmás. | Corpus: SMS con confirmación; no WhatsApp ni envío al tocar sin confirmar. `src/lib/__tests__/ayuda-vigente.test.ts` | 1031 |
| A02 | `cd26e7e793f78f53530a5efef0e658edb98cfcd2` | La ayuda te muestra cómo deshacer un cobro sin reabrir el turno. | Corpus: acción Deshacer cobro, vuelta a deuda y permanencia del turno fuera de Agendado. `src/lib/__tests__/ayuda-vigente.test.ts` | 1033 |
| A03 | `b76ec034b8880679cc0ad26c0827bbff7817e7ef` | La ayuda avisa que los turnos no pueden pisarse. | Corpus: rechazo de solapamientos y posibilidad de turnos consecutivos. `src/lib/__tests__/ayuda-vigente.test.ts` | 1034 |
| A04 | `7b4dbfb3e81c15e17fcf18d9502e914895a00004` | Lupita pide mantener Sesión abierta y no promete recuperar cada corte. | Corpus y systemPromptAyuda: mantener pantalla abierta y ausencia de garantía total de recuperación. `src/lib/__tests__/ayuda-vigente.test.ts` | 1035 |
| A05 | `a4203ca7176e1173510b6e7c5f41b8ac7aa112f8` | La ayuda informa el límite de 150 minutos y el aviso a los 135. | Corpus contrastado con LIMITE_SEGUNDOS y AVISO_LIMITE_SEGUNDOS del código vigente. `src/lib/__tests__/ayuda-vigente.test.ts` | 1036 |
| A06 | `4048ee1e01e9afc2ec0bfb9723db3423ed5daade` | La ayuda ubica Grabar en la cabecera de la ficha. | Corpus en ficha y grabación: Grabar en cabecera; sin referencia al flotante. `src/lib/__tests__/ayuda-vigente.test.ts` | 1038 |
| A07 | `1f08c821754b04b4053ef586fad0634b7f6362e5` | La ayuda explica dónde leer Para vos y que aprobar mantiene la nota abierta. | Corpus: Para vos separado y condicionado a disponibilidad; aprobar mantiene la nota abierta. `src/lib/__tests__/ayuda-vigente.test.ts` | 1039 |
| A08 | `97c00b6de272615680421d483e9bcd8b4ae6c996` | La ayuda te pide corregir el campo inválido antes de guardar el lote. | Corpus: campo inválido frena el lote, Reintentar y esperar Guardado antes de salir. `src/lib/__tests__/ayuda-vigente.test.ts` | 1040 |
| A09 | `5362e0f35aca4fa4b4ce142c62905f6e834dbf08` | La entrada y la ayuda aclaran qué se cifra y qué puede fallar. | Entrada renderizada y corpus: copia local sin cifrar, borrado intentado, cifrado parcial, límites del modelo, hilo y brief. `src/app/(auth)/login/__tests__/login.test.tsx`, `src/lib/__tests__/ayuda-vigente.test.ts` | 1044 |
| A10 | `f4cbe4b3a42478421a57c20e9235ebe2a98bb298` | La ayuda describe los dos importes que ves en Cobros. | Corpus: dos importes de Cobros y cantidades debajo; no cuatro indicadores. `src/lib/__tests__/ayuda-vigente.test.ts` | 1045 |
| A11 | `d9dbbb524dd58c0ced73279d33e87f9ce82fca94` | Los errores se muestran como avisos y los éxitos conservan su tilde. | Componentes: rechazo y confirmación de SMS, reactivación en lista/ficha, cobro/deshacer, cobro desde Sesiones, eventos de Agenda e inicio/subida simulados de Grabar. `src/app/(dashboard)/__tests__/avisos-operaciones.test.tsx` | 1061 |
| A12 | `10c548fe59b805a881b3a2ec4426f2fcb328a311` | Hoy explica cuando un turno se superpone y te deja corregirlo. | Dashboard: conflicto 409 sin tilde, diálogo abierto, mismo pedido al reintentar, éxito posterior y fallback de red/500. `src/app/(dashboard)/_components/__tests__/hoy-solapamiento.test.tsx` | 1064 |


Antes de **cada uno de los 12 commits** pasaron `npx tsc --noEmit`, `npm run lint` y `npm run test:unit`. La última suite pasó **1064 pruebas**. Cada commit incorpora su prueba y contiene únicamente el arreglo indicado; `git diff --check` también pasó.

La verificación se ejecutó con Node 22.23.1/npm 10.9.8 en Ubuntu WSL, sobre una copia sincronizada del árbol de trabajo y con las versiones del lockfile instaladas mediante `npm ci`. La primera ejecución nativa en Windows había fallado en dos expectativas preexistentes de `middleware-edge.test.ts` por separadores de rutas; no se cambiaron ni se omitieron esas pruebas: pasan completas en Linux. Los registros de cada ejecución están en `work/checks/A01` a `work/checks/A12` del espacio de esta tarea.

No se cambiaron dependencias ni lockfile, esquema/migraciones, worker, cifrado, credenciales o archivos del grabador excluidos. En `grabar-view.tsx` A11 solo tipa y asigna la variante de sus avisos: las llamadas, estados de captura, subida y recuperación permanecen iguales. El valor predeterminado del componente Toast se conserva; los consumidores mixtos declaran explícitamente éxito o aviso.

Los doce arreglos se prepararon sin modificar `main`, desplegar ni operar sobre la cuenta real. Su último commit es `10c548fe59b805a881b3a2ec4426f2fcb328a311`; los hashes de la tabla son definitivos. Por pedido posterior del dueño, este informe se incorpora en un commit documental final y se sube `arreglos-auditoria` a `origin`, sin abrir PR ni modificar `main`.

La copia Git usada está en `C:\Users\Brunito\Documents\Codex\2026-09-09\github-plugin-github-openai-curated-remote\work\sesion-arreglos`. El archivo versionado es `docs/auditoria/2026-09-10-arreglos-astra.md`. El hash del commit documental se confirma después de crearlo y verificar la punta remota; no puede incluirse dentro de su propio contenido. Se entrega una copia idéntica en la carpeta de resultados de esta tarea.

No fue necesario pasar a B un arreglo inicialmente incluido en A. Las pruebas de interfaz son de componentes con red simulada; no sustituyen integración con proveedores ni aceptación en dispositivo.

## Cobertura de los apartados del informe anterior

Esta tabla es un índice de las piezas ya clasificadas, no otra clasificación ni un cierre de apartados completos.

| Apartado original | Piezas de esta ejecución |
|---|---|
| B.1 | C01 |
| B.2 | C02 |
| B.3 | C03 |
| B.4 | A01–A05, A07–A09, B10, C01 |
| B.5 | B09, C05, C20; los defectos concretos repetidos remiten a A, B05, B06, C02 y C03 |
| C.2 filas 1–8 | C03; A07; A06; C04; C05; B09; C05; A11 |
| E.1–E.4 | B01; B02/C06; A09/C07; C08 |
| E.5–E.8 | A08/B06/C21; B03; C09; C10 |
| E.9–E.12 | A09/B07/C11; A09/C12; A09/B05/B08/C13; A09/B04/C14/C15 |
| E.13–E.17 | C16; A09/C17; C18; C19; A11/B09/B11 |
| F.1 | A01–A10, B10/B11, C01 |
| F.2 | C03 |
| F.3 | A11/A12, B06, C09 |
| F.4 | C02 |
| F.5 | B05/B08, C13 |
| F.6 | B09, C05/C20 |
| F.7 | B01/B02, C06–C09, C16, C22 |
| F.8 | B06, C12/C21 |
| F.9 | B03/B07/B08, C10–C12, C18 |
| F.10 | A09, B04, C06/C07, C14–C19 |

## Dudas y límites pendientes

- La entrada actual decía que el audio se cifra antes de salir del teléfono: eso describe el envío y no era literalmente una afirmación de cifrado local continuo. A09 la vuelve explícita; la afirmación falsa sobre la copia local sí estaba en la ayuda.
- El corpus describe comportamiento existente. Sus pruebas verifican lo que recibe Lupita; no prueban que Sonnet siempre responda correctamente ni que el tono haya quedado resuelto.
- No hay evidencia nueva de iPhone/Android, grabaciones largas, bloqueo, recuperación audible ni crecimiento del streaming en producción. Los tests de avisos sustituyen audio/red y no certifican el grabador.
- B04 necesita precisar el marcador de credencial y su transición sin migración. El usuario actual no tiene columna de versión ni fecha de cambio de contraseña; no se inventó una existente.
- B05 necesita una identidad propia para el reintento de feedback. Los estados de una sesión completa no permiten inferir todos los estados del feedback; aprobar la propuesta visual no autoriza adaptar el worker sin su diseño y pruebas.
- B03 puede reutilizar el puntero remoto persistido, pero no demuestra eliminación de copias previas de claves en respaldos; esa comprobación sigue en C.
- No se verificaron políticas efectivas de proveedores, custodia de claves, recepción real de alertas, restauración ni origen sintético de todas las capturas públicas.
- Las estimaciones horarias del informe anterior eran orientativas y no se convierten aquí en compromiso de ejecución de B o C.
