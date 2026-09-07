# Auditoría de arquitectura y calidad de Sesión

Fecha: 7 de septiembre de 2026. Repositorio: [BrunoGandolfo/sesion](https://github.com/BrunoGandolfo/sesion).  
Base auditada: [7024dcda8f504e38e76c96339ec32f30b5de33dc](https://github.com/BrunoGandolfo/sesion/commit/7024dcda8f504e38e76c96339ec32f30b5de33dc) de main. Todas las referencias de código están fijadas a ese commit.

## Resumen ejecutivo

Sesión tiene una base razonable para su tamaño y no necesita una reescritura.  
La revisión encontró tres problemas críticos que pueden borrar audio o aceptar resultados de un procesamiento anterior.  
La recuperación de grabaciones y la actualización de la historia clínica también pueden quedar bloqueadas.  
Las operaciones simultáneas tienen protecciones, pero todavía pueden pisarse en cobros, recordatorios y edición clínica.  
Los tests existentes son valiosos y la CI revisada está en verde; faltan pruebas de recorridos completos y de esas carreras.  
El rastro de acciones y la conservación del audio en el dispositivo necesitan reglas más consistentes.  
La deuda de mantenimiento está concentrada en unos pocos archivos grandes, formularios duplicados y piezas sin uso.  
La prioridad es corregir esos flujos y cubrirlos con pruebas antes de reorganizar el código.

## Alcance, método y límites

Se completó primero la lectura íntegra de README.md, AGENTS.md, prisma/schema.prisma, package.json, tsconfig.json y eslint.config.mjs, más el árbol completo de src/ y processor/. El inventario recursivo de Git no estaba truncado: 463 archivos versionados, de los cuales 269 están en src/ y 36 en processor/. Se incluyeron configuración, migraciones, documentación y workflows en la revisión dirigida. Se excluyeron dependencias, builds, cobertura y otros directorios generados.

La investigación siguió los recorridos de datos y sus escrituras: grabar → recuperar/subir → reclamar → callback → revisar/aprobar/descartar; turno → cobrar/deshacer → recordatorio; consentimiento; contexto longitudinal y auditoría. Después se contrastaron sus consumidores y tests, y se revisaron dependencias y decisiones estructurales. Este orden permitió detectar invariantes que una revisión archivo por archivo pasaría por alto: un control correcto en upload-confirmar no protege un PATCH alternativo, y una transición atómica en Postgres no vuelve atómico el borrado previo en R2.

Se hizo análisis estático en memoria: inventario, búsqueda de referencias, grafo de imports locales y lectura de implementaciones/tests. Para Python se usó su AST estándar, sin ejecutar módulos. Para TypeScript se revisaron imports estáticos/dinámicos y reexports con búsquedas sobre texto sin comentarios. No se instalaron dependencias, ejecutaron migraciones, consultaron datos de pacientes ni leyeron archivos .env. No se ejecutaron localmente build, lint o tests: además de generar archivos, las pruebas de integración vacían una base compartida.

Como evidencia independiente, la [corrida CI 110](https://github.com/BrunoGandolfo/sesion/actions/runs/34151651060), correspondiente exactamente al SHA auditado, figura completada con éxito: Typecheck, Build, Lint, Test y Worker tests. Se consultaron sus estados y pasos; no se inició ninguna corrida. Ese resultado confirma los controles existentes, no los escenarios ausentes señalados aquí.

Los hallazgos describen comportamiento deducible del código, no incidentes observados en producción. Las carreras se exponen mediante intercalaciones concretas, sin reproducirlas sobre servicios reales. No se verificaron IAM de R2, variables desplegadas, logs de uso, retención efectiva de proveedores ni restauraciones de backups. No se calculó porcentaje de cobertura: no hay evidencia de instrumentación ejecutada en esta auditoría. El grafo excluye dependencias internas de paquetes instalados y no prueba ausencia de consumidores externos.

Único entregable autorizado: este informe en docs/auditoria/00-arquitectura-y-calidad.md. No se incluyen cambios de implementación, dependencias ni tests nuevos.

## Veredicto de arquitectura

La separación actual es parcial y útil. Los casos de uso en api/_lib/casos-uso reciben dependencias y evitan acoplarse a Request/Response; processor/app_client concentra el HTTP hacia la app; hay utilidades compartidas de fechas, moneda, SMS y transiciones. Las proyecciones clínicas excluyen transcripción y clave temporal de las respuestas normales, con tests que lo comprueban. Conviene conservar esa base.

Los límites más débiles están en la coordinación de operaciones que duran más de una escritura o incluyen un proveedor, y en componentes que coordinan varios pasos de negocio con estado local. GrabarView y NuevoTurnoForm hacen de capa de aplicación del navegador; la persistencia del resultado parcial no es suficiente. ConfigView reúne transformación de datos, cola de guardado y presentación. En el backend, el PATCH general de sesión y varias rutas de consentimiento/turnos todavía contienen la decisión de negocio junto al acceso a datos.

No se encontró un componente cliente que importe Prisma o se conecte directamente al worker. [src/app/(dashboard)/grabar/\[turnoId\]/page.tsx:56][s125] y su lectura de turno en línea 80 usan Prisma en un Server Component con proyección y filtro de organización: es una consulta sencilla coherente con Next, no una exposición de Prisma al navegador. Una capa adicional para cada SELECT no resolvería los defectos identificados.

## Tabla de hallazgos

Severidad: **crítico** = posibilidad concreta de destruir audio o aceptar contenido clínico de un trabajo reemplazado; **importante** = pérdida de cambios, flujo bloqueado, inconsistencia o control relevante incompleto; **menor** = deuda localizada de mantenimiento. Los esfuerzos son días de una persona familiarizada con el repo, incluyendo comprobación dirigida; no son un cronograma ni deben sumarse, porque varios trabajos se solapan.

| ID | Severidad | Archivo:línea | Problema | Impacto | Esfuerzo estimado |
| --- | --- | --- | --- | --- | --- |
| H01 | crítico | [src/app/api/sesion-clinica/\[id\]/route.ts:31][s1]; [src/app/api/sesion-clinica/\[id\]/route.ts:181][s2]; [src/app/api/_lib/casos-uso/reintentar-sesion.ts:98][s3]; [src/lib/r2.ts:158][s4] | **El PATCH general permite cambiar el objeto de audio sin validar su pertenencia.** Acepta cualquier audioR2Key, incluso sin cambio de estado. La comprobación de key de upload-confirmar no cubre esta escritura ni el reintento. | Una sesión propia puede apuntar a otro objeto conocido del bucket; aprobar o eliminar esa sesión puede borrar el audio ajeno. El filtro de organización de la fila no protege el objeto R2. | 1–2 días |
| H02 | crítico | [src/app/api/_lib/casos-uso/aprobar-sesion.ts:104][s5]; [src/app/api/_lib/casos-uso/aprobar-sesion.ts:117][s6]; [src/app/api/_lib/casos-uso/eliminar-sesion.ts:209][s7] | **Aprobar borra el audio antes de asegurar la transición.** El efecto irreversible en R2 ocurre antes del UPDATE condicionado a revisión. Un descarte concurrente puede ganar ese UPDATE. | La aprobación responde 409 pero ya destruyó el audio; el descarte deja la sesión en error y promete que conserva un audio que ya no existe. | 2–3 días |
| H03 | crítico | [src/app/api/_lib/casos-uso/procesar-callback.ts:96][s8]; [src/app/api/_lib/casos-uso/procesar-callback.ts:127][s9]; [src/app/api/_lib/casos-uso/reclamar-pendientes.ts:109][s10] | **Los callbacks no se vinculan al intento que reclamó el trabajo.** La aceptación comprueba solo id y estado procesando. El intento del payload sirve para auditar, sin compararse con el trabajo vigente. | Un resultado o error de un worker cuyo lease venció puede cerrar el procesamiento nuevo y hacer rechazar su resultado correcto. | 2–4 días |
| H04 | importante | [src/app/(dashboard)/grabar/\[turnoId\]/_components/grabar-view.tsx:110][s11]; [src/app/(dashboard)/grabar/\[turnoId\]/_components/grabar-view.tsx:120][s12]; [src/app/(dashboard)/grabar/\[turnoId\]/_components/grabar-view.tsx:255][s13]; [src/app/(dashboard)/grabar/\[turnoId\]/_components/grabar-view.tsx:382][s14] | **Guardar una grabación recuperada falla después de recargar la pantalla.** Guardarla ahora entrega el audio a subir sin inicializar sesionIdRef. Esa inicialización ocurre únicamente al empezar una grabación nueva; Reintentar tampoco la realiza. | El recorrido de recuperación queda bloqueado en no-guardado. Los chunks siguen en el dispositivo, pero la usuaria no puede rescatarlos por ese recorrido. | 1–2 días |
| H05 | importante | [src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts:59][s15]; [src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts:107][s16]; [src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts:192][s17]; [src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts:276][s18] | **El contexto longitudinal deja de avanzar al superar la ventana inicial.** Se toman las primeras 20 aprobadas y después se descartan las ya integradas, sin avanzar un cursor. El conteo de salud repite el patrón sobre 200 filas. | Con corte fijo y primeras 20 ya integradas, las siguientes no se entregan nunca. La métrica puede contar cero pendientes reales fuera de su ventana, aunque sí avisa saturación. | 1–2 días |
| H06 | importante | [src/app/api/sesion-clinica/\[id\]/route.ts:137][s19]; [src/app/api/sesion-clinica/\[id\]/route.ts:153][s20]; [src/app/api/sesion-clinica/\[id\]/route.ts:182][s21] | **El PATCH clínico valida un estado que no condiciona la escritura.** Lee el estado, valida la transición y escribe solo por id y organización. | Una vuelta subiendo→grabando puede pisar una confirmación que ya pasó la sesión a procesando; la tabla de transiciones no protege esa carrera. | 0,5–1 día |
| H07 | importante | [src/app/api/_lib/contexto-clinico/actualizar.ts:44][s22]; [src/app/api/_lib/contexto-clinico/actualizar.ts:47][s23]; [src/app/api/_lib/contexto-clinico/actualizar.ts:78][s24]; [processor/contexto_worker.py:81][s25] | **El contexto no detecta ediciones concurrentes ni conserva la última revisión humana.** Lee version y escribe version+1 mediante upsert sin versión esperada. El worker calcula desde un contexto anterior y reemplaza los mismos campos que edita la terapeuta. | Puede perderse una edición humana o repetirse una versión. La sugerencia automática ocupa la única fila y reemplaza el contenido revisado anterior. | 2–3 días |
| H08 | importante | [src/app/api/_lib/casos-uso/cobrar-turno.ts:94][s26]; [src/app/api/_lib/casos-uso/cobrar-turno.ts:104][s27]; [src/app/api/_lib/casos-uso/cobrar-turno.ts:170][s28]; [src/app/api/turnos/\[id\]/route.ts:88][s29]; [src/app/api/turnos/\[id\]/route.ts:150][s30] | **Cobrar, reprogramar y deshacer cobro no comparten todas las invariantes.** El cobro condiciona estado y pago, pero no la fecha validada; no participa del lock de agenda. Deshacer cobro escribe sin identificar el cobro leído. | Una reprogramación concurrente puede terminar cobrada en una fecha futura. Un deshacer atrasado puede anular un cobro posterior, sin conservar fecha ni método. | 2–3 días |
| H09 | importante | [src/app/api/_lib/casos-uso/enviar-recordatorios.ts:178][s31]; [src/app/api/_lib/casos-uso/enviar-recordatorios.ts:318][s32]; [src/app/api/recordatorios/\[id\]/reintentar/route.ts:74][s33]; [src/app/api/_lib/casos-uso/recordatorios-del-turno.ts:91][s34] | **Los recordatorios conservan ventanas de envío y reactivación obsoletos.** El envío usa el turno leído antes de reservar y consume el intento solo por id. Reintentar no condiciona fecha/estado del turno; reprogramar no cierra recordatorios fallidos. | Puede enviarse un aviso ya cancelado antes de llamar al proveedor, o revivirse el aviso viejo junto con el recién programado. | 2–3 días |
| H10 | importante | [src/app/api/pacientes/\[id\]/consentimiento/route.ts:32][s35]; [src/app/api/pacientes/\[id\]/consentimiento/route.ts:132][s36]; [src/app/api/pacientes/\[id\]/consentimiento/route.ts:156][s37] | **La versión del consentimiento no queda vinculada al texto firmado.** El cliente puede declarar cualquier textoVersion no vacío, pero el servidor siempre genera el texto de la versión actual. | Una pantalla abierta antes de un cambio de texto puede guardar una firma con versión declarada y contenido distintos; el registro deja de probar qué texto se presentó. | 1–2 días |
| H11 | importante | [vitest.config.ts:18][s38]; [vitest.config.ts:48][s39]; [src/lib/__tests__/config-contrato.test.ts:115][s40]; [src/lib/__tests__/solapamiento-turnos.test.ts:276][s41] | **La suite unitaria incluye dos archivos que conectan y vacían la base de test.** INTEGRACION enumera 11 archivos y omite config-contrato y solapamiento-turnos, cuyos hooks conectan a Neon y ejecutan vaciarTablas. | test:unit deja de ser independiente de la base y test:integration omite esas regresiones. npm test en CI sí ejecuta ambos. | 0,25–0,5 día |
| H12 | importante | [src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx:309][s42]; [src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx:346][s43]; [src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx:361][s44] | **Reintentar agendar puede crear pacientes duplicados.** El alta de paciente se confirma antes de crear el turno; su id queda solo en una variable local. Si falla el turno, creando sigue activo. | Tras un 409 por solapamiento o un error de red, reintentar vuelve a dar de alta a la misma persona. | 0,5–1 día |
| H13 | importante | [src/app/(dashboard)/_components/sheet-nuevo-turno.tsx:32][s45]; [src/components/forms/nuevo-turno-form.tsx:330][s46]; [src/components/forms/nuevo-turno-form.tsx:348][s47] | **Crear paciente desde Hoy es una acción sin implementación.** El botón Crear paciente únicamente vacía pacienteId y cierra el selector. No crea, navega ni abre un formulario. | La pantalla promete completar el alta después, pero queda sin paciente válido y no permite agendar. La Agenda usa otra implementación que sí crea. | 0,25–0,5 día |
| H14 | importante | [src/app/(dashboard)/config/_components/config-view.tsx:189][s48]; [src/app/(dashboard)/config/_components/config-view.tsx:277][s49] | **El guardado automático descarta cambios al salir rápidamente.** Los cambios esperan 1,5 segundos; el desmontaje cancela el temporizador sin resolver los campos pendientes. | Editar tarifa, dirección o recordatorio y navegar enseguida pierde esa edición antes de mandar la solicitud. | 0,5–1 día |
| H15 | importante | [src/app/api/_lib/auditoria.ts:25][s50]; [src/app/api/_lib/auditoria.ts:44][s51]; [src/app/api/turnos/\[id\]/cobrar/route.ts:20][s52]; [src/app/api/pacientes/\[id\]/consentimiento/route.ts:101][s53]; [src/app/api/sesion-clinica/route.ts:17][s54] | **La auditoría tiene huecos de acciones y depende de un guardado sin recuperación.** Cobrar/deshacer y firmar/revocar no registran actor en eventos_auditoria. La lectura por turno evita sesion.ver. Los fallos de inserción se registran solo en consola. | No hay un rastro homogéneo para reconstruir acciones relevantes; una operación exitosa puede quedar sin evento recuperable. | 2–4 días |
| H16 | importante | [vitest.config.ts:42][s55]; [src/lib/__tests__/grabacion-subida.test.ts:24][s56]; [src/lib/__tests__/deshacer-cobro.test.ts:17][s57] | **La UI crítica carece de pruebas del recorrido completo.** Hay tests de helpers, HTTP simulado y almacenamiento, pero no renderizado/interacción real ni pruebas de navegador de grabación, consentimiento, cobro y aprobación. | Las partes pasan aisladas y fallan al enlazarlas: H04, H12, H13 y H14 son ejemplos concretos. | 3–5 días para los recorridos prioritarios |
| H17 | importante | [processor/contexto_worker.py:38][s58]; [processor/contexto_worker.py:57][s59]; [src/app/api/sesion-clinica/aprobadas-sin-contexto/route.ts:24][s60]; [processor/worker.py:82][s61] | **La recuperación del contexto depende de memoria y del reinicio del worker.** Tres fallos dejan un bloqueo infinito en memoria sin estado consultable desde la app. Si falta CONTEXTO_DESDE, el corte avanza a hoy y abandona pendientes del día anterior. El worker procesa secuencialmente un lote ya reclamado. | Una falla transitoria puede requerir reinicio o intervención manual; trabajos esperando dentro del lote pueden consumir parte de su lease sin empezar. | 1–2 días |
| H18 | importante | [src/components/grabacion/GrabadorSesion.tsx:649][s62]; [src/lib/grabacion-storage.ts:22][s63]; [src/lib/grabacion-storage.ts:229][s64]; [src/components/layout/sidebar.tsx:132][s65] | **El respaldo local conserva audio sin cifrar y sin una política de vencimiento.** Se persiste event.data en IndexedDB antes del cifrado final. El almacén comparte origen y no registra usuario/organización ni vencimiento; salir de la cuenta no lo limpia. | Una grabación fallida puede sobrevivir indefinidamente en un dispositivo compartido. La protección del audio en R2 no cubre ese respaldo. | 2–4 días |
| H19 | importante | [src/app/api/_lib/casos-uso/enviar-recordatorios.ts:185][s66]; [src/app/api/pacientes/\[id\]/contexto-clinico/route.ts:34][s67] | **Algunos procesos leen más información personal de la necesaria.** El cron SMS incluye el paciente y la configuración completos, aunque necesita pocos campos. El secreto M2M habilita leer y modificar el contexto de cualquier paciente conocido, sin acotarlo a un trabajo reclamado. | El cron accede innecesariamente a notas/contactos; el alcance global del worker amplía el impacto de un error o credencial comprometida. | 0,5–1 día para proyecciones; 2–3 para alcance M2M |
| H20 | importante | [prisma/schema.prisma:313][s68]; [prisma/schema.prisma:322][s69]; [prisma/schema.prisma:325][s70]; [prisma/schema.prisma:328][s71] | **Contenido clínico estructurado queda sin cifrado de aplicación por una consulta futura.** Objetivos, intervenciones y temas son JSON en claro; el comentario justifica la decisión por un tablero que podría existir. Que sean textos cortos no los vuelve ajenos a la historia clínica. | Accesos de lectura o exports de Postgres exponen contenido clínico sin requerir la clave de notas. | 1–2 días de definición; 2–4 si exige migración |
| H21 | menor | [src/app/(dashboard)/pacientes/\[id\]/_components/turnos-pagos-tab.tsx:85][s72]; [src/app/(dashboard)/_components/datos.ts:8][s73]; [src/hooks/useGrabacionSesion.ts:6][s74]; [src/types/domain.ts:384][s75] | **Las dependencias de presentación y contratos apuntan en direcciones poco claras.** Operaciones HTTP y parseo de cobro viven dentro del módulo de una pestaña, que los tests deben importar; tipos de dashboard salen de api/_lib y un hook toma un tipo de GrabadorSesion. domain.ts reexporta normalizadores que importan sus tipos. | Mover una pantalla mueve también contratos y operaciones. Los ciclos detectados son de tipos, sin ciclo de ejecución confirmado. | 1–2 días |
| H22 | importante | [src/app/api/_lib/domain.ts:183][s180]; [src/app/api/_lib/domain.ts:55][s181]; [src/app/(dashboard)/_components/datos.ts:128][s182]; [src/app/(dashboard)/pacientes/\[id\]/_components/turnos-pagos-tab.tsx:149][s183] | **La regla compartida de deuda no se adoptó en todos los consumidores.** esDeudaPendiente existe, pero la combinación realizado/pago pendiente se repite en el cálculo por paciente, Hoy y la pestaña de pagos. También se duplican duraciones, validaciones de turno y etiquetas. | La regla actual coincide, pero cambiarla exige sincronizar al menos cuatro consumidores; pueden divergir el KPI, la deuda y el botón de cobro. | 0,5–1 día para deuda; 1–2 para el resto |
| H23 | importante | [src/components/grabacion/GrabadorSesion.tsx:157][s82]; [src/app/(dashboard)/config/_components/config-view.tsx:153][s83]; [processor/schemas_llm.py:490][s84] | **La complejidad se concentra en controladores de UI y adaptación del pipeline.** GrabadorSesion acumula 69 decisiones estructurales y 1.064 líneas; configuración mezcla cola de guardado, transformación y vistas. Los validadores Python concentran decisiones de saneamiento y compatibilidad. | Las transiciones y efectos quedan difíciles de revisar en conjunto y de probar; el ranking reproducible figura más abajo. | 2–5 días por foco, después de cubrir su comportamiento |
| H24 | menor | [src/components/grabacion/HotWordsManager.tsx:125][s85]; [src/hooks/useGrabacionSesion.ts:335][s86]; [src/lib/prompts.ts:1][s87] | **Persisten módulos y ramas sin consumidores.** Hay un componente de 579 líneas sin importadores, acciones de grabación nunca consumidas y archivos vacíos de compatibilidad. | Aumentan búsqueda, revisión y posibilidades de reutilizar un flujo viejo. No aportan comportamiento actual. | 0,5–1 día |
| H25 | menor | [processor/callback.py:1][s88]; [processor/config.py:46][s89]; [processor/clinical_analyzer.py:210][s90]; [src/app/(dashboard)/pacientes/\[id\]/_components/progreso-lecturas.ts:267][s91] | **Hay compatibilidad y configuración sin segundo caso de uso vigente.** Un reexport de callback no tiene consumidores; LLM_BACKEND solo admite Anthropic y otras opciones fallan tarde; hay un slot de lectura que solo devuelve null y nadie llama. | Se aparentan extensibilidad y compatibilidad que hoy no existen, con más lugares para entender o configurar. | 0,25–0,5 día |
| H26 | menor | [src/lib/grabacion-storage.ts:15][s92]; [src/lib/grabacion-storage.ts:47][s93]; [src/components/forms/nuevo-turno-form.tsx:51][s94]; [src/components/forms/nuevo-turno-form.tsx:59][s95]; [src/lib/sesion-clinica-utils.ts:256][s96] | **Algunos nombres ocultan identidades y mezclan vocabularios dentro del módulo.** sesionClinicaId en IndexedDB contiene realmente turnoId. conviven patientMatches, fullName, nuevoTurnoSchema y campos españoles; normalizeSesionClinica coexiste con normalizarSesionClinica en otro módulo. | La identidad ambigua facilita cruzar claves en recuperación. La mezcla de nombres dificulta encontrar la implementación vigente. | 0,5–1 día |

## Escenarios que sustentan los hallazgos de mayor impacto

### Audio y procesamiento: H01–H04, H06

**H01.** Una solicitud autenticada sobre una sesión propia puede cambiar solo audioR2Key y eludir la validación de pertenencia de [src/app/api/sesion-clinica/\[id\]/upload-confirmar/route.ts:80][s126]. Si conoce la key de otro objeto del mismo bucket autorizado, el borrado posterior consume esa key sin verificarla de nuevo: [src/app/api/_lib/audio.ts:26][s127] y [src/lib/r2.ts:163][s128]. El alcance entre organizaciones depende de conocer la key y de los permisos efectivos del bucket; no se demostró enumeración ni lectura del audio ajeno. El fallo de vinculación y la ruta de borrado sí están en el código. También permite sustituir la referencia dentro de una misma organización y dejar el audio original huérfano.

**H02.** A lee revisión y espera borrarAudio. B descarta, escribe error y conserva referencia/clave para reprocesar. A borra el objeto y su UPDATE condicionado a revisión devuelve cero. B termina anunciando conservación, A devuelve 409 y el blob ya no está. El test de [src/lib/__tests__/casos-uso-sesion.test.ts:1053][s129] cubre el orden opuesto —descarte después de una aprobación ya escrita—, no este efecto externo anterior al control. También importa el fallo de persistencia después de un borrado exitoso. La transcripción puede seguir guardada; lo perdido en este escenario es el audio y la posibilidad de reprocesar desde él.

**H03.** A reclama un trabajo; vence el lease; B reclama la misma sesión con un intento nuevo. Mientras el estado sigue procesando llega el callback de A: se acepta, cambia el estado y hace rechazar el callback de B. Si A envía error, puede cerrar B igualmente. Un entero que se resetea en el reintento manual tampoco identifica de forma inequívoca generaciones a lo largo de todo el ciclo. Los tests actuales verifican lease, tope y rechazo por estado, pero no correlacionan cada callback con su reclamación.

**H04.** Tras recargar, Guardarla ahora invoca enviarPendiente en [src/components/grabacion/GrabadorSesion.tsx:1015][s130], cifra y llama a subir; sesionIdRef sigue null. La única asignación está en empezar. El respaldo no se borra por ese error, por lo que no debe describirse como pérdida inmediata. Hay un segundo límite de recuperación: [src/lib/grabacion-storage.ts:258][s131] devuelve solo la grabación más reciente de todo el almacén y [src/components/grabacion/GrabadorSesion.tsx:817][s132] la descarta si no coincide con el turno actual. Una pendiente más antigua del turno abierto queda oculta detrás de otra más reciente.

**H06.** La validación de transición es compartida y existe. El defecto es que el UPDATE no exige seguir en el estado sobre el que se validó. Por eso dos recorridos individualmente permitidos pueden componer una transición imposible.

### Contexto longitudinal: H05, H07 y H17

Con un CONTEXTO_DESDE fijo, una vez integradas las primeras 20 aprobadas del conjunto, cada consulta vuelve a traer esas mismas 20 y las filtra: la 21.ª queda fuera para siempre. No depende de una gran instalación. El monitoreo limita antes de filtrar a 200; puede devolver cantidad cero con pendientes posteriores. **Sí existe una alerta separada por saturación**, incluso con cantidad cero, en [src/app/api/_lib/casos-uso/salud.ts:281][s133]. El diagnóstico es selección que no avanza y monitoreo que exige revisión manual, no ausencia total de alertas.

Si CONTEXTO_DESDE falta o es inválido, el corte cambia cada día: evita cargar todo el histórico, pero excluye también pendientes legítimas que cruzaron medianoche. Es un escenario condicionado a configuración, cuyo valor desplegado no se inspeccionó. Los tres fallos terminales del worker quedan únicamente en memoria; el reinicio borra ese límite y no distingue una recuperación consciente de una nueva ronda de fallos.

En la actualización, dos lectores pueden observar versión 4 y ambos persistir versión 5. Más grave: mientras el LLM calcula desde la versión 4, una edición humana puede aprobar la 5; el worker después reemplaza campos basados en la 4. No se envía versión esperada. Además, la fila canónica y la sugerencia comparten almacenamiento: [src/app/api/_lib/contexto-clinico/formato-llm.ts:37][s134] etiqueta la revisión como pendiente pero igualmente incluye hipótesis y resumen en líneas 55 y 81. No los presenta falsamente como aprobados; falta precisar si una sugerencia todavía no revisada debe alimentar el siguiente análisis y cómo preservar la última revisión humana.

### Cobro, mensajes y consentimiento: H08–H10

En el cobro existe una protección correcta contra dos cobros sobre el mismo estado pendiente. La carrera restante cruza comandos: A lee un turno programado cuya hora ya pasó; B lo reprograma a futuro y conserva programado; A cobra porque su UPDATE no compara fecha. En sentido inverso, una edición de agenda validada sobre programado puede continuar después del cobro, porque cobrar no participa de su lock. Deshacer dos veces solo es idempotente mientras no ocurra un nuevo cobro entre ambas solicitudes; la escritura atrasada actual también borra ese nuevo cobro.

En SMS se preserva correctamente la evidencia de un envío que termina después de una cancelación ([src/app/api/_lib/casos-uso/enviar-recordatorios.ts:339][s135]), con pruebas específicas. Lo que falta es revalidar las condiciones que pueden haber cambiado **antes** de llamar al proveedor. Hay otra intercalación: reintentar lee un fallido con turno futuro; reprogramar crea un aviso nuevo y deja el fallido intacto; reintentar revive el viejo para ahora. El cron puede terminar enviando ese aviso adicional. Una cancelación ocurrida cuando el proveedor ya aceptó el mensaje no puede deshacerlo; el objetivo es cerrar las ventanas evitables y mantener conciliación/evidencia para las inevitables.

El consentimiento se genera en servidor con datos del paciente y consultorio actuales, pero se persiste una etiqueta de versión elegida por el cliente. No hay una vinculación verificable entre la firma recibida, el contenido presentado y esa etiqueta. Se detectó además un hueco de prueba de firmas simultáneas: la secuencia revocar-vigentes/crear no cuenta con una restricción que asegure por sí sola un único vigente si dos transacciones parten sin filas vigentes. Esto último se registra como escenario a comprobar, sin afirmar que haya sucedido.

## Top 15 a resolver primero

Orden por impacto y esfuerzo: primero destrucción de audio/integridad clínica, después bloqueos y correcciones acotadas con alto rendimiento, luego coordinación de cobros/mensajes, retención y trazabilidad. Cada corrección incluye su prueba de regresión; H16 es el trabajo transversal de recorridos completos, no una razón para postergar pruebas hasta terminar las quince.

| Orden | Hallazgo | Por qué entra primero | Esfuerzo | Dirección y criterio de comprobación |
| --- | --- | --- | --- | --- |
| 1 | H01 — El PATCH general permite cambiar el objeto de audio sin validar su pertenencia | Evita borrar objetos ajenos a la sesión. | 1–2 días | Cerrar todas las escrituras alternativas de la referencia y asegurar la correspondencia organización–sesión–turno antes de consumir o borrar el objeto. Verificación: El mismo audio de otra sesión debe rechazarse por PATCH, reintento, aprobación y eliminación. |
| 2 | H02 — Aprobar borra el audio antes de asegurar la transición | Evita destrucción irreversible durante un conflicto. | 2–3 días | Coordinar la reserva de aprobación y sus efectos externos con descarte y reintento, con recuperación explícita ante fallos. Verificación: Intercalar aprobación y descarte durante el borrado externo; una operación rechazada no debe destruir el audio que la otra conserva. |
| 3 | H03 — Los callbacks no se vinculan al intento que reclamó el trabajo | Protege la nota frente a trabajos reemplazados. | 2–4 días | Identificar cada reclamación de forma inequívoca y condicionar todos sus resultados, también los errores, a esa generación. Verificación: Reclamar un intento nuevo y recibir éxito/error del anterior: no deben modificar el vigente; incluir reintento manual que resetea intentos. |
| 4 | H04 — Guardar una grabación recuperada falla después de recargar la pantalla | Recupera una función esencial con alcance acotado. | 1–2 días | Resolver la sesión persistida también al recuperar; comprobar recarga y recuperación completa antes de limpiar el respaldo. Verificación: Recargar con chunks pendientes, usar Guardarla ahora y completar la confirmación, sin empezar una grabación nueva. |
| 5 | H05 — El contexto longitudinal deja de avanzar al superar la ventana inicial | Impide un bloqueo determinista a partir de pocas sesiones. | 1–2 días | Seleccionar pendientes efectivos o recorrer el conjunto con avance garantizado; preservar el orden por paciente y una métrica accionable. Verificación: Primeras 20 integradas y una 21.ª pendiente: debe avanzar; repetir el límite de 200 en salud. |
| 6 | H06 — El PATCH clínico valida un estado que no condiciona la escritura | Cierra otra vía de estados inválidos con poco esfuerzo. | 0,5–1 día | Hacer que la validez de la transición sea parte de la escritura y definir una respuesta de conflicto coherente. Verificación: Confirmación de subida concurrente con vuelta a grabando; la escritura obsoleta debe entrar en conflicto. |
| 7 | H11 — La suite unitaria incluye dos archivos que conectan y vacían la base de test | Recupera rápidamente un aislamiento de tests hoy falso. | 0,25–0,5 día | Hacer verificable la clasificación por una convención de archivos y separar los casos puros de los hooks de integración. Verificación: La selección unitaria no debe importar hooks que conectan/truncan; la de integración debe incluir los 13 archivos actuales. |
| 8 | H10 — La versión del consentimiento no queda vinculada al texto firmado | Preserva la correspondencia entre firma y documento. | 1–2 días | Vincular presentación, versión y persistencia al mismo documento y resolver explícitamente versiones desactualizadas. Verificación: Firma desde una pantalla de versión anterior y dos firmas/revocaciones simultáneas, comprobando texto y vigencia. |
| 9 | H07 — El contexto no detecta ediciones concurrentes ni conserva la última revisión humana | Protege el trabajo revisado por la terapeuta. | 2–3 días | Detectar conflictos contra la versión leída y precisar la relación entre contenido revisado y sugerencia pendiente. Verificación: Editar mientras el worker calcula y aplicar dos PATCH desde la misma versión; no perder contenido ni repetir versión. |
| 10 | H08 — Cobrar, reprogramar y deshacer cobro no comparten todas las invariantes | Protege la exactitud de cobros y deuda. | 2–3 días | Definir y proteger conjuntamente fecha, estado y versión del cobro en todos los comandos que los cambian. Verificación: Cobrar/reprogramar y secuencia deshacer–recobrar con otro deshacer atrasado; conservar el cobro que corresponde. |
| 11 | H09 — Los recordatorios conservan ventanas de envío y reactivación obsoletos | Reduce mensajes incorrectos a pacientes. | 2–3 días | Vincular elegibilidad, reserva y reintento a la versión del turno; mantener la evidencia de envíos que ya salieron. Verificación: Cancelar después del claim pero antes de enviar, y reprogramar mientras se reintenta un fallido; inspeccionar mensaje y número de avisos vivos. |
| 12 | H12 — Reintentar agendar puede crear pacientes duplicados | Evita duplicar pacientes con un cambio pequeño. | 0,5–1 día | Conservar el resultado del primer paso y definir cómo continúa el caso de uso después de un éxito parcial. Verificación: Alta exitosa, turno rechazado, reintento: debe existir una sola alta. |
| 13 | H14 — El guardado automático descarta cambios al salir rápidamente | Evita perder configuraciones cotidianas. | 0,5–1 día | Definir la salida con cambios pendientes y comprobar el guardado, error y navegación como un único recorrido. Verificación: Editar y salir antes de 1,5 segundos; comprobar también request fallido y guardado en curso. |
| 14 | H18 — El respaldo local conserva audio sin cifrar y sin una política de vencimiento | Acota la conservación de un dato especialmente sensible. | 2–4 días | Definir protección, pertenencia y retención del respaldo sin sacrificar la recuperación de grabaciones pendientes. Verificación: Recuperación tras cierre, cambio de cuenta y vencimiento conforme a la política elegida; no eliminar un respaldo que se prometió recuperar. |
| 15 | H15 — La auditoría tiene huecos de acciones y depende de un guardado sin recuperación | Hace reconstruibles las acciones relevantes. | 2–4 días | Definir eventos requeridos por caso de uso, distinguir lectura humana de polling y recuperar fallos sin perder la disponibilidad. Verificación: Persistencia y actor en cobro, consentimiento y clínica; fallo de inserción del evento con una ruta de recuperación verificable. |

H22 permite una consolidación breve de la regla de deuda una vez estabilizado el cobro. H13 es una corrección breve que puede acompañar H12, pero no desplaza los controles de audio y datos clínicos. La reorganización por tamaño (H23), los nombres (H26) y la extensibilidad (H25) van después de estabilizar el comportamiento; el código muerto confirmado puede retirarse en una tanda separada y pequeña.

## Complejidad: los 15 archivos con más decisiones estructurales

[eslint.config.mjs:5][s136] usa las configuraciones de Next/TypeScript y no configura complexity explícitamente. No había una instalación del repo disponible para ejecutar esa regla sin instalar dependencias. Se usó un **conteo manual asistido de decisiones estructurales por archivo (D)**, no un valor inventado de complejidad ciclomática de ESLint.

D suma if —incluidos else-if—, for, while, catch y case no default en TS/TSX; en Python suma nodos If —incluidos elif—, For/AsyncFor, While y manejadores except. Se excluyen comentarios y cadenas; también se excluyen ternarios, operadores lógicos, opcionales, comprehensions y else/finally. Es una medida parcial de carga de control, no equivalente a la complejidad de una función ni comparable con un umbral de ESLint. La búsqueda TS es léxica, sin parser completo; la Python usa AST. Las líneas incluyen comentarios y espacios. Se excluyen tests del ranking, se incluyen módulos sin uso para que se vea qué conviene borrar. Empates por ruta.

| Puesto | Archivo y foco | D | Líneas | Lectura del resultado |
| --- | --- | ---: | ---: | --- |
| 1 | [src/components/grabacion/GrabadorSesion.tsx:157][s82] | 69 | 1064 | Control de micrófono, eventos, pausas, persistencia, cifrado y entrega en useGrabador. Separar efectos y estados antes de cambiar su presentación. |
| 2 | [processor/schemas_llm.py:490][s84] | 37 | 526 | sanear_feedback concentra 10 decisiones; validación de riesgo y de nota agregan 7 cada una. Reglas explícitas, con contratos de entrada distintos. |
| 3 | [src/app/(dashboard)/config/_components/config-view.tsx:153][s83] | 35 | 906 | Cola de autosave, campos sucios, transformaciones y controles. Extraer el ciclo de guardado; no convertir cada campo en una estrategia. |
| 4 | [processor/asr_assemblyai.py:184][s97] | 33 | 398 | Polling, estados externos y normalización de speakers. _esperar: 8; _normalizar: 7 decisiones. |
| 5 | [processor/clinical_analyzer.py:125][s98] | 31 | 472 | Llamadas, JSON, límites, reintentos y proveedores. _llamar_anthropic: 8; _llamar_validando: 7. |
| 6 | [src/hooks/useGrabacionSesion.ts:250][s99] | 31 | 492 | Carga/polling vigentes conviven con acciones sin consumidores. Borrar esas ramas antes de dividir el hook. |
| 7 | [src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx:108][s100] | 28 | 659 | Selector de paciente, teclado, alta y turno. Priorizar el éxito parcial de H12 y compartir las reglas con el formulario de Hoy. |
| 8 | [src/lib/prisma-encryption.ts:220][s101] | 28 | 402 | Compatibilidad de bytes/JSON, escritura cifrada y rechazo de consultas. La repetición por campo admite descriptores solo si preservan diferencias de tipo; no simplificar defensas por el número. |
| 9 | [src/app/(dashboard)/pacientes/\[id\]/_components/progreso-lecturas.ts:55][s102] | 22 | 305 | Lecturas clínicas mediante umbrales y textos. Mantener condiciones explícitas donde representan reglas distintas, extraer cálculo verificable de la redacción. |
| 10 | [src/components/grabacion/HotWordsManager.tsx:125][s85] | 22 | 579 | Componente sin consumidores: corresponde borrarlo, no rediseñarlo. |
| 11 | [processor/worker.py:115][s103] | 20 | 202 | Loop, señales, ejecución manual y errores. loop_principal: 7; procesado secuencial: 4. Cubrir recuperación antes de abstraer. |
| 12 | [src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx:144][s104] | 19 | 780 | Acciones del turno, formularios y confirmaciones en el mismo módulo. Aislar operaciones de la presentación. |
| 13 | [src/components/grabacion/FirmaCanvas.tsx:42][s105] | 19 | 210 | Mouse/touch, coordenadas, tamaño y firma. Eventos con rutas comunes pueden compartir normalización; hace falta prueba de interacción. |
| 14 | [processor/app_client.py:116][s106] | 18 | 194 | enviar_callback aporta 11 decisiones: clasificación HTTP, errores y estados terminales. Tabla de categorías si evita duplicar políticas de reintento. |
| 15 | [src/app/(dashboard)/agenda/_components/agenda-view.tsx:119][s107] | 18 | 450 | Ventanas de fechas, caché, carga y alta. Separar el ciclo de consulta de la coordinación visual. |

Los condicionales defensivos de criptografía, lectura de bytes y respuestas externas no son automáticamente un defecto. Sí hay candidatos a mapas para etiquetas de estado/pago y categorías repetidas de resultado; hay candidatos a early returns en coordinación de formularios. El caso más costoso, useGrabador, necesita separar efectos y responsabilidades, no reemplazar sus 69 decisiones con 69 entradas de configuración.

Para hacer comprobable la medida, en el primer archivo las decisiones están en las líneas: 210, 218, 229, 236, 250, 260, 264, 279, 285, 295, 304, 314, 325, 338, 341, 367, 373, 387, 417, 436, 467, 474, 488, 496, 511, 517, 527, 530, 539, 556, 587, 601, 611, 618, 628, 650, 654, 672, 677, 697, 705, 709, 728, 729, 737, 742, 787, 806, 813, 817, 821, 840, 855, 887, 898, 909, 916, 928, 939, 952, 958, 969, 973, 982, 1000, 1006, 1009, 1018, 1038. En Python, enviar_callback tiene 11 decisiones estructurales dentro de la función, sanear_feedback 10, _esperar 8 y _llamar_anthropic 8; son subtotales del D de sus respectivos archivos, no puntuaciones de ESLint.

## Código muerto confirmado para borrar

Criterio: sin consumidores de ejecución o tipos en el código y tests versionados, o subgrafo usado únicamente por otro elemento muerto. Se contrastaron imports, reexports, llamadas y convenciones de Next/Python. Un export sin importador externo no basta si tiene llamadas internas; por eso topTemas y registrarLoginOk no aparecen como candidatos a borrar. Tampoco se considera muerto un page, route, layout, instrumentation o conftest por no tener un importador ordinario.

| Archivo:línea exacta | Qué retirar | Evidencia y límite |
| --- | --- | --- |
| [src/components/grabacion/HotWordsManager.tsx:125][s85] | Archivo completo: HotWordsManager y sus auxiliares | Ningún importador ni render del componente en el repo; 579 líneas. Las rutas asociadas requieren otra comprobación. |
| [processor/callback.py:1][s88] | Archivo completo: aliases CallbackResultado/enviar_resultado | Ningún import Python lo consume; processor.py usa app_client directamente. |
| [src/app/(dashboard)/agenda/_components/brief-corto.tsx:1][s108] | Archivo completo: reexport BriefCorto | No tiene importadores; el componente real components/clinico/brief-corto.tsx sí se usa. |
| [src/app/(dashboard)/pacientes/\[id\]/_components/api-ficha.ts:1][s109] | Archivo completo vacío | Solo comentarios y export vacío; no tiene importadores. |
| [src/components/grabacion/NotaClinicaView.tsx:1][s110] | Archivo completo vacío | Menciones únicamente en comentarios; la UI vigente está en sesiones/[id]. |
| [src/components/grabacion/SesionHuerfanaBanner.tsx:1][s111] | Archivo completo vacío | Menciones únicamente en comentarios; esSesionHuerfana sí tiene consumidores y se conserva. |
| [src/lib/prompts.ts:1][s87] | Archivo completo vacío | Sin importadores; el cargador vigente pertenece al worker. |
| [src/app/api/_lib/domain.ts:127][s112] | minFecha | Una sola aparición ejecutable: su declaración; ninguna llamada en código o tests. |
| [src/lib/login-eventos.ts:231][s113] | registrarLoginFallido | Sin llamadas; el flujo atómico usa registrarFalloConClaves. registrarLoginOk sí tiene llamada interna y se conserva. |
| [src/lib/recordatorios-sms.ts:19][s114] | Reexports de sms-texto (valores y tipos), y alias buildReminderMessage en línea 31 | Los tres importadores solo consumen estaVencido, SmsMessage/SmsResult, sendSms y smsConfigurado. Conservar las implementaciones originales en sms-texto. |
| [src/lib/sesion-clinica-utils.ts:256][s96] | normalizeSesionClinica y su tipo RawSesionClinica (línea 238) | Ningún consumidor. No confundir con normalizarSesionClinica de useSesionClinicaPolling, que sí está vigente. |
| [src/lib/sesion-clinica-utils.ts:201][s115] | coerceDatosEstructurados | Solo lo llama normalizeSesionClinica, incluido en el borrado anterior. ensamblarNotaSOAP tiene otros consumidores. |
| [src/app/(dashboard)/pacientes/\[id\]/_components/progreso-lecturas.ts:271][s116] | lecturaRatioHabla | No tiene llamadas y devuelve siempre null. topTemas sí lo llama lecturaTemas y se conserva. |
| [src/app/api/_lib/schemas.ts:89][s117] | Tipos PacienteCreateInput (89) y PacienteUpdateInput (95) | Solo declaraciones. Los schemas de Zod correspondientes sí se usan. |
| [src/types/domain.ts:468][s118] | IniciarGrabacionRequest | Tipo sin consumidores. |
| [src/types/domain.ts:474][s119] | SubirAudioRequest | Tipo sin consumidores; describe una superficie anterior de subida. |
| [src/types/domain.ts:483][s120] | AprobarNotaRequest | Tipo sin consumidores. |
| [src/types/domain.ts:492][s121] | FirmarConsentimientoRequest | Tipo sin consumidores. |
| [src/types/domain.ts:499][s122] | ConsentimientoResponse | Tipo sin consumidores; la ruta tiene su propia forma de respuesta. |
| [src/types/domain.ts:511][s123] | ResultadoProcesamientoCallback | Tipo sin consumidores; el callback usa schema y PayloadCallback propios. |
| [src/hooks/useGrabacionSesion.ts:335][s86] | Acciones iniciar (335), completar (375), reintentarSubida (430), reintentar (441) y refrescar (463) | El único consumidor del hook, paciente-detail-view.tsx:179, toma sesionClinica y loading. Retirar las acciones y su estado exclusivo; conservar carga/polling y los helpers sueltos que usa GrabarView. |
| [src/components/forms/nuevo-turno-form.tsx:43][s124] | Prop tarifaDefault | Se declara pero no se desestructura ni se usa; su único montaje no la pasa. |

En las filas con varios símbolos, cada línea de declaración está indicada en la propia descripción. No se pide borrar el archivo completo de un símbolo aislado. Los imports que queden exclusivos de esas piezas se limpian junto con ellas; no se encontraron imports aislados adicionales con evidencia suficiente para agregarlos como hallazgo independiente.

### Sin consumidor interno, pero no aprobados para borrado automático

Las rutas [src/app/api/hot-words/route.ts:1][s137], [src/app/api/hot-words/\[id\]/route.ts:1][s138] y [src/app/api/hot-words/paciente/\[pacienteId\]/route.ts:1][s139] tienen como consumidor de UI el HotWordsManager huérfano. El worker actual no utiliza hot words. Son candidatas a retirar después de corroborar tráfico, clientes externos y necesidad de los datos almacenados; la mera falta de imports no demuestra que una ruta HTTP pública para usuarios autenticados esté muerta.

Los cuatro documentos de prompts/ en la raíz son una copia histórica sin ruta de carga en el pipeline actual: [prompts/README.md:1][s140], [prompts/clinical_note_v1.0.md:1][s141], [prompts/clinical_note_v2.0.md:1][s142] y [prompts/clinical_note_v2.1.md:1][s143]. El código vigente carga nombres/versiones desde processor/prompts. Conviene retirar o señalar explícitamente esa copia para no editar el prompt equivocado; es documentación histórica, no un componente ejecutado. Las versiones históricas dentro de processor/prompts merecen conservarse por trazabilidad de promptVersion, aunque no sean la versión seleccionada hoy.

## Cobertura de tests por capa

Inventario: 54 archivos .test.ts; 13 importan el helper de base de test. Hay 6 archivos de pruebas Python con 97 funciones test_, antes de expandir parametrizaciones. Son medidas de inventario, no porcentajes de cobertura ni un conteo de tests ejecutados en esta auditoría. Vitest corre en entorno node; los tests de UI existentes importan helpers o simulan APIs, sin renderizar los recorridos.

| Capa | Qué está cubierto en el repo | Hueco relevante y prioridad |
| --- | --- | --- |
| Dominio | Deuda, fechas de Montevideo, moneda, teléfono, texto SMS, programación de avisos, transiciones clínicas, claves de audio, consentimiento vigente, normalización clínica y saneamiento de auditoría. Ejemplos: [src/lib/__tests__/deuda.test.ts:1][s144], [src/lib/__tests__/sesion-clinica.test.ts:1][s145]. | P1: [src/lib/deudas.ts:13][s186], textoAtraso (20), interpolarTemplateCobro (54) y buildWhatsAppUrl (76) carecen de tests propios: deuda.test.ts cubre api/_lib/domain, otro módulo. Faltan bordes 14/15/30/31 y mensajes singular/plural/variables. También coherencia de reglas API/UI y fixtures compartidos Python→TypeScript. Los tests de cada formato aislado no verifican el contrato completo. |
| Casos de uso clínicos e integración | Aprobar/descartar/eliminar/reintentar, cifrado real con Prisma, callbacks por estado, reservas de borrado, lease/tope del worker y aislamiento entre organizaciones. [src/lib/__tests__/casos-uso-sesion.test.ts:161][s146], [src/lib/__tests__/casos-uso-worker.test.ts:1][s147]. | P0: key alternativa H01, aprobación frente a descarte y fallo de DB después de R2 H02, callback de generación vieja H03, PATCH clínico concurrente H06. P1: aislamiento de GET brief/progreso/documentacion/contexto-clinico entre organizaciones, hoy no demostrado por los tests de escritura. |
| Cobro | Estados permitidos, hora futura, doble cobro secuencial, organización, deshacer y ciclo cobrar/deshacer. [src/lib/__tests__/cobrar-turno.test.ts:1][s148]. | P1: intercalación controlada cobrar/reprogramar; deshacer atrasado después de recobrar; evento con actor. UI: confirmación y error/reintento visibles. |
| Recordatorios | Reserva antes de llamar al proveedor, rescate, límite de intentos, repetición secuencial, cierre por turno y evidencia tras cancelación durante el envío. [src/lib/__tests__/casos-uso-recordatorios.test.ts:1][s149], [src/lib/__tests__/turno-recordatorios.test.ts:1][s150]. | P1: cancelar después del claim y antes de llamar; reintentar fallido mientras se reprograma; provider aceptó pero respuesta/persistencia falla. Los dos primeros sustentan H09; el último necesita una política explícita de conciliación. |
| Consentimiento | Generación de texto y versión vigente; predicado revocado/ausente; aislamiento al crear sesión clínica con consentimiento ajeno. [src/lib/__tests__/consentimiento.test.ts:1][s151], [src/lib/__tests__/multi-tenant.test.ts:513][s152]. | P1: handlers de firma y revocación, versión vieja frente a texto actual, dos firmas concurrentes, firma frente a revocación, rechazo de grabación tras revocar. La firma sobre canvas no se prueba como interacción real. |
| Auditoría | detalleSeguro, hashing, llamadas esperadas de algunos casos de uso; login/password prueban persistencia específica. [src/lib/__tests__/sesion-clinica.test.ts:1][s145], [src/lib/__tests__/login-atomico.test.ts:1][s153]. | P1: persistencia real de eventos clínicos ante fallos, acciones de cobro/consentimiento y paridad de lecturas. Los stubs que acumulan eventos no prueban el comportamiento de registrarAuditoria cuando la DB falla. |
| Contexto longitudinal | Formato, creación/merge, incremento secuencial de versión, actor, integración ordenada y métrica limitada. [src/lib/__tests__/contexto-clinico.test.ts:1][s154], [src/lib/__tests__/casos-uso-worker.test.ts:469][s155]. | P1: primeras 20/200 integradas y posteriores pendientes; medianoche sin corte fijo; escrituras desde igual versión; worker frente a edición humana; reinicio y agotamiento de backoff. El test de tope verifica cantidad/saturación en pendientes, no avance después de una ventana totalmente integrada. |
| Worker y proveedores | ASR/LLM, JSON, límites, cifrado, callback HTTP y pasos del procesador con dobles. [processor/tests/test_app_client.py:1][s156], [processor/tests/test_processor.py:1][s157]. | P1: loop y contexto_worker no tienen pruebas propias; speech_analytics.compute se sustituye por un mock en los tests del procesador. Faltan cierre/reinicio con trabajo pendiente, correlación de intento y contrato completo de resultados. No hay evidencia de prueba contra proveedores reales en estos tests. |
| UI crítica | Helpers de subida, cronómetro, micrófono, storage y operaciones HTTP; varios con buenos casos de fallo. [src/lib/__tests__/grabacion-storage.test.ts:1][s158], [src/lib/__tests__/grabacion-subida.test.ts:24][s56]. | P0/P1: recuperación tras recarga H04; permisos/micrófono, pausa y confirmación de upload; consentimiento y aprobación con revisión de riesgo; cobro/deshacer; alta parcial H12, botón de Hoy H13 y autosave H14. |
| Controles de arquitectura | Test que recorre el grafo Edge; CI de tipos/build/lint y tests TS/Python. [src/lib/__tests__/middleware-edge.test.ts:20][s159]. | P1: selección incorrecta de suites H11. P2: contratos de dependencia entre UI/API y métrica de complejidad por función si se decide convertirla en control, con excepciones justificadas. |

Orden para ampliar las pruebas: **P0** audio y callbacks que podrían destruir o reemplazar contenido; **P1** cobro, recordatorios, consentimiento, auditoría y contexto; **P2** controles de mantenimiento. No hace falta perseguir un porcentaje global ni duplicar la implementación en assertions: cada caso debe expresar la consecuencia que hay que impedir.

## Acoplamiento, duplicación y filosofía

El grafo de imports locales encontró **cero ciclos de ejecución** y dos ciclos que incluyen una arista exclusivamente de tipos: domain.ts → sesion-clinica/normalizar.ts → domain.ts, y agenda-header.tsx → agenda-view.tsx → agenda-header.tsx. Las referencias son [src/lib/sesion-clinica/normalizar.ts:8][s160] y [src/app/(dashboard)/agenda/_components/agenda-header.tsx:11][s161]. La segunda relación indica que el tipo de modo pertenece a la agenda compartida, no necesariamente al componente que la renderiza. No corresponde informar esos ciclos como inicialización circular en producción.

Deuda y fechas cuentan con fuentes compartidas y tests; no se encontró fundamento para proponer otro motor de deuda o formateador genérico. Sin embargo, esDeudaPendiente no fue adoptada por todos los consumidores: H22 conserva la repetición de la regla realizado + pago pendiente. En los formularios se duplican duraciones y validaciones, además de opciones/etiquetas de pago y saneamiento de telemetría. [src/components/ui/session-row.tsx:47][s184] muestra Pagado/Pendiente donde [src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx:126][s185] dice Cobrado/Sin cobrar: es una inconsistencia observable del vocabulario de la interfaz. En TS y Python necesariamente hay fronteras de validación distintas: antes que generar un framework de schemas, conviene comprobar ejemplos de contrato que atraviesen ambos lenguajes.

Hay decisiones prudentes que deben conservarse: pagos inline para el alcance actual, casos de uso con dependencias concretas e inyectables, maps de transiciones y orientación con variantes reales, cliente único hacia la app y cripto fuera de la UI. No hace falta agregar repositorios abstractos por tabla, una jerarquía de proveedores ni otra infraestructura de colas sin justificar primero el problema.

La configuración manual de los 11 tests de integración ya falló al incorporar dos archivos: H11 es una señal concreta a favor de una convención verificable. La compatibilidad sin importadores, LLM_BACKEND con una sola implementación y slots vacíos son el caso opuesto: abstracción que puede retirarse. Dos orientaciones reales —CBT/MI y Gestalt— sí justifican variación; no se cuestiona ese diseño por tener más de una rama.

En nomenclatura, data o estado dentro de un bloque pequeño y tipado no son por sí solos defectos. La prioridad es corregir identidades ambiguas como sesionClinicaId que contiene turnoId, y los nombres similares de normalizadores con distintas garantías. El vocabulario español/inglés mezclado dentro del formulario es deuda menor; no justifica un cambio masivo de nombres en producción.

Además de la ubicación de los tipos, [src/app/api/_lib/domain.ts:75][s187] convierte la fila de Prisma a Turno mediante un doble cast: estado, pagoMetodo y duracion no reciben validación en esa frontera, aunque el contrato destino sea más estrecho. No demuestra un dato inválido actual; sí limita lo que TypeScript strict garantiza si una migración o una escritura futura introduce uno. Conviene distinguir el dato crudo de la forma validada y probar el rechazo o tratamiento explícito de valores inesperados.

Los handlers de alta/edición de turnos todavía coordinan lock, transacción, solapamiento y recordatorios ([src/app/api/turnos/\[id\]/route.ts:73][s188]). Extraer esa coordinación tiene sentido al resolver H08; la regla pura de solapamiento ya está separada. En grabación hay fetch directos y manejo del sobre HTTP coexistiendo con api-client: revisar su semántica después de retirar las acciones muertas, preservando abort, progreso y los tres pasos de subida. Cambiar todos los fetch mecánicamente no resolvería H04.

## Consistencia con AGENTS.md

| Regla escrita | Evidencia en la base auditada | Veredicto |
| --- | --- | --- |
| No importar built-ins Node, ni estáticos ni dinámicos, desde la cadena middleware/proxy. [AGENTS.md:9][s162]. | Se recorrieron los 10 archivos locales alcanzables desde middleware: middleware, auth, password, login-eventos, crypto, db-auth, intentos-serializados, login-intentos, request-huella y csp. No aparecen imports de built-ins Node en esa cadena; crypto usa Web Crypto. Existe el guardián en tests y la CI del SHA está verde. | Cumple en el código propio revisado. No se inspeccionó el interior de paquetes de node_modules; el propio test documenta esa limitación. |
| Leer documentación local relevante de Next antes de escribir código. [AGENTS.md:4][s163]. | Es una obligación de proceso; esta auditoría no modifica código de Next. Los handlers consultados usan params asíncronos y hay build exitoso. | No se puede inferir del código si cada autor leyó la guía. No se inventa un incumplimiento. |
| CSP en Report-Only hasta completar la observación indicada. [AGENTS.md:28][s164]. | La cabecera permanece Report-Only; los layouts auth/dashboard declaran force-dynamic. La política mínima de frame-ancestors sigue separada. | Coherente con la regla. Mantener Report-Only no es un hallazgo por sí mismo. |
| Cuatro semanas de uso, cero violaciones propias inline en últimas dos, grabación completa y revisión tras deploy de Next antes de enforce. [AGENTS.md:75][s165]. | Son condiciones operativas; no se consultaron logs de producción ni evidencia de esas fechas. | No verificable en esta auditoría. No autoriza a activar enforce. |

AGENTS.md no define una prohibición general de Prisma en Server Components ni exige una arquitectura de repositorios. Las observaciones de capas de este informe son diagnóstico frente al alcance pedido, no reglas atribuidas al archivo.

## Dónde vive el dato sensible y quién lo necesita

| Dato | Persistencia y circulación visibles | Acceso necesario / exceso observado |
| --- | --- | --- |
| Identidad y contacto del paciente | Postgres: nombre, apellido, teléfono, email y notas generales en [prisma/schema.prisma:88][s166]; turno/notas/pago en [prisma/schema.prisma:116][s167]. Llegan a UI autenticada según sus endpoints. | Agenda/cobros requieren identidad y datos operativos. El cron SMS incluye el paciente completo, incluidas notas no necesarias, H19. No se consultaron registros reales. |
| Consentimiento y firma | Postgres conserva texto completo, firma base64, versión, fecha e IP en [prisma/schema.prisma:169][s168]; no tienen cifrado de aplicación. El GET corriente devuelve una proyección sin firma/texto íntegro. | El registro histórico requiere esos datos, pero la persistencia no guarda actor de firma/revocación en auditoría; el desajuste versión/texto es H10. |
| Audio local | RAM y chunks sin cifrar en IndexedDB; se cifra al terminar en [src/components/grabacion/GrabadorSesion.tsx:481][s169]. | El respaldo es útil para recuperación, pero su acceso/retención no están ligados a cuenta/organización ni a un plazo, H18. |
| Audio remoto y clave temporal | R2 almacena el audio cifrado. La clave/IV temporal vive dentro de datosEstructurados cifrado, [src/app/api/_lib/sesion-clinica.ts:85][s170]. El worker recibe key/clave/IV al reclamar. Al aprobar se intenta borrar el objeto y se quita la clave temporal. | La UI de subida necesita su material temporal; las lecturas ordinarias no lo devuelven. H01/H02 afectan correspondencia y ciclo de borrado. La reserva de claim no acota por sí sola el permiso global del worker. |
| Audio en procesamiento | [processor/processor.py:92][s171] descarga y descifra en memoria; el ASR recibe el audio en claro por su API. El adaptador intenta borrar el transcript remoto al terminar. | Ese procesamiento necesita el audio. No se encontró escritura intencional de audio en claro a disco en el worker revisado; no se verificó retención efectiva en proveedor. |
| Transcripción, SOAP, nota original, ediciones y datos derivados | Columnas cifradas de SesionClinica, extensión Prisma y helpers explícitos de escritura. El worker/LLM los procesan; las respuestas de sesión excluyen transcripción y stash temporal, comprobado en [src/lib/__tests__/sesion-clinica-response.test.ts:1][s172]. | La capa de aplicación puede descifrar al seleccionarlos. Es una fortaleza de proyección, no aislamiento criptográfico entre módulos que comparten la clave maestra. Auditar algunas rutas y otras no deja H15. |
| Contexto longitudinal | Hipótesis, resumen y riesgos cifrados; objetivos, intervenciones y temas en JSON en claro. LLM recibe contexto incluso pendiente de revisión, etiquetado como tal. | H20 cuestiona clasificar contenido por longitud y una consulta futura. H07 cuestiona pérdida de la revisión humana y conflictos; H19 el permiso global M2M. |
| Recordatorio | Twilio recibe teléfono y texto; texto exacto enviado queda en Postgres. [prisma/schema.prisma:147][s173]. | Útil para reconstruir un aviso; requiere política de acceso/retención al contener nombre y vínculo con una consulta. Mantener evidencia de cancelaciones concurrentes es correcto. |
| Eventos y telemetría | eventos_auditoria guarda actor/acción/ids/detalle acotado; Sentry elimina cuerpo/cookies y aplica saneamiento en [instrumentation.ts:32][s174] y [instrumentation-client.ts:37][s175]. | detalleSeguro es una protección útil, pero no corrige eventos ausentes. La limpieza de telemetría está duplicada; truncar una frase no prueba que no contenga dato clínico. No se verificaron eventos reales enviados. |
| Copias de respaldo | [.github/workflows/backup.yml:102][s176] exporta Postgres, cifra el dump con GPG y programa retención de 30 días. Comprueba existencia/tamaño del objeto. | Un backup anterior a aprobar puede conservar la columna cifrada que contenía la clave temporal. La afirmación de destrucción de clave aplica a la fila activa; su alcance sobre backups y un blob cuyo borrado falló necesita precisarse. No se ejecutó restore ni se inspeccionó contenido de backups. |

Estas observaciones describen minimización y ciclo de vida. No equivalen a una auditoría de seguridad completa, una certificación legal ni evidencia de una filtración.

## Decisiones de contrato que merecen revisión explícita

El contrato de riesgo en [docs/contrato-riesgo-clinico.md:43][s177] decide que ausente o inválido equivale a ninguno. [src/lib/sesion-clinica/schema.ts:136][s178] y [src/lib/sesion-clinica/normalizar.ts:70][s179] lo implementan, con tests que lo esperan. Por tanto, **no es una infracción del contrato actual**. La consecuencia de calidad del dato es que una evaluación ausente/descartada no se distingue de una evaluación válida sin señales; la confirmación adicional al aprobar solo se exige para moderado/alto. Conviene decidir cómo comunicar evaluación no disponible y medir fallos antes de cambiar esa semántica. Este informe no propone nuevas reglas clínicas.

La auditoría best-effort también es deliberada: protege disponibilidad al fallar el registro. H15 pide una recuperación observable y cobertura coherente, no convertir cada error de logging en una caída de la aplicación. El tope del asistente de ayuda es explícitamente orientativo y permite una pequeña carrera de conteo; para la usuaria única documentada no se prioriza una nueva infraestructura de cuotas.

## Relación con el informe que ya existía en la rama

Al preparar la entrega, auditoria-arquitectura ya contenía [una auditoría previa en 5c52425](https://github.com/BrunoGandolfo/sesion/blob/5c524251a35d5e2700c803b2373fbf94b37144b4/docs/auditoria/00-arquitectura-y-calidad.md), sobre la misma base. Se leyó y contrastó con el código; esta revisión se entrega como commit posterior y conserva aquella versión en el historial.

Se retienen y precisan sus observaciones verificadas: deuda duplicada, vocabulario y formularios divergentes, handlers con coordinación de negocio, cast de toTurno, contrato Python/TS sin prueba cruzada, cobertura incompleta de deudas/consentimiento/lecturas y módulos huérfanos. Se añaden las intercalaciones de audio, callbacks, cobro, mensajes y contexto que modifican la prioridad general.

Se corrigieron clasificaciones que el código no sostiene: el ciclo de normalizadores tiene una arista de tipos; Plegable en sesiones tiene dos importadores; topTemas, indicesConEtiqueta, MAX_MARCADORES, FICHAS, SIN_PENDIENTES y los schemas de email/teléfono/tarifa tienen usos internos. No deben borrarse sus implementaciones por falta de importadores externos. La ausencia de tests propios de speech_analytics y los dos archivos de integración omitidos también se verificaron. El nuevo ranking explica su propia métrica parcial y no reutiliza las cifras previas como si fueran una ejecución de ESLint.

## Entrega y límites de la conclusión

Este diagnóstico permite abrir trabajos acotados con criterio de aceptación. No demuestra frecuencia de los fallos ni sustituye las pruebas de regresión que deben acompañar cada corrección. La revisión operativa pendiente se limita a confirmar consumidores externos de hot words, configuración del corte de contexto, permisos efectivos de datos/audio, ciclo real de backups y condiciones de CSP. Ninguna de esas verificaciones justifica modificar la app durante esta auditoría.

[s1]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/sesion-clinica/%5Bid%5D/route.ts#L31
[s2]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/sesion-clinica/%5Bid%5D/route.ts#L181
[s3]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/reintentar-sesion.ts#L98
[s4]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/r2.ts#L158
[s5]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/aprobar-sesion.ts#L104
[s6]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/aprobar-sesion.ts#L117
[s7]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/eliminar-sesion.ts#L209
[s8]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/procesar-callback.ts#L96
[s9]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/procesar-callback.ts#L127
[s10]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/reclamar-pendientes.ts#L109
[s11]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/grabar/%5BturnoId%5D/_components/grabar-view.tsx#L110
[s12]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/grabar/%5BturnoId%5D/_components/grabar-view.tsx#L120
[s13]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/grabar/%5BturnoId%5D/_components/grabar-view.tsx#L255
[s14]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/grabar/%5BturnoId%5D/_components/grabar-view.tsx#L382
[s15]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts#L59
[s16]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts#L107
[s17]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts#L192
[s18]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/sesiones-sin-contexto.ts#L276
[s19]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/sesion-clinica/%5Bid%5D/route.ts#L137
[s20]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/sesion-clinica/%5Bid%5D/route.ts#L153
[s21]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/sesion-clinica/%5Bid%5D/route.ts#L182
[s22]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/contexto-clinico/actualizar.ts#L44
[s23]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/contexto-clinico/actualizar.ts#L47
[s24]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/contexto-clinico/actualizar.ts#L78
[s25]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/contexto_worker.py#L81
[s26]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/cobrar-turno.ts#L94
[s27]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/cobrar-turno.ts#L104
[s28]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/cobrar-turno.ts#L170
[s29]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/turnos/%5Bid%5D/route.ts#L88
[s30]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/turnos/%5Bid%5D/route.ts#L150
[s31]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/enviar-recordatorios.ts#L178
[s32]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/enviar-recordatorios.ts#L318
[s33]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/recordatorios/%5Bid%5D/reintentar/route.ts#L74
[s34]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/recordatorios-del-turno.ts#L91
[s35]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/pacientes/%5Bid%5D/consentimiento/route.ts#L32
[s36]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/pacientes/%5Bid%5D/consentimiento/route.ts#L132
[s37]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/pacientes/%5Bid%5D/consentimiento/route.ts#L156
[s38]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/vitest.config.ts#L18
[s39]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/vitest.config.ts#L48
[s40]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/config-contrato.test.ts#L115
[s41]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/solapamiento-turnos.test.ts#L276
[s42]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx#L309
[s43]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx#L346
[s44]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx#L361
[s45]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/_components/sheet-nuevo-turno.tsx#L32
[s46]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/forms/nuevo-turno-form.tsx#L330
[s47]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/forms/nuevo-turno-form.tsx#L348
[s48]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/config/_components/config-view.tsx#L189
[s49]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/config/_components/config-view.tsx#L277
[s50]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/auditoria.ts#L25
[s51]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/auditoria.ts#L44
[s52]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/turnos/%5Bid%5D/cobrar/route.ts#L20
[s53]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/pacientes/%5Bid%5D/consentimiento/route.ts#L101
[s54]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/sesion-clinica/route.ts#L17
[s55]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/vitest.config.ts#L42
[s56]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/grabacion-subida.test.ts#L24
[s57]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/deshacer-cobro.test.ts#L17
[s58]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/contexto_worker.py#L38
[s59]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/contexto_worker.py#L57
[s60]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/sesion-clinica/aprobadas-sin-contexto/route.ts#L24
[s61]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/worker.py#L82
[s62]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/GrabadorSesion.tsx#L649
[s63]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/grabacion-storage.ts#L22
[s64]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/grabacion-storage.ts#L229
[s65]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/layout/sidebar.tsx#L132
[s66]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/enviar-recordatorios.ts#L185
[s67]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/pacientes/%5Bid%5D/contexto-clinico/route.ts#L34
[s68]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prisma/schema.prisma#L313
[s69]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prisma/schema.prisma#L322
[s70]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prisma/schema.prisma#L325
[s71]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prisma/schema.prisma#L328
[s72]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/pacientes/%5Bid%5D/_components/turnos-pagos-tab.tsx#L85
[s73]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/_components/datos.ts#L8
[s74]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/hooks/useGrabacionSesion.ts#L6
[s75]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/types/domain.ts#L384
[s76]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/forms/nuevo-turno-form.tsx#L13
[s77]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx#L35
[s78]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/schemas.ts#L5
[s79]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/pacientes/%5Bid%5D/_components/turnos-pagos-tab.tsx#L57
[s80]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/instrumentation.ts#L14
[s81]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/instrumentation-client.ts#L19
[s82]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/GrabadorSesion.tsx#L157
[s83]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/config/_components/config-view.tsx#L153
[s84]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/schemas_llm.py#L490
[s85]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/HotWordsManager.tsx#L125
[s86]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/hooks/useGrabacionSesion.ts#L335
[s87]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/prompts.ts#L1
[s88]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/callback.py#L1
[s89]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/config.py#L46
[s90]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/clinical_analyzer.py#L210
[s91]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/pacientes/%5Bid%5D/_components/progreso-lecturas.ts#L267
[s92]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/grabacion-storage.ts#L15
[s93]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/grabacion-storage.ts#L47
[s94]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/forms/nuevo-turno-form.tsx#L51
[s95]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/forms/nuevo-turno-form.tsx#L59
[s96]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/sesion-clinica-utils.ts#L256
[s97]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/asr_assemblyai.py#L184
[s98]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/clinical_analyzer.py#L125
[s99]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/hooks/useGrabacionSesion.ts#L250
[s100]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/nuevo-turno-form.tsx#L108
[s101]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/prisma-encryption.ts#L220
[s102]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/pacientes/%5Bid%5D/_components/progreso-lecturas.ts#L55
[s103]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/worker.py#L115
[s104]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx#L144
[s105]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/FirmaCanvas.tsx#L42
[s106]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/app_client.py#L116
[s107]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/agenda-view.tsx#L119
[s108]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/brief-corto.tsx#L1
[s109]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/pacientes/%5Bid%5D/_components/api-ficha.ts#L1
[s110]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/NotaClinicaView.tsx#L1
[s111]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/SesionHuerfanaBanner.tsx#L1
[s112]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/domain.ts#L127
[s113]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/login-eventos.ts#L231
[s114]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/recordatorios-sms.ts#L19
[s115]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/sesion-clinica-utils.ts#L201
[s116]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/pacientes/%5Bid%5D/_components/progreso-lecturas.ts#L271
[s117]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/schemas.ts#L89
[s118]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/types/domain.ts#L468
[s119]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/types/domain.ts#L474
[s120]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/types/domain.ts#L483
[s121]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/types/domain.ts#L492
[s122]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/types/domain.ts#L499
[s123]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/types/domain.ts#L511
[s124]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/forms/nuevo-turno-form.tsx#L43
[s125]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/grabar/%5BturnoId%5D/page.tsx#L56
[s126]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/sesion-clinica/%5Bid%5D/upload-confirmar/route.ts#L80
[s127]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/audio.ts#L26
[s128]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/r2.ts#L163
[s129]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/casos-uso-sesion.test.ts#L1053
[s130]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/GrabadorSesion.tsx#L1015
[s131]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/grabacion-storage.ts#L258
[s132]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/GrabadorSesion.tsx#L817
[s133]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/salud.ts#L281
[s134]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/contexto-clinico/formato-llm.ts#L37
[s135]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/casos-uso/enviar-recordatorios.ts#L339
[s136]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/eslint.config.mjs#L5
[s137]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/hot-words/route.ts#L1
[s138]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/hot-words/%5Bid%5D/route.ts#L1
[s139]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/hot-words/paciente/%5BpacienteId%5D/route.ts#L1
[s140]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prompts/README.md#L1
[s141]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prompts/clinical_note_v1.0.md#L1
[s142]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prompts/clinical_note_v2.0.md#L1
[s143]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prompts/clinical_note_v2.1.md#L1
[s144]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/deuda.test.ts#L1
[s145]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/sesion-clinica.test.ts#L1
[s146]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/casos-uso-sesion.test.ts#L161
[s147]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/casos-uso-worker.test.ts#L1
[s148]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/cobrar-turno.test.ts#L1
[s149]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/casos-uso-recordatorios.test.ts#L1
[s150]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/turno-recordatorios.test.ts#L1
[s151]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/consentimiento.test.ts#L1
[s152]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/multi-tenant.test.ts#L513
[s153]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/login-atomico.test.ts#L1
[s154]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/contexto-clinico.test.ts#L1
[s155]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/casos-uso-worker.test.ts#L469
[s156]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/tests/test_app_client.py#L1
[s157]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/tests/test_processor.py#L1
[s158]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/grabacion-storage.test.ts#L1
[s159]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/middleware-edge.test.ts#L20
[s160]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/sesion-clinica/normalizar.ts#L8
[s161]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/agenda-header.tsx#L11
[s162]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/AGENTS.md#L9
[s163]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/AGENTS.md#L4
[s164]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/AGENTS.md#L28
[s165]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/AGENTS.md#L75
[s166]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prisma/schema.prisma#L88
[s167]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prisma/schema.prisma#L116
[s168]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prisma/schema.prisma#L169
[s169]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/grabacion/GrabadorSesion.tsx#L481
[s170]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/sesion-clinica.ts#L85
[s171]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/processor/processor.py#L92
[s172]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/__tests__/sesion-clinica-response.test.ts#L1
[s173]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/prisma/schema.prisma#L147
[s174]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/instrumentation.ts#L32
[s175]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/instrumentation-client.ts#L37
[s176]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/.github/workflows/backup.yml#L102
[s177]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/docs/contrato-riesgo-clinico.md#L43
[s178]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/sesion-clinica/schema.ts#L136
[s179]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/sesion-clinica/normalizar.ts#L70
[s180]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/domain.ts#L183
[s181]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/domain.ts#L55
[s182]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/_components/datos.ts#L128
[s183]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/pacientes/%5Bid%5D/_components/turnos-pagos-tab.tsx#L149
[s184]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/components/ui/session-row.tsx#L47
[s185]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx#L126
[s186]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/lib/deudas.ts#L13
[s187]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/_lib/domain.ts#L75
[s188]: https://github.com/BrunoGandolfo/sesion/blob/7024dcda8f504e38e76c96339ec32f30b5de33dc/src/app/api/turnos/%5Bid%5D/route.ts#L73
