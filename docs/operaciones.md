# Operaciones

Dónde vive cada pieza, qué secretos existen, cómo se rotan, cómo se restaura
un backup y qué trampas ya nos mordieron. Solo nombres de variables, nunca
valores.

## 1. Dónde vive cada pieza

| Pieza | Servicio | Cómo se despliega |
| --- | --- | --- |
| App Next.js 16 (UI + API + crons) | Vercel | Push a `main` → deploy automático. Crons en `vercel.json`: `/api/cron/recordatorios` cada 5 min, `/api/cron/salud` cada hora, `/api/cron/mantenimiento` diario a las 04:00 UTC (pendiente de agregar a `vercel.json`: área 5, ver `docs/pendientes/03-identidad.md`). |
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
| `RESEND_API_KEY` | Correo transaccional por Resend. Dominio `sesionapp.app` verificado; remitente `no-responder@sesionapp.app`. Sin clave se registra el fallo sin revelar si existe la cuenta. |
| `CLAVES_CIFRADO` | Llavero del cifrado en reposo, `"1=<base64>,2=<base64>"` (`docs/encryption.md`). No hay secreto de sesión: las sesiones son filas de `sesiones_acceso`. |
| `INVITACIONES_PERMITIDAS` | TEMPORAL. Emails de las cuentas que pueden crear invitaciones (tope de 2 vigentes por cuenta, constante `MAX_INVITACIONES_VIGENTES`). Sin la variable nadie invita. |
| `PROCESSING_SECRET` | Bearer con el que el worker reclama trabajo. Acepta lista separada por comas. Mismo valor en Railway. |
| `CRON_SECRET` | Bearer de los crons. Acepta lista separada por comas. |
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
| `PROCESSING_SECRET` | Sin ventana de 401: en Vercel `"viejo,nuevo"` y deploy; en Railway `"nuevo"` y redeploy; en Vercel `"nuevo"` y deploy. |
| `CRON_SECRET` | Igual que `PROCESSING_SECRET` (lista). Vercel Cron manda el valor vigente de la variable. |
| `CLAVES_CIFRADO` | En caliente: agregar `,2=<nueva>` con `printf`, deploy; el cron de mantenimiento re-cifra 200 filas por corrida (`GET /api/cron/mantenimiento?recifrar=todo` con el `CRON_SECRET` para apurar); cuando `pendientes` da 0, sacar `1=…` y deploy. Procedimiento completo en `docs/encryption.md` §3. |
| Sesiones de la profesional | No hay secreto que rotar. Desde Configuración, "Cerrar sesión en los demás dispositivos"; o cambiar la contraseña, que cierra todas. Ver §7. |
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
   correr la consulta por id de clave de `docs/encryption.md` §4.
5. Apuntar la app a esa rama solo si el objetivo es reemplazar producción.
   `CLAVES_CIFRADO` tiene que contener todas las claves con las que se
   cifraron los datos del dump (por eso una clave rotada se conserva 30 días
   más, lo que duran los backups).

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


## 6. Esquema y migraciones

La base tiene una sola migración inicial (`prisma/migrations/0_init`,
`docs/esquema.md`). Contra `production` solo `prisma migrate deploy` por la
conexión directa (`-pooler` no debe aparecer); nunca `migrate dev`. Los
índices parciales y los CHECK escritos a mano están al final de la migración
en un bloque marcado "A MANO".

Cuentas, en el esquema nuevo:

- `sesiones_acceso`: una fila por dispositivo entrado (hash del token de la
  cookie, creación, último uso, vencimiento, cierre y motivo, IP y navegador
  de la creación). Cerrar sesión cierra la fila; cambiar o restablecer la
  contraseña cierra todas. Vigente = no cerrada, no vencida (30 días) y con
  uso en los últimos 14 días.
- `intentos_acceso`: solo intentos fallidos (login, contraseña, recuperación)
  con IP; es el contador de bloqueo. Purga a 30 días.
- `password_resets`: hash del enlace, vencimiento, uso y `enviado_en`; una
  fila cuyo correo no salió no vale ni cuenta para el cupo de 3 por hora.
- `invitaciones`: hash, vencimiento (7 días), uso y creadora. Solo las
  cuentas de `INVITACIONES_PERMITIDAS`, con tope de 2 vigentes (TEMPORAL).
- La aceptación de términos queda en el evento `cuenta.registro`, con su
  versión, dentro de la transacción de alta. No se registra el email ni el
  token. `eventos_auditoria` no lleva IP ni navegador: eso vive en las dos
  tablas de arriba, con purga.

Antes de ofrecer el acceso, el dueño debe terminar la verificación del dominio
`sesionapp.app` en Resend y revisar el texto de `/terminos` (constantes
`TERMINOS_*` de `glosario.ts`, actualizando también `TERMINOS_VERSION`). Con el
dominio verificado, probar un correo real y una recuperación completa.

## 7. Incidentes de identidad y cifrado

### "Creo que se filtró un token de sesión"

No hay un secreto que firme sesiones: lo que se puede filtrar es la cookie de
un dispositivo. Un volcado de `sesiones_acceso` no sirve para entrar (solo
hashes).

1. Desde Configuración: "Cerrar sesión en los demás dispositivos". Si no se
   puede entrar, en Neon:
   `UPDATE sesiones_acceso SET cerrada_en = now(), motivo_cierre = 'incidente' WHERE cerrada_en IS NULL;`
2. Cambiar la contraseña (cierra todo otra vez, incluida la propia).
3. Mirar `sesiones_acceso` de los últimos 30 días: IPs y navegadores que no
   sean de ella.
4. Fuera de servicio: nada. Ella entra de nuevo una vez.

### "Creo que se filtró CLAVES_CIFRADO"

Lo que ya se copió de la base no se puede des-filtrar: rotar protege lo que
venga. Por eso hay que actuar rápido y averiguar si también se filtró la base.

1. Generar clave nueva (`openssl rand -base64 32`), agregar `,N+1=…` a
   `CLAVES_CIFRADO` en Vercel con `printf`, deploy. Nada queda fuera de
   servicio.
2. Forzar el re-cifrado: `GET /api/cron/mantenimiento?recifrar=todo` con el
   `CRON_SECRET`, repetir hasta `pendientes: 0`. Verificar con la consulta de
   `docs/encryption.md` §4.
3. Sacar la clave vieja de la variable, deploy. Destruirla del gestor.
4. Backups: si solo se filtró la clave, los backups siguen protegidos por
   `BACKUP_ENCRYPTION_KEY`. Si hay sospecha de que también se filtró la
   passphrase gpg o el acceso a R2: borrar los backups anteriores al paso 3,
   tomar uno nuevo a mano, rotar `BACKUP_ENCRYPTION_KEY` y las credenciales
   de R2.
5. Si el vector fue Vercel entero, rotar también `PROCESSING_SECRET`,
   `CRON_SECRET` y las credenciales de R2.
6. Registrar acá fecha, alcance y qué se rotó. Si hay indicios de que la base
   también se copió, es una brecha de datos sensibles y aplica la obligación
   de notificar (Ley 18.331 / URCDP); lo decide el abogado.

### "Creo que se filtró PROCESSING_SECRET"

Con el secreto solo se reclama trabajo: sesiones en `procesando` (clave del
audio, inútil sin R2) y los tickets con los que sí se puede escribir un
resultado falso en esas sesiones. No se lee ni escribe nada más.

1. Rotar sin ventana (§3). Fuera de servicio: nada.
2. Buscar en `eventos_auditoria` los resultados del worker del período
   sospechoso con versión de worker o de prompt desconocida: esas sesiones
   pueden tener notas falsas. Las que estén en `revision` se descartan y
   reprocesan; las ya aprobadas se revisan a mano con la profesional.
3. Si el vector fue Railway (variables juntas): rotar también
   `ASSEMBLYAI_API_KEY`, `ANTHROPIC_API_KEY` y las credenciales de R2.
