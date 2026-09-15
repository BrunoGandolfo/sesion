# Arreglos — respaldos, concurrencia, salud y guardián

15 de septiembre de 2026. Rama `arreglos`, nacida de `228f3d5`.

## Qué cambia

- Backup: se adoptó de `origin/respaldo-alarma` (`a97cc58`) únicamente el cambio de `backup.yml` que separa credenciales de respaldo y correo. Faltar correo permite copiar y termina en rojo en el paso final. Faltar una credencial de respaldo aborta antes de `pg_dump`. El índice exige las cinco tablas comunes y al menos `recordatorios` o `envios_sms`; conserva `pg_restore --list`. Se corrigieron los comentarios y el aviso que suponía que ayer había una copia válida.
- Aprobar: `POST /api/sesion-clinica/[id]/aprobar` exige `generacion` entera positiva. Se compara al leer y en la transición atómica. El 409 conserva el borrador y ofrece revisar la nota actual. El borrador anterior sigue visible aparte. Las confirmaciones se invalidan cuando cambia la generación/estado. También se refresca el texto si otra pestaña aprobó la misma generación. No cambió la creación de `integrar_contexto`.
- Deshacer: `DELETE /api/turnos/[id]/cobrar` exige `{ actualizadoEn: <ISO UTC> }` de la fila pagada que vio la usuaria. Se compara ese valor al escribir. Cobrar/deshacer hacen avanzar esa versión incluso en el mismo milisegundo. Reutiliza la columna existente; no se agregó identidad ni esquema. Una edición del turno también puede volver obsoleto el pedido: se devuelve 409 y hay que revisar el pago actual.
- Cobrar: la escritura compara también fecha y versión leídas. Un turno reprogramado después de la validación no se marca realizado/pagado.
- Salud: `fuenteTrabajos` adapta `metricasTrabajos` y se registra en las fuentes predeterminadas. Umbral de un trabajo fallido, o uno pendiente/en curso de más de 24 horas, nivel `aviso`. Ambos piden revisar cola/consumidor; no llevan contenido clínico. No se cambió el latido.
- Guardián: sin rama base y sin archivos SQL termina en error diciendo que no revisó nada. Con base válida y sin diferencias puede seguir pasando.

## Textos nuevos para la integración editorial

- La nota cambió. Revisá la nota actual antes de aprobar; tu borrador se conserva en esta pantalla.
- Revisar nota actual.
- Tu borrador anterior.
- Lo conservamos acá para que puedas recuperar tus correcciones mientras revisás la nota actual.
- El cobro cambió. Revisá el pago actual antes de deshacerlo.

Los borradores viven en memoria de la pantalla: no se guardó contenido clínico en almacenamiento nuevo. La conservación durante el conflicto no promete persistencia tras cerrar la pestaña.

## Pruebas

- `backup.test.ts`: shell real de los pasos del workflow, separaciones de credenciales, esquemas viejo/nuevo/ambos, tablas comunes y fallo de lectura del índice. Se sustituye el proveedor del índice. Además se ensayó el mismo control con `pg_dump`/`pg_restore` 17 reales sobre bases Docker propias, aceptando ambos nombres y rechazando un archivo inválido.
- `revision-carreras.test.ts`: regresiones de las tres reproducciones originales contra Postgres. Incluye aprobación obsoleta antes de leer y entre lectura/escritura; pago nuevo con idénticos fecha y método; no genera trabajo de integración si rechaza aprobación.
- `salida-con-cambios.test.tsx`: pedido con generación, borrador conservado, riesgo a confirmar nuevamente y texto realmente aprobado por otra pestaña.
- `salud-trabajos.test.ts`: base real, agregador predeterminado, ruta del cron y `alertar` reales. Sólo se sustituye el transporte final de correo: no envía mensajes a nadie.
- `migraciones-guardia.test.ts`: repositorios temporales reales, sin ejecutar SQL; cero archivos sin base falla, revisión válida y guardia destructiva se conservan.
- La limpieza E2E envía la versión leída al deshacer. No se ejecutó el recorrido remoto.

## Límites y decisiones

No se tocaron `release`, `publicar.yml`, consentimiento, `consentimiento-hechos.ts`, grabación, segmentos, worker de audio, Recorrido, hilo, `contexto_worker.py`, esquema ni migraciones. No se ejecutaron workflows ni acciones sobre Neon/R2. El arreglo de respaldo no estará activo hasta integrarlo en la rama que ejecuta el workflow.

No hay desacuerdos con el alcance. Se prefirió una comparación de versión ya existente a agregar tablas/campos; su consecuencia conservadora es rechazar también un deshacer después de una edición ajena del turno. El aviso de tareas usa el nivel operativo existente `aviso`: no se redefinió toda la política de alertas.
