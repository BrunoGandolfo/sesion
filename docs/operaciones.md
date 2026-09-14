# Operaciones

Dónde vive cada pieza, qué secretos existen, cómo se rotan, cómo se restaura
un backup y qué trampas ya nos mordieron. Solo nombres de variables, nunca
valores.

## 1. Dónde vive cada pieza

| Pieza | Servicio | Cómo se despliega |
| --- | --- | --- |
| App Next.js 16 (UI + API + crons) | Vercel | Vercel publica desde la rama `release` (Production Branch en el panel; el deploy desde `main` está apagado en `vercel.json`). `release` la mueve sólo `.github/workflows/publicar.yml`, cuando el CI de `main` terminó en verde y las migraciones se aplicaron a producción. Crons en `vercel.json`: `/api/cron/recordatorios` cada 5 min, `/api/cron/salud` cada hora, `/api/cron/trabajos` cada 10 min, `/api/cron/mantenimiento` a las 6:30 UTC. |
| Postgres 17 | Neon | Rama `production` (la app). Los tests de integración NO usan Neon: el CI levanta un Postgres 17 efímero por corrida y en local se usa el contenedor de `docker-compose.yml` (o cualquier `postgres:17` en localhost). La rama `test` de Neon queda como alternativa explícita sin Docker, y agotó la cuota una vez (septiembre de 2026). |
| Audio cifrado | Cloudflare R2, bucket `sesion-audio` | Sin deploy. CORS del bucket debe permitir el PUT desde el dominio de la app. |
| Backups cifrados de la base | Cloudflare R2, prefijo `backups/` del bucket del secret `R2_BUCKET` | Los escribe GitHub Actions. |
| Worker Python | Railway, servicio con `python worker.py` (`processor/railway.json`, reinicio `ON_FAILURE` hasta 10 veces) | Deploy desde el repo. |
| ASR | AssemblyAI | Cuenta con API key. |
| LLM | Anthropic | Workspace dedicado, con retención de datos deshabilitada (configuración de la consola, no del repo). Clave "identity-linked": exige `anthropic-workspace-id`. |
| SMS | Twilio, subcuenta dedicada | Número emisor en E.164. La app le pasa a Twilio el `StatusCallback` (`https://sesionapp.app/api/sms/callback`) en cada mensaje; el webhook de mensajes entrantes (`https://sesionapp.app/api/sms/entrante`) se configura en el número, en la consola. Ver §7. |
| Correo | Resend | API HTTP, sin SDK. Verificar el dominio antes de probar entregas reales. |
| CI, publicación, backups y latido | GitHub Actions | `ci.yml` (cada push/PR a `main`), `publicar.yml` (main → release), `backup.yml` (diario), `ensayo-restauracion.yml` (mensual), `latido.yml` (cada 15 min). Todos avisan por correo con `.github/actions/alerta-correo`. |

## 2. Secretos: qué existen y dónde

Vercel (app):

| Variable | Para qué |
| --- | --- |
| `DATABASE_URL` | Rama `production` de Neon. |
| `AUTH_SECRET`, `AUTH_URL` | Auth.js. `AUTH_URL=https://sesionapp.app`. |
| `RESEND_API_KEY` | Correo transaccional por Resend. Dominio `sesionapp.app` verificado; remitente `no-responder@sesionapp.app`. Sin clave se registra el fallo sin revelar si existe la cuenta. |
| `NOTES_ENCRYPTION_KEY` | Cifrado en reposo (`docs/encryption.md`). |
| `PROCESSING_SECRET` | Bearer M2M con el worker. Mismo valor en Railway. |
| `CRON_SECRET` | Bearer de los crons. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | URL prefirmada, HeadObject y borrado del audio. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | SMS. Sin `TWILIO_SMS_FROM` el cron no toca ningún envío (quedan pendientes). `TWILIO_AUTH_TOKEN` además valida la firma de los dos webhooks. Obligatorias en producción. |
| `ALERTA_CORREO` | A dónde llega TODA alerta (cron de salud, despacho de SMS, health). Un solo canal, correo por Resend. Obligatoria en producción. |
| `R2_PUBLIC_HOST` | Origen exacto de la URL prefirmada de R2 (`https://<bucket>.<accountId>.r2.cloudflarestorage.com`), para el `connect-src` de la CSP. Obligatoria en producción. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (opcionales) | Errores. |
| `LEASE_MINUTES`, `MAX_INTENTOS_PROCESAMIENTO`, `CONTEXTO_DESDE` (opcionales) | Lease del worker y fecha de corte del contexto longitudinal. |
| `SEED_SECRET`, `SEED_USER_PASSWORD` | Ya no las lee nadie: `/api/seed` se borró; el seed es `prisma/seed.ts` a mano en local. Se pueden quitar. |

Las marcadas "obligatoria en producción" están en `src/lib/env-operacion.ts`: si falta alguna, `/api/health` contesta 503 (el monitor externo y `latido.yml` lo ven en el primer deploy) y el cron de salud lo cuenta como métrica crítica.

Railway (worker): ver `processor/.env.example`. Incluye `PROCESSING_SECRET`,
credenciales R2 (`R2_ENDPOINT` con la URL del account), `ASSEMBLYAI_API_KEY`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`.

GitHub Actions (Settings → Secrets and variables → Actions):

| Secret | Quién lo usa |
| --- | --- |
| `DATABASE_URL_PRODUCCION_DIRECTA` | `publicar.yml`: `prisma migrate deploy` contra producción antes de avanzar `release`. Conexión DIRECTA de Neon, sin `-pooler` (el workflow lo verifica). |
| `DATABASE_URL` | `backup.yml`: origen del `pg_dump` (Neon `production`). |
| `RESEND_API_KEY`, `ALERTA_CORREO` | Los cinco workflows, para avisar por correo cuando algo falla (CI en rojo, publicación fallida, backup fallido, ensayo fallido, latido caído). Sin ellos el step de alerta falla en rojo, a propósito. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | `backup.yml` y `ensayo-restauracion.yml`: subir y bajar el backup. |
| `BACKUP_ENCRYPTION_KEY` | Passphrase gpg del backup. Guardar copia offline. |

Variables de repositorio: `APP_URL` (opcional, default `https://sesionapp.app`) para `latido.yml`.

Ya no se usan y se pueden borrar: `DATABASE_URL_TEST` (el CI levanta su propio Postgres) y `BACKUP_ALERT_WEBHOOK` (las alertas van por correo).

Neon: contraseñas de los roles de cada rama (viven en las connection strings).

## 3. Cómo se rota cada uno

| Secreto | Pasos |
| --- | --- |
| `PROCESSING_SECRET` | Generar (`openssl rand -base64 32`), cargar en Vercel y Railway, redeploy de ambos. Mientras difieran, el worker recibe 401 y no procesa. |
| `CRON_SECRET` | Generar, cargar en Vercel. Vercel Cron manda el nuevo automáticamente. |
| `NOTES_ENCRYPTION_KEY` | No rotable en caliente: hay que re-cifrar todas las columnas. Hoy no hay script. Ver `docs/encryption.md` §5. |
| `AUTH_SECRET` | Generar y cargar en Vercel. Cierra todas las sesiones. |
| Credenciales R2 | Crear token nuevo en Cloudflare, cargar en Vercel, Railway y GitHub Actions, borrar el viejo después. |
| `ASSEMBLYAI_API_KEY` | Nueva key en AssemblyAI, cargar en Railway, redeploy. |
| `ANTHROPIC_API_KEY` | Nueva key en el mismo workspace (o cambiar también `ANTHROPIC_WORKSPACE_ID`), cargar en Railway, redeploy. |
| Twilio | Rotar el auth token de la subcuenta, cargar en Vercel, redeploy. El token también valida la firma de los webhooks: entre la rotación y el redeploy, los callbacks de estado devuelven 403 y los envíos de ese rato quedan en `aceptado` sin pasar a `entregado`; una respuesta "BAJA" de ese rato se pierde (la paciente puede mandarla de nuevo). |
| `BACKUP_ENCRYPTION_KEY` | Cambiar el secret; los backups anteriores siguen cifrados con la passphrase vieja: conservarla hasta que expiren (30 días). |
| Contraseña de Neon | Reset desde la consola de Neon, actualizar `DATABASE_URL` en Vercel y GitHub, `DATABASE_URL_TEST` si es la rama `test`. |

## 4. Backup y restauración

Backup (`.github/workflows/backup.yml`): todos los días a las 06:00 UTC
(03:00 Montevideo) y bajo demanda. `pg_dump --format=custom --no-owner
--no-privileges` con el cliente 17 por ruta completa
(`/usr/lib/postgresql/17/bin/pg_dump`), cifrado `gpg --symmetric
--cipher-algo AES256`, subida a `s3://$R2_BUCKET/backups/sesion-backup-<UTC>.dump.gpg`,
verificación con `head-object`, retención 30 días.

Restauración (pasos que ya se ejecutaron con éxito contra una rama de prueba
de Neon):

1. Bajar el archivo:
   `aws s3 cp s3://<bucket>/backups/<archivo>.dump.gpg . --endpoint-url <R2_ENDPOINT>`
2. Descifrar:
   `gpg --decrypt --output <archivo>.dump <archivo>.dump.gpg` (pide la
   passphrase de `BACKUP_ENCRYPTION_KEY`).
3. Restaurar en una base vacía, usando la conexión **directa** (sin
   `-pooler`) y el cliente 17:
   `/usr/lib/postgresql/17/bin/pg_restore --no-owner --no-privileges --dbname "<DATABASE_URL de la rama destino>" <archivo>.dump`
4. Verificar: contar filas de `sesiones_clinicas`, `pacientes`, `turnos`;
   correr la consulta de prefijo `ENC1` de `docs/encryption.md` §4.
5. Apuntar la app a esa rama solo si el objetivo es reemplazar producción.
   `NOTES_ENCRYPTION_KEY` tiene que ser la misma que cifró los datos del dump.

## 5. Trampas conocidas

- **Pooler vs directo.** Las migraciones (`prisma migrate deploy`) y
  `pg_restore` van por la conexión directa de Neon. El pooler (`-pooler` en el
  host) no soporta todo lo que Prisma Migrate necesita.
- **`DATABASE_URL_TEST` sin `-pooler`.** Los tests de integración hacen
  `TRUNCATE ... CASCADE` y abren transacciones largas; con pooler fallan de
  forma intermitente.
- **`connect_timeout=15`.** Neon suspende el cómputo de la rama cuando está
  ociosa y el primer connect tarda varios segundos. Sin ese parámetro en la
  connection string, el primer request o el primer test fallan por timeout.
- **Recargar la PWA tras cada deploy.** La app instalada en el teléfono
  conserva la versión anterior hasta que se recarga. Después de un deploy,
  cerrar y volver a abrir (o recargar) antes de probar.
- **`prisma migrate dev` nunca contra producción.** Ese comando puede
  resetear la base. Contra `production` solo `prisma migrate deploy`. Para
  desarrollar migraciones usar una rama de Neon o la rama `test`.
- **`printf`, no `echo`, al cargar claves en Vercel.** `echo` agrega `\n` y
  la clave base64 deja de decodificar a 32 bytes; la app no arranca.
- **Tests secuenciales.** `vitest.config.ts` tiene `fileParallelism: false`
  porque todos los archivos de integración comparten la misma base (la
  efímera del CI o el contenedor local) y la vacían con TRUNCATE. No volver
  a activar el paralelismo.
- **Tests de integración nunca contra Neon.** `src/lib/__tests__/db-test.ts`
  sólo acepta un host local para `DATABASE_URL_TEST`; la rama `test` de Neon
  agotó la cuota y tiró producción un fin de semana (septiembre de 2026).
  Si el puerto 5433 de `docker-compose.yml` está ocupado por otro proyecto,
  `docker run -d -e POSTGRES_PASSWORD=… -e POSTGRES_DB=sesion_test -p 127.0.0.1:5434:5432 --tmpfs /var/lib/postgresql/data postgres:17`
  y `prisma migrate deploy` contra ese puerto.
- **Si el borrado del audio en R2 falla al aprobar**, la sesión igual se
  aprueba y `audioR2Key` se conserva para reintentar. La clave temporal se
  destruye siempre, así que el blob remanente es inaccesible.
- **CORS de R2.** Un 403 en el PUT del navegador casi siempre es CORS del
  bucket, no credenciales.


## 6. Migraciones

Las aplica `publicar.yml`, con `DATABASE_URL_PRODUCCION_DIRECTA`, ANTES de
avanzar `release`: el código nuevo nunca se encuentra con un esquema viejo.
Por eso una migración que viaja con código tiene que ser aditiva; una
destructiva va en el despliegue siguiente (lo verifica
`scripts/ci/migraciones.mjs`). Nadie aplica migraciones a mano como rutina.

Si `publicar.yml` avisó que la migración falló, la base puede haber quedado a
medias. En una terminal del dueño, con la URL directa (sin `-pooler`) cargada
en `DATABASE_URL_PRODUCCION_DIRECTA` sin imprimirla:

```sh
DATABASE_URL="$DATABASE_URL_PRODUCCION_DIRECTA" npx prisma migrate status
```

y recién con eso leído, decidir si `migrate deploy` de nuevo o `migrate
resolve`. Nunca `migrate dev` contra producción.

### Tablas y pendientes de publicación

- `password_resets`: hashes de enlaces de recuperación, vigencia de una hora,
  consumo e índice por usuario/fecha para el máximo de tres pedidos por hora.
- `invitaciones`: hashes de invitaciones de siete días, creadora y consumo.
  En esta versión `organization_id` y `email` se crean nulos: el registro
  crea una organización propia, nunca comparte el consultorio de la invitante.
- La aceptación de términos queda en el evento `cuenta.registro`, con su
  versión, dentro de la transacción de alta. No se registra el email ni el token.

Antes de ofrecer el acceso, el dueño debe terminar la verificación del dominio
`sesionapp.app` en Resend y revisar el texto de `/terminos` (constantes
`TERMINOS_*` de `glosario.ts`, actualizando también `TERMINOS_VERSION`). El borrador deja explícitamente pendiente el
canal definitivo de baja y el tratamiento de los respaldos. Con el dominio
verificado, probar un correo real y una recuperación completa.

El login sigue usando Auth.js v5, credenciales y JWT de 30 días. La recuperación
no revoca los JWT existentes ni borra el contador de intentos del login, igual
que el cambio de contraseña anterior. El alta usa el mismo `signIn` de
credenciales y respeta sus límites; si el acceso falla después de crear la
cuenta, el formulario avisa que debe entrar desde login, sin consumir otra
invitación ni intentar crear otra organización.

## 7. SMS: qué configurar en Twilio y qué mirar

El sistema de envío está descrito en el código
(`src/app/api/_lib/casos-uso/despachar-sms.ts` y `src/lib/sms/`). Lo que hay
que saber para operarlo:

**En la consola de Twilio, una sola vez.**

- En el número emisor (Phone Numbers → Manage → Active numbers → el número →
  Messaging): "A message comes in" = Webhook, `POST`,
  `https://sesionapp.app/api/sms/entrante`. Es lo que hace que una paciente
  que responde "BAJA" (o "STOP", "CANCELAR", con o sin tildes) no reciba más
  nada de este número. Sin esto, la respuesta no llega a ningún lado.
- El `StatusCallback` NO se configura en la consola: la app lo manda en cada
  mensaje (`https://sesionapp.app/api/sms/callback`). Si cambia el dominio,
  cambian `ORIGEN_PUBLICO` en `src/lib/sms/firma.ts` y el webhook entrante.
- Geo Permissions (Messaging → Settings → Geo permissions): Uruguay
  habilitado. Si no, todo envío termina `fallido` con el código 21408 y una
  alerta crítica.
- Los dos webhooks validan `X-Twilio-Signature` con `TWILIO_AUTH_TOKEN`
  contra la URL pública. Sin firma válida contestan 403 y no escriben nada.

**Qué significa cada estado de un envío** (`envios_sms.estado`):

| Estado | Qué pasó | Qué hacer |
| --- | --- | --- |
| `pendiente` | Espera su hora o el próximo intento (`proximo_intento_en`). | Nada. |
| `enviando` | Una corrida del cron lo reservó. Si lleva más de 5 min, la corrida murió y la siguiente lo rescata. | Nada; si lleva más de 30 min, el cron de salud avisa. |
| `aceptado` | Twilio devolvió 2xx: lo tiene en cola. **No es "llegó".** | Esperar el callback. Sin webhook configurado, se queda acá. |
| `entregado` | El operador confirmó la entrega. | Nada. |
| `no_entregado` | El operador dijo que no llegó (`codigo_proveedor`, `motivo_no_envio`). | Ver el motivo; 30007 = el operador filtra el contenido, avisa por correo. |
| `cancelado` | Dejó de tener sentido: turno cerrado o reprogramado, turno ya pasado, paciente dada de baja. Si tiene `aceptado_en`, el SMS SALIÓ y después se cerró el turno: hay que llamar a la paciente (avisa por correo). | Sólo en ese último caso. |
| `fallido` | Se agotó la ventana útil (2 h antes del turno) sin poder mandarlo, o Twilio lo rechazó de forma definitiva (teléfono inválido, etc.). | El motivo está en `motivo_no_envio`. No hay reintento: ya se intentó todo. |
| `desconocido` | Se llamó a Twilio y no hubo respuesta legible: pudo haber salido. **Nunca se reenvía solo.** | Mirar en la consola de Twilio (Monitor → Logs → Messaging, por el teléfono y la hora) si el mensaje existe. Hoy no hay pantalla para resolverlo: si salió, `UPDATE envios_sms SET estado='aceptado', sid='<SM…>' WHERE id=…`; si no salió y el turno todavía sirve, `SET estado='pendiente', proximo_intento_en=now()`. |

**Backoff.** Un fallo transitorio (Twilio caído, 429, 5xx) espera
2, 4, 8, 16, 30, 30… minutos, sin tope de intentos, hasta 2 horas antes del
turno; ahí, un último intento y `fallido`. Un aviso de cobro tiene 24 h.

**Alertas que este sistema manda por correo:** credenciales rechazadas
(20003), número emisor mal configurado (21212, 21606), país no habilitado
(21408), cuenta suspendida (30002), contenido filtrado por el operador
(30007), un SMS que salió con el turno ya cerrado, y las métricas del cron
de salud (fallidos, desconocidos ≥ 3, trabados en `enviando`).

**Lo que NO se guarda:** el texto del mensaje (decisión del dueño). Queda
`segmentos` para el conteo mensual por consultorio, que el cron de salud
informa y no limita.
