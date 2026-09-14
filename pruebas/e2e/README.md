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
- Hoy; Agenda día/semana/mes de escritorio y día/mes móvil; navegación de fechas y formulario de agendar.
- Pacientes, búsqueda vacía y archivados; alta con validaciones; ficha, Sesiones, Recorrido, datos y pagos; edición; nota aprobada y Para vos.
- Cobros, historial del mes y redirecciones anteriores; Tu consultorio, vocabulario, validación de contraseña sin enviarla, editor y vista previa del recordatorio.
- Tres consultas reales a Lupita. Comprueba respuesta no vacía y ausencia de error, sin juzgar su calidad.
- Cobrar y deshacer desde la interfaz en ambos tamaños, verificando pago, importe, método y fecha mediante lecturas del servidor.

## Persistencia y limpieza

Cada tamaño crea desde la interfaz un paciente propio con apellido E2E-<ejecución>-<ancho> y la marca también en Notas. Usa un teléfono ficticio del rango 555 y un email con dominio .invalid. Guarda, relee, edita y vuelve a releer el paciente real.

Agenda desde la interfaz un turno tres días atrás, en un hueco libre, con la misma marca. Verifica que quedó guardado y que el servidor devolvió recordatorio: null. No crea turnos futuros ni envía SMS. Marca ese turno propio como realizado por API para preparar el cobro; luego cobra y deshace mediante los botones reales. No modifica pagos de pacientes preexistentes.

El editor de recordatorio guarda una plantilla temporal real. Se relee desde el servidor, se repone el texto original por API y se verifica la restauración exacta. Si el contenido cambió por fuera del recorrido, falla sin pisar ese cambio.

Al terminar cada tamaño, cancela los turnos propios y archiva el paciente por API. Relee para comprobar paciente inactivo, turnos cancelados y ningún pago conservado. La limpieza vuelve a intentarse en errores, timeout, SIGINT o SIGTERM; si un alta perdió su respuesta, busca únicamente su marca exacta. Una limpieza no confirmada hace fallar el comando y deja los IDs disponibles en el resultado.

Esta versión no ofrece borrado físico de pacientes/turnos: quedan los pacientes E2E archivados, sus turnos cancelados y el historial de auditoría. Se restituye la configuración y se dejan los datos previos y los saldos como estaban; no se pretende una base idéntica byte por byte. Login, lecturas de documentación y cobros pueden agregar auditorías. Una caída de red, SIGKILL o apagado durante la limpieza puede requerir revisión manual.

El permiso de escritura es específico para cada paso y deja pasar la petición al servidor. Cualquier otra escritura desde la página se bloquea y hace fallar la prueba. Las lecturas auxiliares y la preparación/limpieza también usan la API real autenticada. No se cambia contraseña, no se manda correo y no se inicia una grabación.

## Qué hace fallar el comando

Página no disponible, control requerido ausente o imposible de pulsar, excepción de JavaScript, API con error, alerta inesperada, formulario que no termina o contenido que no persiste. También desborde horizontal de página, controles fuera del ancho disponible y contenido recortado dentro de botones.

Los avisos de enlace vencido se permiten por texto exacto. En la ficha y la nota se admite el aviso clínico que empieza con Señal de riesgo; un segundo aviso de error sigue fallando. Las pruebas del detector comprueban esa distinción.

Cada ejecución hace un único intento de ingreso y sale con su resultado, sin reintentos automáticos. El mensaje genérico de acceso de la app también puede indicar indisponibilidad de la base; por sí solo no demuestra una contraseña incorrecta.

El recorrido dispone de 240 segundos y reserva hasta el límite total de 290 segundos para limpiar. Cualquier fallo devuelve código de salida distinto de cero.

## Evidencia

Validado el **14/09/2026**, con Chromium de Playwright 1.58.2. La ejecución final comenzó a las **16:38:15 de Uruguay** contra https://sesionapp.app, con ingreso real y sin respuestas sustituidas.

| Prueba | Resultado | Duración total | Salida |
| --- | --- | --- | --- |
| Recorrido completo real, 1280 y 390, 59 controles | Verde; alta, edición, agenda, configuración y cobros persistidos y releídos | **120,18 s** | 0 |
| Botón Entrar oculto temporalmente en el código local | Falla en Entrada / 1280 porque el botón no aparece; luego se restauró | **7,34 s** | 1 |
| SIGINT después de crear y releer un paciente real | Falla por interrupción; paciente archivado, sin errores de limpieza | **24,31 s** | 1 |

Una pasada completa anterior también dio verde en 121,97 s. La prueba negativa cambió temporalmente el botón de la copia local; el archivo quedó restaurado y no hay cambios en src/.

En la ejecución final se crearon E2E-mu1nb40m-1280 y E2E-mu1nb40m-390. Ambos quedaron archivados y sus turnos cancelados, sin pagos. Una lectura independiente confirmó **cero pacientes E2E activos**, la lista completa de pacientes activos igual a la lectura inicial y todos los campos de configuración iguales a sus valores originales. Se verificó también la limpieza de los intentos de validación anteriores.

Pasaron además npx tsc --noEmit, npm run lint y el test del detector. El aviso previo de acceso pendiente queda resuelto: la cuenta habitual permitió el ingreso; no se necesitó una nueva cuenta.

pruebas/e2e/resultados/resultado.json contiene pasos, ancho, duración, error, pacientes de prueba y confirmaciones de restauración. En fallos también genera fallo.png con campos ocultos; esa imagen corresponde al último fallo, no necesariamente a la última ejecución. La carpeta está ignorada por Git. El resultado se reemplaza en cada ejecución; guardá una copia si necesitás conservarla.

Para comprobar el detector aislado:

    node --test pruebas/e2e/comprobaciones.test.mjs

Ese test usa HTML mínimo para probar las aserciones de desborde y alertas; no interviene en la navegación de la app ni reemplaza respuestas del recorrido.

## Qué NO cubre

- Grabación, micrófono, audio, cifrado, R2, worker, transcripción, aprobación/edición de notas, recuperación y funcionamiento sin conexión.
- SMS, correos, invitaciones o restablecimientos con token vigente y cambios de contraseña.
- Alta de series recurrentes, reprogramación, edición de Recorrido, archivo/reactivación mediante sus botones y eliminación de sesiones. Archivo/cancelación por API sí se verifican como limpieza.
- Estados ausentes en la cuenta: sesiones fallidas, listas totalmente vacías, solapes y otros casos que este recorrido no prepara. La búsqueda sin resultados sí se prueba.
- Safari, Firefox, teléfonos físicos, teclado nativo, instalación PWA, pantalla bloqueada y gestos del sistema. 390 × 500 no equivale a un teclado real.
- Calidad clínica o exactitud de IA, ortografía general, contraste, comparación pixel a pixel ni toda superposición vertical. Ellipsis intencionales y grillas desplazables no se consideran automáticamente roturas.
- Concurrencia con otra persona, la disponibilidad futura del servicio ni atomicidad frente a una caída durante la limpieza. Verde certifica esta ejecución y los pasos listados, no que toda la aplicación funcione.
