# Prueba local del procedimiento de reconstrucción

17 de septiembre de 2026. Rama `procedimiento-publicacion`, base
`c4d2baa48503e3718dbc8b6e3f7593b0d7a6e22f`.

Se extrajeron los bloques Bash identificados en
[el procedimiento](reconstruir-produccion.md). Se ejecutaron sobre Postgres 17.10
en un contenedor Docker exclusivo, con Node 22.23.1 y psql/pg_restore 17.10.
Nunca contra Neon. Las contraseñas y el respaldo de las pruebas son ficticios.

## Prueba contra Postgres

| Operación copiada del documento | Resultado observado |
| --- | --- |
| Restaurar un dump custom cifrado con gpg, generado con el esquema de release d02ae0e | Descifrado, índice y restauración completos; esquema anterior identificado; conteos legibles. |
| Vaciar public en una copia local del esquema viejo | Cero tablas; desaparece el historial viejo; la base anterior conserva su cuenta. |
| Interrumpir la transacción después del DROP y antes de CREATE | Error SQL y rollback: la cuenta anterior continúa existiendo. |
| Identificación del destino antes de vaciar | Host distinto del autorizado rechaza antes de psql. |
| Aplicar migraciones | Las tres terminadas, ninguna revertida; migrate status al día. |
| Alta manual | Una organización, una titular y una configuración; cero pacientes, turnos y SMS. Un evento de alta manual; sin aceptación digital inventada. |
| Password | bcrypt compara correctamente; correo queda normalizado a minúsculas. |
| Repetir el alta | Rechaza sin reemplazar cuenta ni duplicar organización. |
| Contraseña corta o confirmación diferente | Rechaza sin escrituras. |
| Verificación posterior | migrate diff devuelve 0; inicio_ms nullable sin default; tres triggers, dos índices parciales y cinco CHECK presentes. |
| Recuperación desde el dump hacia otra base vacía | Recupera esquema, filas y el historial anterior; no aplica las migraciones nuevas. |
| Recuperación hacia base ocupada | Rechaza antes de restaurar. |
| Archivo gpg dañado | Rechaza indicando que no se pudo descifrar. |
| Login HTTP real de la app local con la cuenta creada | Contraseña incorrecta: 401. Correcta: 200 y cookie HttpOnly. No se imprimió la cookie. |
| Limpieza del ensayo Docker | Se ejecutó el bloque de cierre y se verificó que desaparecen el contenedor y su volumen anónimo. |

El primer ensayo encontró un error en la forma de pasar la conexión a psql:
asignarla mediante PGDATABASE no seleccionaba el servidor de la URI. El documento
usa ahora `psql --dbname="$URL_…"`; la secuencia completa se repitió en limpio
y pasó.

La revisión `codex review --uncommitted` detectó que quitar solo el contenedor
dejaba su volumen anónimo. Se corrigió el cierre con `docker stop` y
`docker rm -v`, y se comprobó que `docker volume inspect` ya no encuentra el
volumen específico del ensayo después del cierre.

## R2 simulado, sin credenciales ni llamadas reales

Un ejecutable `aws` simulado recibió los argumentos de los bloques originales
y mantuvo objetos ficticios en archivos temporales fuera del repositorio.

| Caso | Resultado |
| --- | --- |
| Bucket vacío / respuesta sin Contents | Cero audio; éxito. |
| Solo backups | Se conservan todos. |
| Audio antiguo .enc y segmentos nuevos, junto con backups | Se borran ambos formatos de audio; backups idénticos. |
| Lista con 1.005 segmentos | Se procesa completa. Esto prueba el procesamiento del listado, no la paginación real de AWS/R2. |
| Objeto de formato desconocido | Bloqueo antes de generar la lista de borrado. |
| Falla el listado | Falla; nunca se interpreta como bucket vacío. |
| Falla un borrado a mitad | El reintento de la misma lista completa la limpieza. |
| El borrado ocurrió pero se perdió su respuesta | El reintento termina bien sin tocar backups. |
| Aparece un objeto después del inventario | La comprobación final falla. |
| Cambia la huella de un backup | La comprobación final falla. |
| Listado de copias diarias vacío, con una o varias | Error claro si vacío; con contenido descarga la más reciente. |

## No probado en proveedores

- Creación y aislamiento real de ramas de Neon, permisos del rol y conexiones TLS.
  La alternativa está sustentada en la documentación oficial de Neon.
- R2 real: credenciales, listado paginado, permisos de borrado y ausencia efectiva
  de objetos. No se consultó ni modificó el bucket.
- Cambio de variables/secrets, habilitación o ejecución de Publicar, avance de
  release, despliegue y rollback de Vercel/Railway.
- Respaldo real existente: se ejercitó el mismo restaurador con un dump fabricado
  localmente, no se descargó el de producción.
- Prueba de teléfono y proveedores clínicos/SMS. El documento no los certifica.

Se comprobaron además la sintaxis de todos los bloques Bash y el guardián
documental existente. El CI de esta rama comprueba el repositorio; no ejecuta
este procedimiento ni valida los paneles externos. Su resultado y SHA quedan
en la corrida enlazada en el reporte de entrega.
