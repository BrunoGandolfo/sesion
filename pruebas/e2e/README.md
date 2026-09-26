# Recorrido de Sesión

El recorrido usa la app y la base reales. No fabrica respuestas de API ni sustituye el guardado de formularios. Una API caída, una respuesta de error o una relectura que no encuentre lo guardado hacen fallar el comando.

## Ejecutar

Desde la raíz, con Node 22 y E2E_USUARIO / E2E_PASSWORD ya definidas en el entorno:

    npm run e2e -- --url=https://sesionapp.app

Preparación una sola vez: npm ci y npx playwright install --with-deps chromium. La instalación no cuenta dentro del tiempo del recorrido. Solo Node, Playwright y aserciones estándar.

Usá variables del terminal o el almacén de secretos del agente/CI. No guardes credenciales en archivos .env, scripts, cookies, storageState o trazas. El programa no genera esos archivos; oculta campos en la captura de fallo y redacta las credenciales en mensajes. La captura puede mostrar otros datos de la cuenta: usá exclusivamente datos inventados.

La URL debe ser el origen de una rama desplegada o de un servidor local. El recorrido no compila ni publica la app ni importa módulos de src/. Si una rama cambia contratos o nombres accesibles, el recorrido debe adaptarse: no aprende una interfaz distinta.

Requiere una cuenta exclusiva de prueba, con una nota aprobada que tenga Para vos. La busca entre los 40 pacientes activos más recientes y las diez notas más recientes de cada uno, sin IDs ni nombres fijos. Si no existe, falla: no omite esa pantalla. No ejecutar dos recorridos a la vez ni usar la cuenta durante la prueba.

## Qué recorre

- Chromium a 1280 × 900 y 390 × 844, zona horaria de Montevideo. En alta, agenda, edición y Lupita también reduce el alto a 500 para comprobar que se alcanza el botón.
- Entrada, recuperación sin envío de correo, invitación y restablecimiento sin token, términos; ingreso real una vez.
- Hoy; Agenda día/semana/mes de escritorio y día/mes móvil; navegación de fechas, alta y detalle del turno; abrir reprogramación sin guardar.
- Pacientes, búsqueda vacía y archivados; alta con validaciones; ficha, Sesiones, Recorrido, datos y pagos; edición; nota aprobada y Para vos.
- Cobros, historial del mes y redirecciones anteriores; Tu consultorio, vocabulario, validación de contraseña sin enviarla, editor y vista previa del recordatorio.
- Tres consultas reales a Lupita. Comprueba respuesta no vacía y ausencia de error, sin juzgar su calidad.
- Cobrar y deshacer desde la interfaz en ambos tamaños, verificando pago, importe, método y fecha mediante lecturas del servidor.

## Persistencia y limpieza

Cada tamaño crea desde la interfaz un paciente propio con apellido E2E-<ejecución>-<ancho> y la marca también en Notas. Usa un teléfono ficticio del rango 555. Guarda, relee, edita y vuelve a releer el paciente real.

Agenda desde la interfaz un turno tres días atrás, en un hueco libre, con la misma marca. Verifica que quedó guardado y que la lista real de /api/sms/envios del turno está vacía. No crea turnos futuros ni envía SMS. Marca ese turno propio como realizado por API para preparar el cobro; luego cobra y deshace mediante los botones reales. No modifica pagos de pacientes preexistentes.

El editor de recordatorio guarda una plantilla temporal real. Se relee desde el servidor, se repone el texto original por API y se verifica la restauración exacta. Si el contenido cambió por fuera del recorrido, falla sin pisar ese cambio.

Al terminar cada tamaño, cancela los turnos propios y archiva el paciente por API. Relee para comprobar paciente inactivo, turnos cancelados y ningún pago conservado. La limpieza vuelve a intentarse en errores, timeout, SIGINT o SIGTERM; si un alta perdió su respuesta, busca únicamente su marca exacta. Una limpieza no confirmada hace fallar el comando y deja los IDs disponibles en el resultado.

Esta versión no ofrece borrado físico de pacientes/turnos: quedan los pacientes E2E archivados, sus turnos cancelados y el historial de auditoría. Se restituye la configuración y se dejan los datos previos y los saldos como estaban; no se pretende una base idéntica byte por byte. Login, lecturas de documentación y cobros pueden agregar auditorías. Una caída de red, SIGKILL o apagado durante la limpieza puede requerir revisión manual.

El permiso de escritura es específico para cada paso y deja pasar la petición al servidor. Cualquier otra escritura desde la página se bloquea y hace fallar la prueba. Las lecturas auxiliares y la preparación/limpieza también usan la API real autenticada. No se cambia contraseña, no se manda correo y no se inicia una grabación.

## Qué hace fallar el comando

Página no disponible, control requerido ausente o imposible de pulsar, excepción de JavaScript, API con error, alerta inesperada, formulario que no termina o contenido que no persiste. También desborde horizontal de página, controles fuera del ancho disponible y contenido recortado dentro de botones.

Los avisos de enlace vencido se permiten por texto exacto. En la ficha y la nota se admite el aviso clínico que empieza con Señal de riesgo; un segundo aviso de error sigue fallando. Las pruebas del detector comprueban esa distinción.

Cada ejecución hace un único intento de ingreso y sale con su resultado, sin reintentos automáticos. El mensaje genérico de acceso de la app también puede indicar indisponibilidad de la base; por sí solo no demuestra una contraseña incorrecta.

El recorrido dispone de 240 segundos y reserva hasta el límite total de 290 segundos para limpiar. Cualquier fallo devuelve código de salida distinto de cero.

## Base local de main y pendientes de Ola 2

Esta rama parte de origin/main e247d8b. El recorrido usa el ingreso POST /api/cuenta/entrar y los contratos de esa base.

Para prepararla, usá un Postgres propio con dos bases distintas: sesion_e2e_main para la app y sesion_test para integración. En .env, DATABASE_URL debe apuntar a la primera, con host loopback. Usá la clave de cifrado local documentada por prisma/seed.ts; nunca una clave de producción. Cargá ANTHROPIC_API_KEY en el entorno local del servidor para las tres consultas reales a Lupita. No hacen falta credenciales de SMS, correo, R2 ni worker.

    npx prisma migrate deploy
    node --env-file=.env prisma/seed.ts
    node --env-file=.env pruebas/e2e/sembrar-local.mjs
    npm run dev -- --port 3131

El complemento sembrar-local agrega una nota aprobada, Para vos y una transcripción corta de contenido ficticio para el primer turno del seed. Solo acepta una base cuyo nombre empiece por sesion_e2e_, en loopback, con la clave local del seed. No ejecuta IA, worker ni grabación. Es una fila persistida en Postgres, leída por las rutas reales; no una respuesta de API sustituida.

Con E2E_USUARIO y E2E_PASSWORD definidos en el terminal con la cuenta de prisma/seed.ts:

    npm run e2e -- --url=http://localhost:3131 --pendientes-ola-2

El flag es temporal y explícito. Solo permite HTTP 404 de las dos rutas retiradas /api/pacientes/[id]/brief y /api/pacientes/[id]/contexto-clinico. En la pestaña Recorrido exige ese 404 y el mensaje de error conocido; otra alerta, un HTTP 500 o una API distinta siguen haciendo fallar el recorrido. Enumera esas respuestas en esperados, y marca grabación/subida como no ejecutadas. Sin el flag rige el modo estricto.

Los otros cambios de esta rama corrigen presentación/cableado: el alta ya no ofrece un email que no se guarda; el detalle lee SMS durables y no ofrece el reintento retirado; Cobros deja de consultar la ruta eliminada /api/sms/estado y confirma programación, sin inventar un envío. Si el aviso ya se pidió ese día, lo informa y no promete otro.

## Evidencia de esta rama

Validado el **15/09/2026**, contra localhost:3131 con Postgres exclusivo pg-sesion-e2e-main. **Verde en 95,06 s**, con 61 controles en 1280 y 390 y las tres consultas reales a Lupita. No se ejecutó esta rama contra producción. Se verificó la persistencia de alta, edición, agenda, configuración, cobro y deshacer. Los dos pacientes quedaron archivados, los turnos cancelados sin pagos y la configuración restaurada.

Los 404 de brief y contexto-clinico quedan enumerados como esperados de Ola 2. Grabación y subida no se ejecutan; tampoco SMS ni correos. La pasada previa terminó en 74,65 s con salida 1 ante Lupita HTTP 503 por clave local ausente: el detector no transformó la indisponibilidad en verde. Al configurar la clave temporal, el mismo recorrido pasó sin sustituir respuestas.

Pasaron tsc, lint (0 errores; 1 advertencia preexistente en config-view), 1311 pruebas unitarias, 316 de integración y el detector de presentación. Los primeros fallos fueron contratos anteriores del recorrido (ingreso Auth.js y respuesta de alta de turno), los 404 esperados de Ola 2 y Lupita HTTP 503 por falta de configuración local. La primera revisión automática encontró dos P2 ya corregidos y cubiertos: confirmar un SMS duplicado como si fuera nuevo y elegir el día UTC después de las 21 h en Montevideo. La segunda ejecución de codex review --uncommitted terminó sin hallazgos accionables; verificó además las 26 pruebas de componente afectadas.

pruebas/e2e/resultados/resultado.json contiene pasos, ancho, duración, error, pacientes de prueba y confirmaciones de restauración. En fallos también genera fallo.png con campos ocultos; esa imagen corresponde al último fallo, no necesariamente a la última ejecución. La carpeta está ignorada por Git. El resultado se reemplaza en cada ejecución; guardá una copia si necesitás conservarla.

Para comprobar el detector aislado:

    node --test pruebas/e2e/comprobaciones.node.mjs

Ese test usa HTML mínimo para probar las aserciones de desborde y alertas; no interviene en la navegación de la app ni reemplaza respuestas del recorrido.

## Qué NO cubre

- Grabación, micrófono, audio, cifrado, R2, worker, transcripción, aprobación/edición de notas, recuperación y funcionamiento sin conexión.
- SMS, correos, invitaciones o restablecimientos con token vigente y cambios de contraseña.
- Alta de series recurrentes, reprogramación, edición de Recorrido, archivo/reactivación mediante sus botones y eliminación de sesiones. Archivo/cancelación por API sí se verifican como limpieza.
- Estados ausentes en la cuenta: sesiones fallidas, listas totalmente vacías, solapes y otros casos que este recorrido no prepara. La búsqueda sin resultados sí se prueba.
- Safari, Firefox, teléfonos físicos, teclado nativo, instalación PWA, pantalla bloqueada y gestos del sistema. 390 × 500 no equivale a un teclado real.
- Calidad clínica o exactitud de IA, ortografía general, contraste, comparación pixel a pixel ni toda superposición vertical. Ellipsis intencionales y grillas desplazables no se consideran automáticamente roturas.
- Concurrencia con otra persona, la disponibilidad futura del servicio ni atomicidad frente a una caída durante la limpieza. Verde certifica esta ejecución y los pasos listados, no que toda la aplicación funcione.

## Capturas para diseño

`capturas.spec.ts` saca capturas de pantalla a 390 × 844 y 1280 × 900 para el cierre de cada tarea de frontend (`.claude/skills/diseno-sesion/SKILL.md`). Hoy cubre solo `/login`, sin sesión; las pantallas con sesión se sumarán cuando haya una usuaria E2E para esto.

Con `npm run dev` levantado en el puerto 3000:

    CAPTURAS_URL=http://localhost:3000 npx vitest run pruebas/e2e/capturas.spec.ts

Deja `login-390.png` y `login-1280.png` en `pruebas/e2e/resultados/capturas/`, una carpeta que Git ignora. Usa vitest y la librería `playwright` que ya están en el repo, con Chromium instalado como en el recorrido. Si `CAPTURAS_URL` no está definida, el archivo se omite: `npm test` lo recolecta como cualquier `*.spec.ts` sin abrir un navegador. Contra `next dev`, la captura de 1280 puede incluir el indicador de desarrollo de Next abajo a la izquierda.
