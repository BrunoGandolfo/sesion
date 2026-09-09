# Operaciones

Dónde vive cada pieza, qué secretos existen, cómo se rotan, cómo se restaura
un backup y qué trampas ya nos mordieron. Solo nombres de variables, nunca
valores.

## 1. Dónde vive cada pieza

| Pieza | Servicio | Cómo se despliega |
| --- | --- | --- |
| App Next.js 16 (UI + API + crons) | Vercel | Push a `main` → deploy automático. Crons en `vercel.json`: `/api/cron/recordatorios` cada 5 min, `/api/cron/salud` cada hora. |
| Postgres 17 | Neon | Rama `production` (la app) y rama `test` (CI y tests de integración). |
| Audio cifrado | Cloudflare R2, bucket `sesion-audio` | Sin deploy. CORS del bucket debe permitir el PUT desde el dominio de la app. |
| Backups cifrados de la base | Cloudflare R2, prefijo `backups/` del bucket del secret `R2_BUCKET` | Los escribe GitHub Actions. |
| Worker Python | Railway, servicio con `python worker.py` (`processor/railway.json`, reinicio `ON_FAILURE` hasta 10 veces) | Deploy desde el repo. |
| ASR | AssemblyAI | Cuenta con API key. |
| LLM | Anthropic | Workspace dedicado, con retención de datos deshabilitada (configuración de la consola, no del repo). Clave "identity-linked": exige `anthropic-workspace-id`. |
| SMS | Twilio, subcuenta dedicada | Número emisor comprado en E.164. |
| Correo | Resend | API HTTP, sin SDK. Verificar el dominio antes de probar entregas reales. |
| CI y backups | GitHub Actions | `.github/workflows/ci.yml` y `backup.yml`. |

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
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | SMS. Sin `TWILIO_SMS_FROM` el cron no toca ningún recordatorio. |
| `ALERTA_WEBHOOK_URL` (opcional) | Destino del cron de salud. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (opcionales) | Errores. |
| `LEASE_MINUTES`, `MAX_INTENTOS_PROCESAMIENTO`, `CONTEXTO_DESDE` (opcionales) | Lease del worker y fecha de corte del contexto longitudinal. |
| `SEED_SECRET`, `SEED_USER_PASSWORD` | Solo desarrollo. No en producción. |

Railway (worker): ver `processor/.env.example`. Incluye `PROCESSING_SECRET`,
credenciales R2 (`R2_ENDPOINT` con la URL del account), `ASSEMBLYAI_API_KEY`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`.

GitHub Actions:

| Secret | Para qué |
| --- | --- |
| `DATABASE_URL` | Origen del `pg_dump` (Neon `production`). |
| `DATABASE_URL_TEST` | Rama `test` de Neon para el job de tests. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | Subida del backup. |
| `BACKUP_ENCRYPTION_KEY` | Passphrase gpg del backup. Guardar copia offline. |
| `BACKUP_ALERT_WEBHOOK` (opcional) | Aviso si el backup falla. |

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
| Twilio | Rotar el auth token de la subcuenta, cargar en Vercel. |
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
  porque todos los archivos de integración comparten la rama `test` y la
  vacían. No volver a activar el paralelismo.
- **Si el borrado del audio en R2 falla al aprobar**, la sesión igual se
  aprueba y `audioR2Key` se conserva para reintentar. La clave temporal se
  destruye siempre, así que el blob remanente es inaccesible.
- **CORS de R2.** Un 403 en el PUT del navegador casi siempre es CORS del
  bucket, no credenciales.


## 6. Migraciones de cuentas

Antes de desplegar el código nuevo, aplicar las migraciones pendientes con la
conexión **directa** de Neon (`-pooler` no debe aparecer). Nunca `migrate dev`
contra producción. En una terminal del dueño, con la URL de producción directa
cargada en `DATABASE_URL_PRODUCCION_DIRECTA` sin imprimirla:

```sh
DATABASE_URL="$DATABASE_URL_PRODUCCION_DIRECTA" npx prisma migrate status
DATABASE_URL="$DATABASE_URL_PRODUCCION_DIRECTA" npx prisma migrate deploy
DATABASE_URL="$DATABASE_URL_PRODUCCION_DIRECTA" npx prisma migrate status
npx prisma generate
```

Para test, el mismo `migrate deploy` con `DATABASE_URL` tomada de
`DATABASE_URL_TEST`, validando antes que sea `ep-floral-sound`, nunca
`ep-odd-night`, y usando conexión directa, como hace el helper de los tests.

Cada migración de cuentas trae un `rollback.sql` que elimina sólo su tabla
nueva. Se verifica en una transacción de test que luego hace rollback. Prisma
Migrate no aplica esos inversos automáticamente: para revertir un despliegue
normal alcanza con volver al código anterior y conservar las tablas aditivas.
No ejecutar los inversos sobre producción como rutina ni borrar el historial
`_prisma_migrations`.
