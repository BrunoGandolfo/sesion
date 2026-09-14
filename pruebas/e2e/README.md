# Recorrido de Sesión

Estado al 14/09/2026: implementación en validación. **Todavía no hay una pasada completa en verde contra sesionapp.app**: las dos credenciales anteriores son rechazadas y se pidió la cuenta vigente. No usar esta rama como certificación mientras figure este aviso.

## Ejecutar

Desde la raíz del repositorio, con Node 22 y las variables E2E_USUARIO y E2E_PASSWORD ya definidas en el entorno:

    npm run e2e -- --url=https://sesionapp.app

Preparación una sola vez: npm ci y npx playwright install --with-deps chromium. La instalación no forma parte del tiempo del recorrido. No hay framework adicional: Node, Playwright y aserciones estándar.

Usá las variables del terminal o el almacén de secretos del agente/CI. No crees archivos .env, scripts con credenciales, cookies, storageState ni trazas con autenticación. El programa no los genera; oculta los campos en la captura de fallo y redacta las credenciales en los mensajes. No pegues secretos en la URL.

La URL es el origen de la rama ya desplegada o de un servidor local. El recorrido no compila ni publica la app y no importa módulos de src/. Se puede ejecutar desde esta carpeta de trabajo contra otra rama. Si una rama cambia los contratos o nombres accesibles, hay que adaptar el recorrido: no aprende automáticamente una interfaz diferente.

## Qué hace

- Chromium con 1280 × 900 y 390 × 844, zona horaria de Montevideo. En los formularios principales también reduce el alto a 500 para comprobar que el botón se puede alcanzar.
- Entrada, recuperación sin correo, invitación y restablecimiento sin token, términos; ingreso real una sola vez.
- Hoy; Agenda día/semana/mes de escritorio y día/mes móvil; navegación de fechas y formulario de agendar.
- Pacientes, búsqueda sin resultados, filtro de archivados, validaciones y finalización de alta; ficha, Sesiones, Recorrido, datos y pagos, edición, nota aprobada y Para vos.
- Cobros, historial del mes y redirecciones antiguas; Configuración, vocabulario, contraseña inválida sin enviarla, editor y vista previa del recordatorio.
- Tres preguntas reales a Lupita. Se comprueba respuesta no vacía y ausencia de error, sin juzgar su calidad.
- Cobrar y deshacer desde la interfaz en ambos tamaños. Elige un turno ya realizado para que cobrar no cambie su estado. Verifica estado, importe, método y fecha de pago antes y después.

Las altas de paciente y turno, la edición y el guardado del recordatorio se completan con una respuesta interceptada de Playwright. Se comprueba que el formulario valide, envíe la petición y cierre o confirme; **no se guarda ese contenido en el servidor**. El resto de las lecturas y los cobros son reales.

Requiere una cuenta exclusiva de prueba con pacientes inventados, una nota aprobada con Para vos y al menos un turno realizado sin cobrar, importe positivo y método/fecha de pago vacíos. Busca registros existentes, sin IDs ni nombres fijos, hasta 40 pacientes y las diez notas más recientes de cada uno. Si faltan datos, falla; no salta silenciosamente esas pantallas. No ejecutar dos recorridos a la vez sobre la misma cuenta.

## Qué hace fallar el comando

Una página que no responde bien, un control requerido que falta o no se puede pulsar, una excepción de JavaScript, un error de API, un aviso de error inesperado, un formulario que no llega a completar su flujo, desborde horizontal de página o controles que exceden el ancho disponible. Los avisos esperados de enlace vencido se permiten por su texto exacto; otros errores siguen fallando.

También falla si intenta una escritura distinta de las admitidas, si falta la respuesta de Lupita, si se superan 240 segundos o si el pago no vuelve al estado previo. Reserva hasta 40 segundos para limpiar y tiene un límite final de 290 segundos. El proceso sale con código distinto de cero en los fallos.

La reversión se ejecuta también tras errores, timeout, SIGINT o SIGTERM. Si el botón Deshacer se rompe, el recorrido falla y el bloque de limpieza intenta revertir por API. Si no puede confirmarlo, informa el ID del turno para revisión. No borra auditorías ni retrocede fechas de actualización: restaura el estado funcional del pago, no la base byte por byte. Las lecturas y el ingreso también pueden generar auditoría.

## Resultados

pruebas/e2e/resultados/resultado.json contiene pasos, ancho, duración, error y confirmación de restauración. Si falla, también genera fallo.png con campos ocultos. La carpeta está ignorada por Git. Un resultado verde solo certifica los pasos efectivamente listados.

Prueba negativa realizada: se ocultó temporalmente el botón Entrar en el código de la copia local. El comando salió con código 1 en **7,32 s**, en Entrada / 1280 px, indicando que no aparecía Entrar. Se restauró el archivo y se comprobó que el botón volviera a estar visible. No se incorporó esa rotura a la rama.

Las diez comprobaciones públicas (cinco pantallas por tamaño) pasaron contra la copia local. La validación autenticada en producción queda pendiente de credenciales vigentes.

Para verificar el detector por separado:

    node --test pruebas/e2e/comprobaciones.test.mjs

## Qué NO cubre

- Grabación, micrófono, audio, cifrado, R2, worker, transcripción, aprobación de notas, recuperación y funcionamiento sin conexión.
- SMS, correos, invitaciones válidas, recuperación real de contraseña y cambios de contraseña. Se bloquean las escrituras ajenas a los pasos admitidos.
- Persistencia de altas, agenda, edición y configuración; solo se simula la respuesta de esos formularios. Tampoco archivo/reactivación ni eliminación de pacientes o sesiones.
- Estados ausentes en la cuenta, como sesión fallida, listas totalmente vacías, solapes, horarios extremos o determinados datos clínicos. Búsqueda sin resultados sí se comprueba.
- Safari, Firefox, teléfono físico, teclado nativo, instalación PWA, bloqueo de pantalla y gestos del sistema. Una ventana de 390 × 500 no equivale a probar un teclado real.
- Calidad clínica, exactitud de la IA, ortografía general, contraste de colores, comparación pixel a pixel ni toda posible superposición vertical. Los recortes intencionales con ellipsis y las grillas desplazables no se consideran automáticamente roturas.
- Concurrencia con una persona usando la cuenta, pérdida de red durante la reversión, cierre forzado del proceso con SIGKILL o apagado del equipo. La reserva de limpieza reduce el riesgo, pero no vuelve atómico un cobro por HTTP.
