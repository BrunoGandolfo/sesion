# Operación de Sesión

Base: main con las seis ramas de Fase 4, 15 de septiembre de 2026. Los archivos citados describen
automatismos del repositorio. No demuestran que una corrida, entrega o ajuste
de consola haya ocurrido. Grabador y Recorrido siguen pendientes según
`docs/pipeline.md`.

## 1. Servicios y publicación

| Servicio | Código o configuración comprobable |
| --- | --- |
| Vercel | Next y API. `vercel.json` deshabilita deploys de main; la rama de producción debe estar configurada como release en el panel. |
| Postgres | Prisma y esquema de `prisma/schema.prisma`. CI utiliza Postgres 17 efímero; local usa un contenedor propio por rama. |
| R2 | Audio cifrado y backups. La app usa `src/lib/r2.ts`; el worker, `processor/r2_client.py`. |
| Railway | Worker Python: `processor/railway.json` y `processor/worker.py`. |
| AssemblyAI / Anthropic | Configuración del worker en `processor/config.py`. Lupita es una llamada aparte de la app, con `src/lib/anthropic-mensajes.ts`. |
| Twilio / Resend | `src/lib/sms/` y `src/lib/correo.ts`. Requieren configuración de cuenta, número y dominio fuera de Git. |

`src/lib/consentimiento-hechos.ts` registra una verificación de retención
cero de Anthropic fechada el 4 de septiembre. Ese dato no verifica por sí solo
la consola actual, todas las claves ni ambos entornos. Revisarlo antes de
habilitar datos reales.

`.github/workflows/ci.yml` corre tipos, build, lint, tests con base efímera,
guardias, auditoría de dependencias y tests del worker. Se puede ejecutar a mano
sobre una rama. Un CI verde o un push a main no publica nada.
`.github/workflows/publicar.yml` sólo acepta ejecución manual
(workflow_dispatch) desde main, con el SHA completo como campo obligatorio.

Antes de migrar, Publicar comprueba que ese SHA pertenezca a main, contenga
release y tenga su última corrida de CI de push en verde. Después verifica
la conexión directa, aplica migraciones y recién entonces avanza release por
fast-forward, sin force. Conserva el aviso de fallo de publicación.
`.github/workflows/avisar-ci.yml` mantiene separado el aviso automático de
CI rojo; ese workflow no migra ni tiene permiso para avanzar release.

### El día de publicación es un acto manual

**Primera publicación del esquema nuevo:** antes de la primera corrida de
Publicar contra la base nueva, seguir
[Reconstruir producción](https://github.com/BrunoGandolfo/sesion/blob/main/docs/operaciones/reconstruir-produccion.md). Ese procedimiento
prepara una base vacía y la cuenta inicial; la secuencia de abajo no convierte
el esquema viejo ni limpia el audio de prueba.

Publicar está **habilitado** y ya publicó. Estuvo deshabilitado durante la
Fase 4 y este documento se quedó diciéndolo; ya no hay ningún paso previo de
habilitación. Que esté habilitado no publica nada por sí solo: el workflow
sólo corre por `workflow_dispatch`, con el SHA escrito a mano.

1. Elegir un SHA completo de main cuya última corrida de CI de push esté verde.
2. Probar ese cambio en el teléfono y aprobar su publicación.
3. En GitHub → Actions → Publicar, elegir Run workflow, rama main, y escribir
   el SHA completo en el campo sha. Esa ejecución manual sí inicia las
   migraciones a producción y después avanza release.
4. Comprobar la corrida, el SHA de release y el despliegue de Vercel. Si algo
   falla, leer el aviso y los logs antes de reintentar.

El procedimiento de [Reconstruir producción](https://github.com/BrunoGandolfo/sesion/blob/main/docs/operaciones/reconstruir-produccion.md)
sí pide deshabilitarlo en algunos tramos y volver a habilitarlo al final: eso
es parte de ese procedimiento, no el estado normal.

No hay que avanzar release a mano ni resolver una divergencia con force.
El CI verde no sustituye la prueba de teléfono ni confirma entrega de SMS.

### Crons declarados

| HTTP | Frecuencia de `vercel.json` |
| --- | --- |
| `GET /api/cron/recordatorios` | Cada cinco minutos: despacho de envíos pendientes. |
| `GET /api/cron/trabajos` | Cada diez minutos: trabajos que ejecuta la app. |
| `GET /api/cron/salud` | Cada hora: métricas y alertas. |
| `GET /api/cron/mantenimiento` | 04:00 UTC: purgas operativas y recifrado. |

Todos usan `CRON_SECRET`. `GET /api/health` comprueba salud y
configuración operativa; `GET /api/estado-worker` expone el estado del worker.
El latido externo corre cada quince minutos según
`.github/workflows/latido.yml`. Un health verde no prueba el micrófono,
el PUT del navegador ni la entrega de una nota.

## 2. Variables y secretos por entorno

`.env.example` es el catálogo de los nombres citados aquí. Las secciones
de Actions y tests son un inventario: sus secretos se cargan en esos entornos,
no en el navegador ni necesariamente en la app. El catálogo del worker
permanece en `processor/.env.example`.

| App (Vercel / local) | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión a la base de la app. |
| `CLAVES_CIFRADO` | Llavero ENC2. Conservar aparte las claves que necesitan los backups. |
| `INVITACIONES_PERMITIDAS` | Cuentas habilitadas para invitar; sin lista no se crean invitaciones. |
| `PROCESSING_SECRET` | Autoriza reclamos del worker; las escrituras posteriores usan tickets. |
| `CRON_SECRET` | Autoriza crons. |
| `ANTHROPIC_API_KEY` | Lupita. El worker carga su propia copia en su entorno. |
| `RESEND_API_KEY`, `ALERTA_CORREO` | Correo y alertas. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Acceso a objetos de audio. |
| `R2_PUBLIC_HOST` | Origen exacto de R2 usado por el navegador, para la CSP. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | Despacho y firma de webhooks SMS. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Reporte opcional de errores. |

`src/lib/env-operacion.ts` exige en producción las variables de correo,
cron, origen R2 y SMS que enumera. Su ausencia hace fallar health.
Que exista una cadena no demuestra que el proveedor la acepte.

| Tests / GitHub Actions | Uso |
| --- | --- |
| `DATABASE_URL_TEST` | Base local exclusiva, en el entorno de tests o su archivo de configuración. La suite la vacía. |
| `DATABASE_URL_PRODUCCION_DIRECTA` | Publicación: migraciones antes de avanzar release; sin pooler. |
| `DATABASE_URL` | Backup: origen del dump. |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Subida y lectura de backups. El endpoint también existe en el catálogo del worker. |
| `BACKUP_ENCRYPTION_KEY` | Passphrase de gpg; guardar copia offline. |
| `RESEND_API_KEY`, `ALERTA_CORREO` | Alertas de workflows. |
| `APP_URL` | Variable opcional del repositorio para el latido; default del workflow: dominio público de Sesión. |

El seed se ejecuta con `prisma/seed.ts` en local; no hay que configurar
secretos de una ruta HTTP de seed eliminada. Los tiempos de lease y reintento
de la sesión son constantes de `src/lib/sesion-clinica/estados.ts`.

## 3. Rotación y sesiones

- `PROCESSING_SECRET` acepta una lista separada por comas. Cargar viejo y
  nuevo en la app, desplegar; cambiar el worker al nuevo; retirar el viejo
  de la app después de verificar reclamos. Los tickets vigentes son credenciales
  distintas: rotar el secreto de reclamo no los revoca automáticamente.
- `CRON_SECRET` también admite lista. Coordinar el valor que envía el
  programador con el que acepta el despliegue.
- Para `CLAVES_CIFRADO`, seguir `docs/encryption.md`: agregar una clave,
  recifrar, comprobar pendientes y errores, retirar la vieja del servicio activo.
  Conservarla de forma protegida mientras haya backups que la requieran.
- R2 y claves de proveedores: crear el reemplazo, actualizar todos los
  entornos consumidores y comprobarlos antes de revocar el anterior.
  Para Anthropic son dos consumidores: app y worker.
- La sesión de acceso es un token opaco cuyo hash vive en sesiones_acceso.
  Cambiar o restablecer la contraseña cierra todas las sesiones, incluida la
  actual. Configuración permite cerrar otros dispositivos; no hay un secreto
  de firma de sesión que rotar.

## 4. Backup y restauración

`.github/workflows/backup.yml` declara backup diario a las 06:00 UTC
y ejecución manual. Hace dump custom con cliente Postgres 17, verifica el índice
con pg_restore, cifra con gpg AES-256, sube a R2 y compara tamaño remoto/local.
El día 1 guarda además una copia mensual.

**Retención real:** diarios, 30 días; mensuales, 366 días (el workflow los
describe como doce meses). La limpieza se ejecuta cuando llega a ese paso
una corrida: no garantiza borrado puntual si el workflow está fallando.
El consentimiento de `src/lib/consentimiento.ts`, generado desde
`src/lib/consentimiento-hechos.ts`, sólo declara 30 días. Esta diferencia
queda pendiente de decisión; no se modifica aquí ni la política ni el texto.

El dump no incluye los archivos de audio, pero sí puede incluir la clave cifrada
de una sesión que todavía no estaba aprobada. Destruir la clave de la fila actual
no elimina esa copia. Para restaurar hacen falta la passphrase del backup y
todas las claves ENC2 usadas por ese dump: conservarlas hasta que no quede
ninguna copia que las necesite, incluidas mensuales y copias retenidas por fallos.

Restaurar siempre primero en una base aislada y vacía. El ensayo a mano
trimestral es exactamente esto, en la máquina del dueño y con su llavero:

1. Descargar el respaldo elegido de R2 (conviene alternar: una vez la diaria
   más reciente, otra la mensual más vieja):

   ```
   aws s3 cp "s3://$R2_BUCKET/backups/mensuales/<archivo>.dump.gpg" . --endpoint-url "$R2_ENDPOINT"
   ```

2. Cargar la passphrase del respaldo y el llavero completo de la época (todas
   las claves ENC2 que alguna vez cifraron, incluidas las que la app retiró)
   sin dejarlos en el historial de la terminal, y correr el guion:

   ```
   read -rs BACKUP_ENCRYPTION_KEY && export BACKUP_ENCRYPTION_KEY
   read -rs CLAVES_CIFRADO && export CLAVES_CIFRADO
   scripts/ensayo/ensayo-manual.sh ./<archivo>.dump.gpg
   ```

   `scripts/ensayo/ensayo-manual.sh` levanta un Postgres 17 efímero en Docker
   (o usa `DATABASE_URL` si apunta a un servidor local), descifra el archivo,
   verifica el índice, restaura con `pg_restore --exit-on-error`
   (`scripts/ensayo/restaurar.sh`) y corre
   `scripts/ensayo/verificar-restauracion.mjs`: filas mínimas por tabla, blobs
   ENC2 con su id de clave, descifrado real de la nota clínica y de la versión
   del Recorrido más vieja y más nueva, y claves foráneas. Deja
   `resultado-manual.json`. Si dice "falta la clave N en el llavero", el
   respaldo no está corrupto: es de una época cuya clave se retiró, y hay que
   agregarla al llavero y repetir.
3. Copiar la salida al acta (`docs/operaciones/actas/`, plantilla al lado),
   sin texto clínico: ids y sí/no.
4. Sólo después decidir si se reemplaza la conexión de la app. Los efectos
   externos pendientes del dump también requieren revisión antes de activar
   crons y worker contra la base restaurada.

`.github/workflows/ensayo-restauracion.yml` hace lo mismo el día 1 de cada
mes, con dos copias (la diaria más reciente y la mensual más vieja) y SIN
descifrar: no recibe ninguna clave clínica, a propósito, para no tener el
llavero en GitHub Actions. En su lugar censa el id de clave de cada blob
contra la variable `CLAVES_CIFRADO_IDS` (Settings → Variables; solo ids, por
ejemplo `1,2`: la clave del llavero de la app más las retiradas que se
conservan para los respaldos). Un id que no figura hace fallar el ensayo
avisando que hay datos cifrados con una clave retirada o desconocida, que no
es corrupción. Sin esa variable, el workflow falla antes de bajar nada.
`src/lib/__tests__/ensayo-restauracion.test.ts` ejerce los dos guiones con
respaldos generados contra la base de test: bueno, vacío, corrupto, truncado y
uno leído con un llavero al que se le retiró la clave.

El ensayo manual trimestral deja acta en
`docs/operaciones/actas/`; `scripts/ci/acta-vigente.mjs` exige un acta
con antigüedad máxima de cien días cuando ya existe alguna. Mientras no
haya ninguna, sólo advierte hasta el 20 de diciembre de 2026 y luego falla.
En esta base no hay un acta: un verde hoy no acredita restauración ni
descifrado de una nota. La existencia del workflow tampoco prueba una corrida:
al 15 de septiembre de 2026 el ensayo automático nunca se ejecutó.

## 5. Incidentes y límites conocidos

**Base caída.** Ver la conexión y disponibilidad de Postgres, health, latido
y los logs del servidor. Un mensaje de acceso rechazado no descarta una caída
de la base. Los tests de integración usan un contenedor local, separado del
servicio desplegado.

**Migración fallida.** Mirar el paso y el SHA en Publicar; ejecutar migrate
status con la conexión directa antes de decidir cómo recuperar. No ejecutar
migrate dev sobre producción. La guarda de
`scripts/ci/migraciones.mjs` inspecciona cambios destructivos y drift;
no sustituye evaluar el efecto de una migración.

**PUT a R2 rechazado.** En main aún falta la subida nueva. Para diagnosticar
un despliegue que sí la implemente, comparar la petición real del navegador,
el preflight y una petición equivalente fuera del navegador. Registrar status,
cabeceras y código XML del proveedor, redactando firmas. No clasificar cualquier
403 como CORS: revisar origen/métodos/headers del bucket, credenciales, expiración
y headers firmados según la evidencia.

**Audio pendiente de borrado.** La aprobación encola el borrado después de
confirmar la base. La app no cifra el audio: mientras el objeto exista en R2 se
puede escuchar con acceso al bucket, así que un borrado fallido importa más que
antes (ya no hay clave que destruir). Mirar trabajos, intentos y último error;
no buscar una columna de key del audio del esquema anterior. El payload conserva
prefijo e índices. Las políticas son acotadas, en
`src/app/api/_lib/casos-uso/trabajos/politica.ts`.

**Sesión de acceso filtrada.** Cerrar dispositivos y cambiar contraseña.
Revisar sesiones_acceso e intentos_acceso. Un dump de hashes de tokens no
equivale a las cookies en claro. Las purgas tienen condiciones por fecha y
estado en `src/app/api/_lib/casos-uso/mantenimiento.ts`; no todo registro
desaparece treinta días después de crearse.

**Llavero filtrado.** Rotar protege escrituras futuras, no una copia que ya salió.
Revisar alcance, backups, acceso a la base y credenciales relacionadas. No destruir
la única clave de backups que deban conservarse antes de definir la recuperación.

**PWA antigua.** `src/components/layout/aviso-version.tsx` consulta la versión
al volver a primer plano y muestra un aviso para actualizar con un toque.
No recarga sola y espera mientras la ruta sea de grabación.

## 6. SMS

El código está en `src/app/api/_lib/casos-uso/despachar-sms.ts`,
`src/lib/sms/` y `src/lib/recordatorios-programacion.ts`.

En Twilio, configurar el webhook entrante para `POST /api/sms/entrante`
en el dominio público y habilitar Uruguay. La app manda la URL de
`POST /api/sms/callback` como StatusCallback. Ambos validan firma.
El origen público usado para firmar está en `src/lib/sms/firma.ts`;
un cambio de dominio debe coordinarse con esa configuración.

Los recordatorios se programan para la tarde anterior, dos tardes antes o la
misma mañana, en hora de Montevideo, con dispersión de 0–14 minutos.
Si la mañana no cae antes del turno, se usa la tarde anterior.
No se describe un esquema antiguo de horas de anticipación.

| Estado | Significado operativo |
| --- | --- |
| pendiente | Espera su hora o un reintento. |
| enviando | Reservado por una corrida; el despachador recupera reservas vencidas. |
| aceptado | El proveedor aceptó el SMS; todavía no prueba entrega. |
| entregado | Llegó la confirmación de entrega. |
| no_entregado | El proveedor informó que no llegó; consultar el código. |
| cancelado | El envío dejó de corresponder. Si ya había sido aceptado, pudo haber salido. |
| fallido | Rechazo definitivo o ventana de envío agotada. |
| desconocido | Hubo una llamada con resultado incierto; no se reenvía automáticamente. |

Ante desconocido, buscar el mensaje en los logs de Twilio por hora y destino
antes de decidir una corrección. No hay pantalla de conciliación en main;
no hacer una escritura manual que pueda duplicar el SMS sin verificar evidencia.
El estado por turno se consulta por `GET /api/sms/envios`.

Recordar cobro usa `POST /api/pacientes/[id]/recordar-cobro` y crea o
reutiliza un envío SMS persistido. Confirmar la cola no significa que el SMS
haya sido entregado. Las alertas se envían por correo con
`src/lib/alertas.ts`; si se agotan sus intentos, quedan logs y Sentry si
está configurado.

## 7. Comprobación documental

~~~bash
node scripts/ci/documentacion-vigente.mjs
~~~

Valida los cuatro documentos de esta tanda contra archivos, exports HTTP y
el catálogo de variables. No conecta a proveedores, no ejecuta migraciones
remotas, no manda mensajes y no acredita disponibilidad de funciones pendientes.
