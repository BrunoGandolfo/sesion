# Reconstruir producción antes de la primera publicación del esquema nuevo

Procedimiento para Bruno. Preparado el 17 de septiembre de 2026 sobre main
c4d2baa. Se ejecuta **una sola vez**, antes de admitir pacientes reales.
No sirve para actualizar una base que ya tenga el esquema nuevo.

## Decisiones y punto sin retorno

Se descartan los datos actuales y el audio de prueba. Se crea una sola cuenta
real, a mano. No se ejecuta el seed.

**Camino elegido:** crear en Neon una rama hija llamada
`reconstruccion-produccion`, vaciar **esa copia**, aplicar las tres migraciones
y comprobarla. La rama anterior queda intacta para volver atrás. Al publicar se
cambian las conexiones a la rama nueva. Una rama de Neon es una copia de la
base; no es una rama de Git.

Neon permite aislar los cambios de una rama hija sin alterar la madre. Es más
seguro que vaciar directamente la conexión que usa hoy Vercel. No usar
«Reset from parent»: vuelve a traer el esquema viejo. Tampoco alcanza «Schema
only»: copia el esquema viejo sin sus filas. La opción elegida es **Current
data**, sin fecha de borrado automático.
[Documentación oficial de ramas](https://neon.com/docs/manage/branches).

- **Destructivo, recuperable:** vaciar `public` en la copia de Neon. Borra allí
  tablas, datos, tipos, funciones y `_prisma_migrations`, incluido el historial
  viejo. No modifica la rama madre ni R2. El respaldo permite recuperar la base.
- **IRREVERSIBLE — punto sin retorno del audio:** el primer borrado de objetos
  en R2 (§8). Los respaldos de Postgres no contienen audio. Una restauración
  posterior recuperará filas, no esos archivos. Por eso este paso va después
  de comprobar la base nueva y el respaldo.
- Publicar cambia código y conexiones; no vuelve recuperable el audio.
  Hasta completar §10 no se incorporan pacientes ni grabaciones nuevas.
- No se elimina la rama anterior ni el respaldo en esta operación. Son la
  vuelta atrás temporal, no datos que se vayan a importar a la base nueva.
  Su retirada posterior queda fuera de esta publicación; no cambiar la
  retención vigente de los respaldos.

**Regla para todos los bloques:** copiar completos, uno por vez, en la misma
terminal. Si aparece ERROR, una salida diferente a la indicada o se cierra la
terminal, **no continuar con el bloque siguiente**. Guardar el mensaje sin
credenciales. Los caminos de recuperación están en §11. No improvisar
`migrate resolve`, `db push`, `migrate reset` ni un avance forzado de release.

## 0. Preparar la terminal y fijar qué se publicará

Usar **Ubuntu/WSL con Bash**, en tu máquina; no PowerShell. Tener Node 22.18 o
posterior de la rama 22, npm, Git, GitHub CLI autenticado, Docker, Python 3,
AWS CLI v2, gpg y cliente Postgres 17. Los comandos de comprobación son:

<!-- bloque: herramientas -->
~~~bash
bash --version | head -1
node --version
npm --version
git --version
gh auth status
docker version --format '{{.Server.Version}}'
python3 --version
aws --version
gpg --version | head -1
psql --version
pg_restore --version
~~~

**Bien:** todos responden; Node v22.18 o mayor dentro de v22; psql y pg_restore
17; Docker tiene versión de servidor. **Si no:** instalar/arreglar esa
herramienta antes de seguir. No pegar valores de secrets en comandos, archivos
de Git ni capturas. Desactivar el registro de la terminal si lo hubiera.

Este documento tiene que estar fusionado a main y ese main debe tener su
**último CI de push** verde y la prueba del dueño en teléfono ya aprobada.
Un CI manual sobre la rama del documento no reemplaza ese requisito.

<!-- bloque: checkout -->
~~~bash
set -euo pipefail
set +x
umask 077
cd ~/proyectos/sesion-arreglos
test -z "$(git status --porcelain)" || { echo "ERROR: carpeta con cambios"; exit 1; }
git fetch origin
SHA_PUBLICAR="$(git rev-parse origin/main)"
SHA_ANTERIOR="$(git rev-parse origin/release)"
export SHA_PUBLICAR SHA_ANTERIOR
git merge-base --is-ancestor "$SHA_ANTERIOR" "$SHA_PUBLICAR"
CI="$(gh api --method GET repos/BrunoGandolfo/sesion/actions/workflows/ci.yml/runs \
  -f head_sha="$SHA_PUBLICAR" -f event=push -f branch=main -f per_page=1 \
  --jq '.workflow_runs[0] | [.head_sha, .status, .conclusion] | @tsv')"
test "$CI" = "$SHA_PUBLICAR"$'\tcompleted\tsuccess' \
  || { echo "ERROR: falta CI de push verde para este main"; exit 1; }
git worktree add --detach ../sesion-publicacion-operativa "$SHA_PUBLICAR"
cd ../sesion-publicacion-operativa
export REPO_PUBLICACION="$PWD"
export TRABAJO_PUBLICACION
TRABAJO_PUBLICACION="$(mktemp -d /tmp/sesion-publicacion.XXXXXX)"
printf 'SHA a publicar: %s\nSHA anterior: %s\nCarpeta privada: %s\n' \
  "$SHA_PUBLICAR" "$SHA_ANTERIOR" "$TRABAJO_PUBLICACION"
DATABASE_URL=postgresql://dummy:dummy@127.0.0.1:5432/dummy npm ci
~~~

**Bien:** muestra los dos SHA completos y termina la instalación. Anotar los
SHA y la carpeta privada. Si esa carpeta de worktree ya existe, parar: se está
retomando una operación; no borrarla ni repetir el alta a ciegas.

En Vercel, anotar la URL/id del despliegue de producción actual y comprobar que
ofrece **Instant Rollback**. En Railway, anotar el despliegue actual del worker
y comprobar que permite **Rollback**. No seguir si falta un destino recuperable.
Mantener **Publicar deshabilitado** hasta §9.

Cerrar las pestañas y PWA de prueba que puedan reanudar subidas. En Railway →
servicio worker → Deployments → despliegue activo → menú → **Remove**, detener
el proceso (no borrar el servicio, sus variables ni el despliegue anterior).
**Bien:** ya no hay instancia activa. **Si no:** no borrar audio. No hace falta
negociar una ventana: no hay usuarias reales. Este freno evita que un proceso
de prueba siga actuando mientras se comprueba R2.

## 1. Guardar las conexiones anteriores y preparar la copia de Neon

En el gestor de contraseñas conservar, con su nombre de entorno, las conexiones
actuales de Vercel `DATABASE_URL`, Actions `DATABASE_URL` (Backup) y Actions
`DATABASE_URL_PRODUCCION_DIRECTA` (Publicar). No hace falta mostrarlas.

En Neon → proyecto de Sesión → **Branches → New branch**:
elegir como madre la rama que usa producción, nombre
`reconstruccion-produccion`, **Current data**, y **desmarcar la eliminación
automática**. Crear. No elegir una rama de prueba por su nombre.
En **Connect**, elegir la misma base y el rol propietario; desactivar
**Connection pooling** y copiar la conexión de la rama nueva.

La contraseña puede coincidir entre ramas; lo que debe cambiar es el host.
Copiar también desde Neon la conexión **directa** de la rama anterior.

<!-- bloque: conexiones -->
~~~bash
read -rsp 'Conexión DIRECTA anterior de Neon: ' URL_ANTERIOR; printf '\n'
read -rsp 'Conexión DIRECTA de reconstruccion-produccion: ' URL_NUEVA; printf '\n'
read -rp 'Host de reconstruccion-produccion (solo ep-…neon.tech): ' HOST_NUEVO
export URL_ANTERIOR URL_NUEVA HOST_NUEVO
node --input-type=module <<'JS'
const vieja = new URL(process.env.URL_ANTERIOR);
const nueva = new URL(process.env.URL_NUEVA);
if (!nueva.hostname.endsWith(".neon.tech") ||
    nueva.hostname.includes("-pooler") || vieja.hostname.includes("-pooler") ||
    vieja.hostname === nueva.hostname || nueva.hostname !== process.env.HOST_NUEVO ||
    nueva.searchParams.get("sslmode") !== "require") {
  throw new Error("ERROR: conexión nueva no identificada, igual a la anterior o no directa");
}
console.log("Anterior:", vieja.hostname, vieja.pathname);
console.log("Nueva:", nueva.hostname, nueva.pathname);
JS
psql --dbname="$URL_NUEVA" -X -v ON_ERROR_STOP=1 -c \
  'SELECT current_database() AS base, current_user AS propietario, version();'
~~~

**Bien:** host nuevo diferente del anterior, coincide con Connect de la rama
nueva, base/propietario correctos y Postgres 17. **Si no:** parar y corregir la
selección en Neon. Nunca sustituir `URL_NUEVA` por la conexión vieja.

## 2. Descargar el respaldo existente y probar que se abre

Usar los nombres del catálogo: `R2_BUCKET` es el bucket de **respaldos**;
`R2_BUCKET_NAME` es el de **audio**. Pueden ser el mismo. En ese caso
`backups/` se conserva siempre.

Las credenciales de R2 se toman de la copia que conserva el dueño; GitHub
no permite recuperar el valor de un secret existente. No generar ni cambiar
credenciales para seguir este documento.

<!-- bloque: respaldo-descarga -->
~~~bash
read -rp 'Endpoint R2 (https://…r2.cloudflarestorage.com): ' R2_ENDPOINT
read -rp 'Bucket de respaldos (R2_BUCKET): ' R2_BUCKET
read -rp 'Bucket de audio (R2_BUCKET_NAME): ' R2_BUCKET_NAME
read -rsp 'R2 access key id: ' AWS_ACCESS_KEY_ID; printf '\n'
read -rsp 'R2 secret access key: ' AWS_SECRET_ACCESS_KEY; printf '\n'
export R2_ENDPOINT R2_BUCKET R2_BUCKET_NAME AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=auto AWS_PAGER=""
unset AWS_SESSION_TOKEN
aws s3api list-objects-v2 --endpoint-url "$R2_ENDPOINT" --bucket "$R2_BUCKET" \
  --prefix backups/sesion-backup- --output json > "$TRABAJO_PUBLICACION/respaldos.json"
BACKUP_KEY="$(python3 - <<'PY'
import json, os
from pathlib import Path
objetos = json.loads((Path(os.environ["TRABAJO_PUBLICACION"])/"respaldos.json").read_text()).get("Contents") or []
objetos = [o for o in objetos if o["Key"].endswith(".dump.gpg")]
if not objetos:
    raise SystemExit("ERROR: no hay copia diaria; no continuar")
print(max(objetos, key=lambda o: (o["LastModified"], o["Key"]))["Key"])
PY
)"
export BACKUP_LOCAL="$TRABAJO_PUBLICACION/anterior.dump.gpg"
aws s3 cp "s3://$R2_BUCKET/$BACKUP_KEY" "$BACKUP_LOCAL" \
  --endpoint-url "$R2_ENDPOINT" --only-show-errors
sha256sum "$BACKUP_LOCAL"
read -rsp 'Passphrase del respaldo: ' BACKUP_ENCRYPTION_KEY; printf '\n'
export BACKUP_ENCRYPTION_KEY
~~~

**Bien:** descarga sin errores y una huella de 64 caracteres. Guardar en el acta
la key elegida y la huella, no las credenciales. Si falta copia, falla gpg o
no se puede leer R2, no vaciar nada.

Restaurar primero en Docker. Esto no toca Neon:

<!-- bloque: respaldo-local -->
~~~bash
CONTENEDOR_ENSAYO="sesion-prepublicacion-$$"
export CONTENEDOR_ENSAYO
docker run -d --name "$CONTENEDOR_ENSAYO" -e POSTGRES_PASSWORD=ensayo-local \
  -p 127.0.0.1::5432 postgres:17
for i in {1..30}; do
  if docker exec "$CONTENEDOR_ENSAYO" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
PUERTO_ENSAYO="$(docker port "$CONTENEDOR_ENSAYO" 5432/tcp | sed 's/.*://')"
export URL_ENSAYO="postgresql://postgres:ensayo-local@127.0.0.1:$PUERTO_ENSAYO/postgres"
scripts/ensayo/restaurar.sh "$BACKUP_LOCAL" "$URL_ENSAYO"
psql --dbname="$URL_ENSAYO" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sesiones_clinicas'
    AND column_name='nota_soap_encrypted'
) AS esquema_anterior;
SELECT 'usuarios' AS tabla, count(*) AS filas FROM usuarios
UNION ALL SELECT 'pacientes', count(*) FROM pacientes
UNION ALL SELECT 'turnos', count(*) FROM turnos
UNION ALL SELECT 'sesiones_clinicas', count(*) FROM sesiones_clinicas;
SQL
~~~

**Bien:** `restaurado …`, `esquema_anterior = t` y cuatro conteos. Cero sesiones
es admisible para estos datos descartables. Esto prueba descifrado del **dump**,
índice y restauración SQL, no descifrado de notas clínicas ni recuperación de
audio. Conservar también el llavero histórico y `NOTES_ENCRYPTION_KEY` de la
versión anterior: gpg no los reemplaza.

Si aparece `f`, una tabla falta o la restauración falla, parar. No usar una
copia de esquema desconocido. El ensayo clínico completo de
[operaciones](../operaciones.md#4-backup-y-restauración) es independiente:
exige muestras clínicas y por eso puede rechazar una base de prueba vacía.

## 3. Vaciar únicamente la copia de Neon — DESTRUCTIVO

Comprobar otra vez en pantalla el destino. El permiso de propietario es necesario.

<!-- bloque: vaciar -->
~~~bash
export DATABASE_URL="$URL_NUEVA"
node --input-type=module <<'JS'
const u = new URL(process.env.DATABASE_URL);
if (u.hostname !== process.env.HOST_NUEVO ||
    u.hostname === new URL(process.env.URL_ANTERIOR).hostname) {
  throw new Error("ERROR: destino no autorizado");
}
console.log("Se vacía únicamente:", u.hostname, u.pathname);
JS
read -rp 'Escribí VACIAR COPIA para continuar: ' CONFIRMACION
test "$CONFIRMACION" = 'VACIAR COPIA' || { echo "Cancelado"; exit 1; }
psql --dbname="$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION CURRENT_USER;
COMMIT;
SELECT count(*) AS tablas_restantes
FROM information_schema.tables WHERE table_schema='public';
SELECT to_regclass('public._prisma_migrations') IS NULL AS historial_eliminado;
SQL
~~~

**Bien:** COMMIT, `tablas_restantes = 0`, `historial_eliminado = t`.
Los avisos de objetos eliminados por CASCADE son esperados. Si falla antes de
COMMIT, se revierte esa transacción. Si se cortó la conexión sin saber el
resultado, repetir solo las dos consultas SELECT para conocerlo; no asumir
que se ejecutó. Con otro resultado no migrar.

Esto elimina el historial viejo de **la copia**; no se marcan como aplicadas
migraciones que nunca corrieron. No se corre este bloque después de empezar a
usar la aplicación ni para arreglar una migración fallida a ciegas.

## 4. Crear el esquema nuevo

<!-- bloque: migrar -->
~~~bash
DATABASE_URL="$URL_NUEVA" npx prisma migrate deploy
DATABASE_URL="$URL_NUEVA" npx prisma migrate status
psql --dbname="$URL_NUEVA" -X -v ON_ERROR_STOP=1 -c \
  'SELECT migration_name, finished_at IS NOT NULL AS terminada, rolled_back_at IS NULL AS vigente FROM "_prisma_migrations" ORDER BY migration_name;'
~~~

**Bien:** `Database schema is up to date!` y estas tres filas, ambas columnas
en `t`:

1. `0_init`
2. `20260915190000_audio_inicio_ms`
3. `20260916013000_inmutabilidad`

Si falla, no habilitar Publicar. La copia puede haber quedado a medias:
abandonar esa copia y usar §11, no reparar el historial manualmente.

## 5. Crear la primera cuenta, sin seed

El registro de la app exige una invitación creada por una usuaria existente.
En una base vacía eso no puede crear la primera cuenta. Este bloque crea
solamente organización, usuaria titular, configuración y un evento que dice
**alta manual**; no inventa una invitación ni aceptación de términos.
La profesional debe leer los términos publicados con el dueño antes del uso;
esta operación administrativa no equivale a su aceptación digital.

El correo y nombre son los reales. La contraseña la elige la profesional:
mínimo diez caracteres, máximo 72 bytes. No se imprime ni se guarda en archivo.

<!-- bloque: cuenta -->
~~~bash
read -rp 'Nombre de la profesional: ' NOMBRE_PROFESIONAL
read -rp 'Correo de la profesional: ' EMAIL_PROFESIONAL
read -rsp 'Contraseña elegida por la profesional: ' PASSWORD_PROFESIONAL; printf '\n'
read -rsp 'Repetí la contraseña: ' PASSWORD_REPETIDA; printf '\n'
test "$PASSWORD_PROFESIONAL" = "$PASSWORD_REPETIDA" || { echo "ERROR: no coinciden"; exit 1; }
unset PASSWORD_REPETIDA
export NOMBRE_PROFESIONAL EMAIL_PROFESIONAL PASSWORD_PROFESIONAL
DATABASE_URL="$URL_NUEVA" node --input-type=module <<'JS'
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { BCRYPT_RONDAS, validarPasswordNueva } from "./src/lib/password.ts";
const nombre = process.env.NOMBRE_PROFESIONAL.trim();
const email = process.env.EMAIL_PROFESIONAL.trim().toLowerCase();
const password = process.env.PASSWORD_PROFESIONAL;
if (!nombre || nombre.length > 120 || !z.string().email().max(254).safeParse(email).success)
  throw new Error("ERROR: nombre o correo inválido");
const validacion = validarPasswordNueva(password);
if (!validacion.ok) throw new Error(validacion.motivo);
const hashedPassword = await bcrypt.hash(password, BCRYPT_RONDAS);
const db = new PrismaClient();
try {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "usuarios", "organizaciones" IN EXCLUSIVE MODE');
    if (await tx.user.count() || await tx.organization.count())
      throw new Error("ERROR: ya existe una cuenta u organización; no se modifica");
    const org = await tx.organization.create({ data: { nombre: "Consultorio de " + nombre } });
    const user = await tx.user.create({
      data: { nombre, email, hashedPassword, organizationId: org.id, rol: "titular" }
    });
    await tx.configuracion.create({
      data: { organizationId: org.id, nombreProfesional: nombre, tarifaDefault: 0 }
    });
    await tx.eventoAuditoria.create({
      data: { organizationId: org.id, actorTipo: "sistema",
        accion: "cuenta.alta_manual", entidad: "usuario", entidadId: user.id,
        detalle: { procedimiento: "reconstruccion-produccion", aceptaTerminos: false } }
    });
  });
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  if (!await bcrypt.compare(password, user.hashedPassword)) throw new Error("ERROR: contraseña no verificable");
  console.log("OK: una profesional, una organización, una configuración; contraseña verificada.");
} finally { await db.$disconnect(); }
JS
unset PASSWORD_PROFESIONAL
~~~

**Bien:** mensaje OK. Node puede agregar un aviso `MODULE_TYPELESS_PACKAGE_JSON`:
no es un fallo del alta y no hay que editar package.json para quitarlo.
Si dice que ya existe una cuenta, no actualizarla ni
borrarla: consultar §6. Si la cuenta anterior es la esperada, continuar; si no,
parar. La tarifa queda en cero y los demás valores son los predeterminados del
registro: completarlos en Configuración después de publicar, antes de atender.

## 6. Comprobar la base nueva ANTES de publicar

<!-- bloque: verificar -->
~~~bash
DATABASE_URL="$URL_NUEVA" npx prisma migrate status
DATABASE_URL="$URL_NUEVA" npx prisma migrate diff \
  --from-url "$URL_NUEVA" --to-schema-datamodel prisma/schema.prisma --exit-code
psql --dbname="$URL_NUEVA" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'organizaciones' AS tabla, count(*) AS filas FROM organizaciones
UNION ALL SELECT 'usuarios', count(*) FROM usuarios
UNION ALL SELECT 'configuraciones', count(*) FROM configuraciones
UNION ALL SELECT 'pacientes', count(*) FROM pacientes
UNION ALL SELECT 'turnos', count(*) FROM turnos
UNION ALL SELECT 'sesiones_clinicas', count(*) FROM sesiones_clinicas
UNION ALL SELECT 'audio_segmentos', count(*) FROM audio_segmentos
UNION ALL SELECT 'hilo_versiones', count(*) FROM hilo_versiones
UNION ALL SELECT 'trabajos', count(*) FROM trabajos
UNION ALL SELECT 'envios_sms', count(*) FROM envios_sms;
SELECT email, nombre, rol FROM usuarios;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='audio_segmentos' AND column_name='inicio_ms';
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
  AND tgrelid IN ('public.eventos_auditoria'::regclass, 'public.hilo_versiones'::regclass)
ORDER BY tgname;
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN
  ('hilo_una_propuesta_abierta', 'hot_words_sin_paciente_unico') ORDER BY indexname;
SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='c'
ORDER BY conname;
SQL
~~~

**Bien, sin excepciones:**

- Estado al día y `No difference detected.`, salida 0. Una diferencia devuelve
  2: no es una advertencia aceptable.
- Organizaciones, usuarios y configuraciones: **1** cada una. Las otras siete
  tablas de la consulta: **0**. Correo y nombre coinciden con la profesional.
- `inicio_ms | double precision | YES`, default vacío.
- Tres triggers: `eventos_auditoria_inmutable`,
  `hilo_versiones_contenido_inmutable`, `hilo_versiones_sin_borrado`.
- Los dos índices pedidos.
- Cinco CHECK: `audio_segmentos_bytes_check`,
  `audio_segmentos_indice_check`, `cupos_ayuda_usadas_check`,
  `hilo_versiones_version_check`, `turnos_duracion_check`.

Prisma no comprueba los triggers ni los índices parciales: por eso hay
consultas separadas. Si no coincide, parar antes del audio y de Publicar.
No usar aquí el verificador de respaldos como criterio de éxito: una base
nueva correctamente vacía no tiene las muestras clínicas que ese guion exige.

## 7. Preparar las conexiones de publicación, sin desplegar todavía

En GitHub → Settings → Secrets and variables → Actions, sustituir
**solo** `DATABASE_URL_PRODUCCION_DIRECTA` por la conexión directa nueva.
En Vercel → proyecto → Settings → Environment Variables → Production,
sustituir `DATABASE_URL` por la conexión de **esa misma rama y base**.
Guardar, **sin hacer Redeploy del código viejo**. La variable no cambia el
despliegue viejo ya construido; la usará el despliegue nuevo.

No cambiar todavía el secret `DATABASE_URL` de Backup: se cambia en §10.
No rotar ni quitar llaveros. Antes de seguir, comprobar por **nombres**, en
Vercel, las variables obligatorias de `.env.example` para el main que se va
a publicar, en especial `CLAVES_CIFRADO`, `PROCESSING_SECRET`,
`R2_PUBLIC_HOST`, correo, cron y Twilio. En Railway comprobar las de
`processor/.env.example`; el worker usa la API, no una URL de Postgres.

**Bien:** el próximo deploy de Vercel y Publicar apuntarán a la misma rama
nueva; la aplicación vieja y Backup siguen apuntando a la anterior.
**Si falla:** no continuar; restaurar los dos valores anteriores desde el
gestor. Nunca pegar una URL en una captura para comprobarlo.

## 8. Borrar el audio de prueba — IRREVERSIBLE

No grabar ni abrir una pestaña antigua durante este paso. Worker sigue detenido.
El código de release d02ae0e usaba `audio/<org>/<sesión>/<turno>.enc`;
el nuevo usa `<org>/<sesión>/<índice>`. Se borran esos dos formatos,
**no todo el bucket**. Si aparece otro formato, se detiene el procedimiento
para identificarlo; no se decide que es audio por descarte.

Primero inventariar todo el bucket (AWS pagina automáticamente):

<!-- bloque: audio-inventario -->
~~~bash
aws s3api list-objects-v2 --endpoint-url "$R2_ENDPOINT" --bucket "$R2_BUCKET_NAME" \
  --output json > "$TRABAJO_PUBLICACION/objetos-antes.json"
python3 - <<'PY'
import json, os, re
from pathlib import Path
carpeta = Path(os.environ["TRABAJO_PUBLICACION"])
objetos = json.loads((carpeta/"objetos-antes.json").read_text()).get("Contents") or []
audio, desconocidos, respaldos = [], [], []
for o in objetos:
    k = o["Key"]
    if k.startswith("backups/"):
        respaldos.append(o)
    elif re.fullmatch(r"audio/[^/]+/[^/]+/[^/]+\.enc", k) or re.fullmatch(r"[^/]+/[^/]+/[0-9]+", k):
        audio.append(k)
    else:
        desconocidos.append(k)
if desconocidos:
    print("ERROR: objetos de formato desconocido; no borrar:", *desconocidos, sep="\n")
    raise SystemExit(1)
(carpeta/"audio-a-borrar.json").write_text(json.dumps(audio))
print("Audio a borrar:", len(audio), "| Respaldos que se conservan:", len(respaldos))
print(*audio, sep="\n")
PY
~~~

**Bien:** solo las grabaciones de prueba reconocidas, con el número a borrar.
Cero es válido. Si el listado falla, no significa bucket vacío. Si hay objetos
desconocidos, detenerse; no ampliar el filtro durante la operación.

**El bloque siguiente cruza el punto sin retorno del audio.** El dump no permite
deshacerlo, aunque la base se restaure. Se borra una lista cerrada; si falla a
mitad, algunos objetos ya desaparecieron y se reintenta la misma lista.

<!-- bloque: audio-borrar -->
~~~bash
read -rp 'Escribí BORRAR AUDIO DE PRUEBA para continuar: ' CONFIRMACION
test "$CONFIRMACION" = 'BORRAR AUDIO DE PRUEBA' || { echo "Cancelado"; exit 1; }
python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
keys = json.loads((Path(os.environ["TRABAJO_PUBLICACION"])/"audio-a-borrar.json").read_text())
for key in keys:
    if key.startswith("backups/"):
        raise SystemExit("ERROR: se intentó borrar un respaldo")
    subprocess.run(["aws", "s3api", "delete-object", "--endpoint-url", os.environ["R2_ENDPOINT"],
                    "--bucket", os.environ["R2_BUCKET_NAME"], "--key", key], check=True,
                   stdout=subprocess.DEVNULL)
print("OK: se solicitaron", len(keys), "borrados; falta comprobar el listado.")
PY
aws s3api list-objects-v2 --endpoint-url "$R2_ENDPOINT" --bucket "$R2_BUCKET_NAME" \
  --output json > "$TRABAJO_PUBLICACION/objetos-despues.json"
python3 - <<'PY'
import json, os
from pathlib import Path
p = Path(os.environ["TRABAJO_PUBLICACION"])
antes = json.loads((p/"objetos-antes.json").read_text()).get("Contents") or []
despues = json.loads((p/"objetos-despues.json").read_text()).get("Contents") or []
restantes = [o["Key"] for o in despues if not o["Key"].startswith("backups/")]
def respaldos(xs):
    return {(o["Key"], o["Size"], o["ETag"]) for o in xs if o["Key"].startswith("backups/")}
if restantes or not respaldos(antes).issubset(respaldos(despues)):
    raise SystemExit("ERROR: queda audio/otro objeto o cambió un respaldo; no publicar")
print("OK: cero objetos fuera de backups/; respaldos anteriores conservados.")
PY
~~~

**Bien:** último OK. **Si no:** mantener cerrado el uso y no publicar. Repetir
el listado; si quedan los mismos objetos, repetir solo el bloque de borrado y
comprobación. Si aparece audio nuevo, cerrar la pestaña/proceso que sube y
reiniciar §8 desde el inventario. No cambiar la política de retención del bucket.
Un respaldo eliminado por su retención durante la comprobación también obliga
a detenerse y verificar el motivo; no se lo atribuye a la limpieza sin evidencia.

## 9. Recién ahora habilitar y ejecutar Publicar

Todos los resultados de §§2–8 deben estar bien. El SHA no se cambia aunque
hayan llegado otros commits a main.

<!-- bloque: publicar -->
~~~bash
gh workflow enable publicar.yml --repo BrunoGandolfo/sesion
gh workflow run publicar.yml --ref main --repo BrunoGandolfo/sesion -f sha="$SHA_PUBLICAR"
gh run list --workflow publicar.yml --event workflow_dispatch --limit 3 \
  --repo BrunoGandolfo/sesion
read -rp 'ID de la corrida que acabás de iniciar: ' CORRIDA_PUBLICAR
gh run watch "$CORRIDA_PUBLICAR" --exit-status --repo BrunoGandolfo/sesion
git fetch origin
test "$(git rev-parse origin/release)" = "$SHA_PUBLICAR" \
  || { echo "ERROR: release no coincide"; exit 1; }
printf 'OK: release en %s\n' "$SHA_PUBLICAR"
~~~

**Bien:** Publicar verde, paso de migraciones sin pendientes (ya se aplicaron
en §4) y release exactamente en el SHA elegido. Ver también en la corrida el
valor de entrada `sha` para no confundirla con otra.
En Vercel esperar **Ready / Production** para ese mismo commit.
No avanzar release a mano. Ante rojo, seguir §11 según hasta dónde llegó.

## 10. Comprobar el despliegue y cerrar

Abrir una ventana privada en `https://sesionapp.app`, entrar con la cuenta
nueva y comprobar Hoy, Agenda, Pacientes y Cobros vacíos; Configuración muestra
a la profesional. Completar allí sus datos, orientación y tarifa antes del uso.
No crear datos ficticios en esta base para demostrar que está vacía.

<!-- bloque: salud -->
~~~bash
curl --fail-with-body --silent --show-error https://sesionapp.app/api/health
~~~

**Bien:** HTTP exitoso, `status: "ok"` y `commit` igual a los primeros siete
caracteres de `SHA_PUBLICAR`. Si devuelve 503, no declarar éxito aunque el login
ande: el motivo se busca en los logs de Vercel (la respuesta pública no lo
detalla); corregir la configuración o seguir §11.

En Railway, desplegar el worker del **mismo SHA** de esta publicación y comprobar
que termina correctamente; en Source la rama de publicación debe ser `release`,
y el directorio del servicio `processor`. Reanudarlo solo después de Vercel.
No usar el worker viejo con los contratos nuevos. Verificar su latido:

<!-- bloque: latido -->
~~~bash
psql --dbname="$URL_NUEVA" -X -v ON_ERROR_STOP=1 -c \
  'SELECT version, ultimo_poll_en, now() - ultimo_poll_en AS antiguedad FROM worker_estado;'
~~~

**Bien:** una fila cuyo `ultimo_poll_en` se actualiza y tiene menos de dos
minutos de antigüedad. Repetir la consulta después de un minuto. Si no aparece
o no cambia, detener el worker y leer sus logs; no dar la publicación por buena.

Ahora cambiar Actions → secret **`DATABASE_URL` de Backup** a la conexión nueva.
Conservar `DATABASE_URL_PRODUCCION_DIRECTA` nueva y `DATABASE_URL` nueva de
Vercel. No cambiar llaveros ni `CLAVES_CIFRADO_IDS`: los respaldos anteriores
siguen necesitándolos. No ejecutar Backup ni Ensayo desde este procedimiento.

Cerrar la terminal elimina las variables en memoria; primero borrar el
contenedor local del ensayo, que contiene la copia de prueba del respaldo:

<!-- bloque: cerrar -->
~~~bash
docker stop "$CONTENEDOR_ENSAYO"
docker rm -v "$CONTENEDOR_ENSAYO"
unset DATABASE_URL URL_NUEVA URL_ANTERIOR BACKUP_ENCRYPTION_KEY \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY PASSWORD_PROFESIONAL
~~~

**Bien:** ambos comandos muestran el nombre del contenedor. `-v` elimina
también su volumen anónimo: no deja la base restaurada en claro en Docker.
Hacer esta limpieza también al abandonar el procedimiento por un fallo.
Si el contenedor ya no existe pero quedó su volumen, no usar `volume prune`:
identificar el volumen de ese ensayo antes de eliminarlo, sin tocar otros.

Guardar el dump **cifrado** y su huella en el lugar protegido de respaldos del
dueño. No subirlo a Git. El acta de publicación registra SHA, migraciones,
conteos, resultado de limpieza R2, corrida Publicar, despliegues y verificaciones,
sin URLs de base, contraseñas ni claves.

**Límite de esta comprobación:** cuenta, esquema, configuración y latido no
prueban micrófono, CORS, transcripción ni entrega de SMS. Las pruebas de teléfono
del SHA elegido son requisito previo (§0); cualquier comprobación posterior
de esos proveedores se registra aparte, no se da por hecha.

## 11. Volver atrás si falla

### A. Antes de ejecutar Publicar (o Publicar falló sin avanzar release)

La rama anterior de Neon sigue intacta y el despliegue viejo sigue usándola.
Volver a poner los valores anteriores de Vercel `DATABASE_URL` y Actions
`DATABASE_URL_PRODUCCION_DIRECTA`. Si se llegó a cambiar Backup, restituir
también su `DATABASE_URL`. Mantener Publicar deshabilitado:

~~~bash
gh workflow disable publicar.yml --repo BrunoGandolfo/sesion
git fetch origin
test "$(git rev-parse origin/release)" = "$SHA_ANTERIOR" \
  || { echo "ERROR: release avanzó: seguir caso B"; exit 1; }
~~~

**Bien:** release anterior. No hace falta restaurar encima de una base intacta.
Dejar worker detenido si el audio se borró: sus trabajos viejos podrían pedir
archivos que ya no existen. No inventar archivos silenciosos ni reintentos.

### B. Release avanzó, pero Vercel o las comprobaciones fallaron

Deshabilitar Publicar con el comando anterior; no retroceder Git ni usar force.
En Vercel → Deployments, seleccionar el despliegue anterior anotado en §0 →
**Instant Rollback**. Conserva las variables de aquel despliegue: vuelve a la
conexión vieja, no toma automáticamente las recién editadas. Restaurar también
los valores en Settings para no perderlos en un deploy posterior.
[Comportamiento oficial de Vercel](https://vercel.com/docs/instant-rollback).

Mantener el worker detenido; si se necesita volver a su versión anterior,
Railway → Deployments → despliegue anotado → **Rollback** restaura imagen y
variables, pero no recupera R2.
[Comportamiento oficial de Railway](https://docs.railway.com/deployments/deployment-actions).

**Bien:** Vercel sirve el despliegue anterior con la base anterior. release puede
seguir en el SHA nuevo: registrar esa diferencia; no ejecutar Publicar de nuevo
hasta corregir la causa y volver a comprobar el procedimiento. Esto recupera
el servicio de prueba, no autoriza uso real ni otra publicación automática.
Vercel además deja suspendida la asignación automática del dominio tras un
rollback. Al retomar, después de corregir y verificar, usar **Undo Rollback**
para promover el despliegue correcto y reactivar esa asignación; un push a
release por sí solo no la reactiva.

### C. La base anterior también se perdió: restaurar el respaldo existente

Este caso no debería producirlo el camino elegido. Recuperar en una base
**vacía y separada**: Neon → misma rama anterior → Databases → Add database,
nombre `sesion_recuperada`, propietario actual. No restaurar sobre el esquema
nuevo ni sobre tablas a medio crear.
[Crear una base en Neon](https://neon.com/docs/manage/databases).

Copiar su conexión directa de Connect. Se utiliza el archivo ya verificado en
§2, no un respaldo posterior de la base nueva. Si cambió la terminal, volver
a la carpeta operativa y cargar `BACKUP_LOCAL` y la passphrase de §2.

<!-- bloque: restaurar-neon -->
~~~bash
read -rsp 'Conexión DIRECTA de sesion_recuperada: ' URL_RECUPERACION; printf '\n'
export URL_RECUPERACION
node --input-type=module <<'JS'
const u = new URL(process.env.URL_RECUPERACION);
if (u.pathname !== "/sesion_recuperada" || u.hostname.includes("-pooler"))
  throw new Error("ERROR: no es el destino de recuperación");
console.log("Recuperación:", u.hostname, u.pathname);
JS
TABLAS="$(psql --dbname="$URL_RECUPERACION" -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
test "$TABLAS" = 0 || { echo "ERROR: recuperación no vacía"; exit 1; }
scripts/ensayo/restaurar.sh "$BACKUP_LOCAL" "$URL_RECUPERACION"
psql --dbname="$URL_RECUPERACION" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) AS columna_del_esquema_anterior
FROM information_schema.columns
WHERE table_schema='public' AND table_name='sesiones_clinicas'
  AND column_name='nota_soap_encrypted';
SELECT 'usuarios' AS tabla, count(*) AS filas FROM usuarios
UNION ALL SELECT 'pacientes', count(*) FROM pacientes
UNION ALL SELECT 'turnos', count(*) FROM turnos
UNION ALL SELECT 'sesiones_clinicas', count(*) FROM sesiones_clinicas;
SQL
~~~

**Bien:** restaurado, columna = 1, mismos cuatro conteos que en §2. Restaura
también el historial viejo de migraciones si estaba en el dump. No aplicar las
migraciones nuevas sobre esta recuperación.

Si falla la restauración, no reintentar encima: crear otra base vacía con el
mismo nombre después de eliminar **solo la recuperación fallida desde Neon**.
No borrar la original ni la nueva preparada. Si no se puede identificar cuál
es, detenerse.

Para servir esta recuperación hace falta el **código anterior**: Vercel →
despliegue anterior anotado → Redeploy usando las variables actuales, después
de poner su `DATABASE_URL` en la conexión recuperada y conservar las claves
de cifrado anteriores. Comprobar que el SHA desplegado sea `SHA_ANTERIOR`.
Actualizar Backup a esa conexión; Publicar queda deshabilitado. No conectar
el código nuevo al esquema restaurado. Si Vercel no ofrece el despliegue
anterior o su recompilación falla, detenerse: la base quedó recuperada, pero
el servicio todavía no. No hacer un force a release para resolverlo.

**Después del punto sin retorno:** incluso con restauración SQL exitosa, los
audios borrados no vuelven. Las referencias de prueba restauradas pueden
apuntar a objetos inexistentes. Mantener el worker detenido. No se debe
presentar esta recuperación como una recuperación completa del audio.

## Evidencia y límites de las pruebas de este documento

Ver [prueba local del procedimiento](prueba-reconstruccion.md).
Los pasos de Neon, R2, cambios de secretos, Publicar, Vercel y Railway se
documentan para ejecución posterior del dueño: no se ejecutaron al redactar.
