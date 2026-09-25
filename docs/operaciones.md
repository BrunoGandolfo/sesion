# Operación de Sesión

Manual de producción: publicar, variables, respaldos, incidentes, SMS y CSP.
Los archivos citados describen automatismos del repositorio; no demuestran que
una corrida, entrega o ajuste de consola haya ocurrido. Cómo se trabaja y se
entrega un cambio está en `docs/como-trabajamos.md`.

## 1. Servicios y publicación

| Servicio | Código o configuración comprobable |
| --- | --- |
| Vercel | Next y API. `vercel.json` deshabilita deploys de main; la rama de producción debe estar configurada como release en el panel. |
| Postgres | Prisma y esquema de `prisma/schema.prisma`. CI utiliza Postgres 17 efímero; local usa un contenedor propio por rama. |
| R2 | Audio de las sesiones y backups. La app no cifra el audio: lo sube tal cual y R2 lo guarda cifrado en reposo (cifrado del proveedor). Los backups sí van cifrados con gpg. La app usa `src/lib/r2.ts`; el worker, `processor/r2_client.py`. |
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
`.github/workflows/latido.yml` consulta los dos: su cron pide cada quince
minutos, pero GitHub posterga los `schedule` y en la práctica corre entre cinco
y ocho veces por día. Para enterarse de una caída en minutos hace falta un
monitor externo contra esas dos rutas. El latido distingue el worker caído
(503), la ruta inalcanzable (redirect o 404) y la app sin respuesta. Un health verde no prueba el micrófono,
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
La PRIMERA corrida lograda de cada mes guarda además una copia mensual: la
condición es que no haya ninguna bajo `backups/mensuales/sesion-backup-<AAAA-MM>-`,
no la fecha de la corrida. Si el día 1 GitHub se saltea la corrida o falla, la
siguiente corrida exitosa cubre el mes. Un listado de R2 que falla aborta el
paso: no se lee como "no hay ninguna".

**Retención:** diarios, 30 días; mensuales, 366 días (doce meses). Es lo mismo
que declara el consentimiento, generado desde `src/lib/consentimiento-hechos.ts`.
La limpieza se ejecuta cuando una corrida llega a ese paso: si el workflow está
fallando, no hay borrado puntual.

El dump no incluye los archivos de audio. Las grabaciones actuales no tienen
clave de audio: la app dejó de cifrar el audio. Sólo filas de grabaciones
anteriores pueden conservar la columna de clave, cifrada con ENC2. Para
restaurar hacen falta la passphrase del backup y todas las claves ENC2 usadas
por ese dump: conservarlas hasta que no quede ninguna copia que las necesite,
incluidas mensuales y copias retenidas por fallos.

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

`.github/workflows/ensayo-restauracion.yml` hace lo mismo el día 2 de cada
mes (el día 1 corría antes que el respaldo que venía a verificar: GitHub
demora los `schedule` varias horas), con dos copias (la diaria más reciente y la mensual más vieja) y SIN
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

**Qué prueba el ensayo automático y qué no.** Prueba que el archivo de R2 se
descifra con `BACKUP_ENCRYPTION_KEY`, que `pg_restore --exit-on-error` lo abre
entero en una base vacía, que las tablas tienen filas por encima de un piso,
que las columnas cifradas tienen formato válido y que ninguna clave foránea
quedó huérfana. No prueba que una nota se pueda leer: no recibe ninguna clave
clínica. Con blobs ENC1 (sin id de clave) sólo confirma el formato. Por eso el
ensayo manual con el llavero no se reemplaza.

El ensayo manual trimestral deja acta en
`docs/operaciones/actas/`; `scripts/ci/acta-vigente.mjs` exige un acta
con antigüedad máxima de cien días cuando ya existe alguna. Mientras no
haya ninguna, sólo advierte hasta el 20 de diciembre de 2026 y luego falla.

### Comprobaciones pendientes del dueño

Ninguna se puede hacer desde el repositorio.

1. **Acta manual antes del 20 de diciembre de 2026.** `docs/operaciones/actas/`
   sólo tiene la plantilla. Sin un acta real, ese día el CI empieza a fallar
   y no se puede publicar.
2. **La primera copia mensual.** Después del 1 de octubre, confirmar que hay un
   objeto bajo `backups/mensuales/` en el bucket de R2. Hasta septiembre de
   2026 nunca hubo copia mensual; el ensayo automático del 16 de septiembre
   falló por eso, y en la misma corrida la copia diaria se restauró y verificó
   entera.
3. **El ensayo automático con las dos copias en verde.** Después del punto 2,
   correr a mano Actions → Ensayo de restauración.
4. **`CLAVES_CIFRADO_IDS` cargada** en Settings → Variables de Actions: sin ella
   el ensayo falla antes de bajar nada. Son sólo ids, nunca claves.

### Reversiones administrativas

Dos SQL retiran lo que agregó una migración. No los ejecuta la app ni Publicar;
sólo se corren a mano, con la conexión directa y después de decidirlo.

- `scripts/mantenimiento/revertir-inmutabilidad.sql` retira los triggers de
  `20260916013000_inmutabilidad`: la auditoría y las versiones del Recorrido
  vuelven a poder modificarse. No borra datos. Para restituir la garantía se
  vuelve a aplicar el SQL de esa migración.
- `scripts/mantenimiento/revertir-limites-invitados.sql` saca las columnas de
  `20260917120000_limites_invitados` y su registro en `_prisma_migrations`.
  Es destructivo: antes hay que desplegar un código que no lea esas columnas.

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

**PUT a R2 rechazado.** Para diagnosticar, comparar la petición real del navegador,
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

Valida `README.md`, `docs/pipeline.md`, `docs/encryption.md` y este documento contra archivos, exports HTTP y
el catálogo de variables. No conecta a proveedores, no ejecuta migraciones
remotas, no manda mensajes y no acredita disponibilidad de funciones pendientes.

## 8. Content-Security-Policy: pasar de reporte a bloqueo

La CSP sale del proxy (`src/proxy.ts`, política en `src/lib/csp.ts`) en modo
**Report-Only**: el navegador no bloquea nada y postea las violaciones a
`POST /api/csp-report`, que las deja en el log de la función (no en
`eventos_auditoria`: son diagnóstico, no rastro clínico). La cabecera
`frame-ancestors 'none'` de `next.config.ts` existe aparte porque una política
report-only no impide el embebido.

Pasar a bloqueo es cambiar `Content-Security-Policy-Report-Only` por
`Content-Security-Policy` en `conReporteCsp` (`src/proxy.ts`). Antes, la lista de destinos externos (**DESTINOS_EXTERNOS**)
(`src/lib/csp.ts`) tiene que cubrir todo lo que usa el navegador. El caso que
importa es R2: el navegador hace PUT del audio directo al bucket y
`connect-src` gobierna ese PUT. R2 entra por `R2_PUBLIC_HOST`, el origen exacto
de la URL prefirmada, con el bucket como primer subdominio
(`https://<bucket>.<accountId>.r2.cloudflarestorage.com`, sin comodín,
obligatoria en producción). `src/lib/__tests__/csp-destinos.test.ts` falla
ante cualquier host `https://` nuevo en `src/` que no esté declarado.

### Qué mirar en los reportes

Cada línea del log tiene la forma:

```
[csp] directiva="script-src-elem" bloqueado="https://…" documento="https://…" archivo="…:42" disposicion="report"
```

1. **`script-src-elem` o `script-src` con `bloqueado="inline"`:** un `<script>`
   sin nonce. Si el `documento` es una página de la app, no se puede pasar a
   bloqueo hasta encontrar cuál y por qué. La causa más probable es una página
   prerenderizada en el build: sin request no hay nonce. Los layouts de
   `(dashboard)`, `(auth)` e `(impresion)` declaran `dynamic = "force-dynamic"`;
   una página fuera de esos grupos tiene que declararlo también. Si el
   `documento` es de una extensión (`chrome-extension://`, `moz-…`) o el
   `archivo` no es del dominio, es ruido del navegador de quien mira.
2. **`style-src` o `style-src-attr`:** esperables. La política conserva
   `'unsafe-inline'` en `style-src` porque Tailwind 4 y framer-motion escriben
   en el atributo `style`, que los nonces no cubren. Sacarlo es un trabajo
   aparte y no bloquea el paso de `script-src`.
3. **`connect-src`, `img-src`, `media-src`, `font-src`:** algo que la app pide y
   la política no contempla. Se agrega el destino a esa lista con un
   comentario que diga qué lo pide, y a `src/lib/__tests__/csp-destinos.test.ts` si es un host
   que sólo usa el servidor.

### Cuándo

Después de cuatro semanas de uso real contadas desde el deploy, para que la
profesional haya pasado por cada pantalla (agenda, ficha, grabación,
aprobación, configuración, cobros) en el teléfono y en la computadora. El
plazo no está acreditado: hay que fijar la fecha de inicio. Además:

- `src/lib/__tests__/csp-destinos.test.ts` en verde y `R2_PUBLIC_HOST` cargada en Vercel con el
  host exacto (`GET /api/health` contesta 503 si falta);
- cero reportes del tipo 1 del dominio propio en las últimas dos semanas;
- al menos una grabación completa de una sesión real bajo la política;
- el log leído después del último deploy de Next o de una dependencia grande.

Antes de confiar en el log, comprobar que se lee: grabar una sesión de prueba
y buscar su línea de `connect-src` o confirmar que no hay ninguna.

### Al pasar a bloqueo

Dejar también `Content-Security-Policy-Report-Only`, con la misma política,
un mes más: la de bloqueo bloquea y la de reporte sigue avisando. Después se
saca la de reporte, y se puede fusionar `frame-ancestors 'none'` de
`next.config.ts` con la política del proxy.
