# Ensayo manual de restauración: procedimiento para el dueño

Para correr **antes de vaciar la base de prueba** y, después, cada tres meses.
Es el único ensayo que prueba que la
historia clínica de un respaldo **se puede leer**: el automático
(`.github/workflows/ensayo-restauracion.yml`) restaura y cuenta, pero no tiene
ninguna clave clínica, a propósito, y no descifra nada.

Escrito el 26 de septiembre de 2026 sobre `main` en `a6f6e74`, leyendo el repo
y GitHub Actions. Nada de esto se corrió con secretos: lo que depende de ellos
está marcado como **no verificado** en §7. Actualizado el 6 de octubre: el
contrato de esquema lo elige la última migración de la copia, el checkout es
de `release` y existen las claves históricas (§3.4 y `docs/operaciones.md` §4,
"Cómo se juzga una copia"). **Ensayado en seco el 8 de octubre** contra
`release` = `445141f`: todos los bloques de §3, copiados tal cual de este
archivo, corrieron de punta a punta con copias, passphrase, llavero y R2
inventados (§7). Lo único que queda sin probar es lo que depende de los
secretos reales.

Qué hace, en una línea: bajar de R2 la copia diaria más reciente y la mensual
más vieja, descifrar cada una con gpg, restaurarla en un Postgres 17 local en
Docker, comprobar el esquema, filas y claves foráneas, **descifrar con el
llavero** la nota clínica y la versión del Recorrido más viejas y más nuevas
(`scripts/ensayo/ensayo-manual.sh`) y la transcripción más vieja y más nueva
(bloque de §3.5), y dejar un acta sin texto clínico.

**Qué hay en R2.** Producción se reconstruyó el 17-sep-2026: se vació el
esquema y se aplicó el nuevo (`prisma/migrations/0_init` y siguientes), con
cifrado **ENC2** y el llavero `CLAVES_CIFRADO`. Los logs de
`.github/workflows/backup.yml` lo muestran: la copia del 17-sep a las 11:26 UTC
(`backups/sesion-backup-2026-09-17-112606.dump.gpg`) todavía tiene 14 tablas
con datos, la del 18-sep ya tiene 22. Entonces:

- la diaria más reciente y la mensual `2026-09-22-112134` son del **esquema
  nuevo, ENC2**: se abren con el `CLAVES_CIFRADO` real de producción;
- las diarias hasta la `2026-09-17-112606` inclusive son de la base
  **anterior** (esquema `produccion-d02ae0e`, **ENC1**, clave
  `NOTES_ENCRYPTION_KEY`). La retención de 30 días las borra: la última
  desaparece con la corrida del respaldo del 17 o del 18 de octubre, según la
  hora. Este procedimiento ya no las ensaya (ver §1).

---

## 1. Secretos que hacen falta y de dónde salen

Ninguno se pega en un comando, un archivo del repo, el chat ni una captura.
Los cuatro secretos (las dos credenciales de R2, la passphrase y el llavero) se
cargan con `read -rs` al principio de §3.1, en la misma terminal, y se borran al
final (§3.7). Después de esas siete preguntas (cuatro secretas y tres que no lo
son) ningún bloque pide nada más.

| Variable en la terminal | Qué es | De dónde sale |
| --- | --- | --- |
| `R2_ENDPOINT` | `https://<accountId>.r2.cloudflarestorage.com` | Copia del dueño del secret de Actions del mismo nombre, o Cloudflare → R2 → la cuenta. No es secreto, pero tampoco va al acta. |
| `R2_BUCKET` | Bucket de **respaldos** (no confundir con `R2_BUCKET_NAME`, el de audio; pueden coincidir) | Copia del dueño del secret de Actions `R2_BUCKET`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Token de R2 con lectura sobre ese bucket | Copia del dueño de los secrets `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. GitHub **no deja leer** un secret ya cargado. Si no hay copia: crear en Cloudflare un token nuevo de sólo lectura (*Object Read*) para ese bucket y borrarlo al terminar; no reemplazar el de Actions. |
| `BACKUP_ENCRYPTION_KEY` | Passphrase de gpg de los respaldos | La copia **offline** que pide `.github/workflows/backup.yml` (línea 22). El secret de Actions se cargó el 3-sep-2026 y no cambió desde entonces, así que todas las copias que hay en R2 hoy usan ese mismo valor. Si no existe copia offline, **parar**: ni este ensayo ni una restauración real son posibles, y eso es un hallazgo más grave que cualquier otro. |
| `CLAVES_CIFRADO` | El llavero ENC2, formato `id=<32 bytes base64>[,id=…]` | El llavero del ensayo lleva **todas las claves de la época del respaldo, incluidas las retiradas**: un respaldo anterior a una rotación tiene blobs con la clave vieja. Salen del **gestor de contraseñas** del dueño, una entrada por id. No de Vercel: `CLAVES_CIFRADO` es *Sensitive* y no se puede leer, y en el estado final de una rotación (`docs/encryption.md` §3, paso 3) la variable de Vercel ya no tiene las claves retiradas. La variable de Actions `CLAVES_CIFRADO_IDS` (hoy `1,2`) dice qué ids se esperan; el llavero tiene que traer al menos esos. |
| `CLAVES_HISTORICAS_IDS` (opcional) | Ids, sin valores, de las claves que existieron y ya no tiene nadie, ej. `1` | La variable de Actions del mismo nombre, si existe (`gh variable get CLAVES_HISTORICAS_IDS`). Con ella, los blobs de esas claves se informan como "clave histórica no disponible" y no hacen fallar el ensayo. Un id no puede estar en el llavero y acá a la vez. |

**La copia ENC1 de la base anterior ya no se ensaya acá.** Hasta el 8-oct
había una prueba opcional (§3.6b) para la última diaria ENC1
(`backups/sesion-backup-2026-09-17-112606.dump.gpg`), con un quinto secreto,
`NOTES_ENCRYPTION_KEY`. Salió del procedimiento: la retención de 30 días borra
esa copia el 17 o el 18 de octubre, ninguna mensual es ENC1, y obligaba a pedir
un secreto más en medio del ensayo. Si hiciera falta antes de esa fecha, el
bloque está en el historial de este archivo (commit `9017522`).
`NOTES_ENCRYPTION_KEY` hace falta guardada mientras exista algún dato ENC1:
esa diaria y la rama anterior de Neon mientras no se borre
(`docs/operaciones/reconstruir-produccion.md` la deja intacta como vuelta
atrás).

No hacen falta: `DATABASE_URL` de Neon (el ensayo nunca toca Neon),
`CLAVES_CIFRADO_IDS` (es del automático), ni nada de Vercel, Railway o Resend.

---

## 2. Herramientas

En Ubuntu/WSL con Bash, en la máquina del dueño:

```bash
bash --version | head -1
docker version --format '{{.Server.Version}}'   # tiene que responder el SERVIDOR
docker run --rm postgres:17 postgres --version   # postgres (PostgreSQL) 17.x
aws --version                                    # aws-cli/2.x
gpg --version | head -1
psql --version; pg_restore --version            # 17.x
node --version                                   # v22
```

Estado de esta máquina al 8-oct-2026: Docker responde dentro de WSL (servidor
29.6.1) y `postgres:17` ya está bajada (17.11); AWS CLI v2 está instalada
(2.37.4, en `/usr/local/aws-cli`); psql y pg_restore 17.10, gpg 2.4.4 y Node
22.23. No hace falta instalar nada. Si `docker pull` falla con
`docker-credential-desktop.exe`, correr con `DOCKER_CONFIG` apuntando a una
carpeta con un `config.json` que diga `{}`.

Si AWS CLI faltara, se instala en el usuario, sin sudo:

```bash
cd "$(mktemp -d)" && curl -fsSLo awscliv2.zip https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip \
  && unzip -q awscliv2.zip && ./aws/install -i ~/.local/aws-cli -b ~/.local/bin && aws --version
```

Si `psql` del PATH no es 17: `export PG_BIN=/usr/lib/postgresql/17/bin`
(los dos guiones del ensayo y el bloque de §3.5 lo respetan).

---

## 3. Comandos, en orden

Copiar cada bloque entero, uno por vez, en **la misma terminal**, en este
orden: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7. Sólo 3.1 pregunta algo; los demás
corren solos. Si un bloque da ERROR o una salida distinta a la indicada, no
seguir: anotar el mensaje (sin credenciales) y pasar a §3.7 para limpiar.

### 3.1 Secretos, terminal privada y checkout de release

```bash
set +x
umask 077
read -rsp 'R2 access key id: ' AWS_ACCESS_KEY_ID; printf '\n'
read -rsp 'R2 secret access key: ' AWS_SECRET_ACCESS_KEY; printf '\n'
read -rsp 'Passphrase del respaldo (BACKUP_ENCRYPTION_KEY): ' BACKUP_ENCRYPTION_KEY; printf '\n'
read -rsp 'Llavero ENC2 de la época del respaldo, del gestor (todas las claves): ' CLAVES_CIFRADO; printf '\n'
read -rp  'Endpoint R2 (https://…r2.cloudflarestorage.com): ' R2_ENDPOINT
read -rp  'Bucket de respaldos (R2_BUCKET): ' R2_BUCKET
read -rp  'Ids de claves históricas (CLAVES_HISTORICAS_IDS, ej. 1; Enter si ninguna): ' CLAVES_HISTORICAS_IDS
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_KEY CLAVES_CIFRADO R2_ENDPOINT R2_BUCKET CLAVES_HISTORICAS_IDS
export AWS_DEFAULT_REGION=auto AWS_PAGER=""
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
unset AWS_SESSION_TOKEN DATABASE_URL
export TRABAJO_ENSAYO="$(mktemp -d /tmp/sesion-ensayo.XXXXXX)"
export REPO_ENSAYO="$HOME/proyectos/sesion-ensayo-$(date +%F)"
git -C ~/proyectos/sesion fetch -q origin
[ -d "$REPO_ENSAYO" ] || git -C ~/proyectos/sesion worktree add -q --detach "$REPO_ENSAYO" origin/release
git -C "$REPO_ENSAYO" checkout -q --detach origin/release
cd "$REPO_ENSAYO"
git log -1 --format='Ensayo con el código de release %h (%cs)'
echo "Carpeta privada: $TRABAJO_ENSAYO"
```

Las cuatro primeras preguntas no muestran lo que se escribe (`-s`): se pega
con el botón derecho o Ctrl+Shift+V y se aprieta Enter, aunque no se vea nada.
Las tres siguientes no son secretas y sí se ven.

Las credenciales van por variables de entorno y no con `aws configure`, para
que no queden escritas en `~/.aws/`. Las dos de checksum hacen lo mismo que
los `aws configure set default.s3.…` de los workflows (R2 no acepta el
checksum nuevo de aws-cli ≥ 2.23 en todas las rutas).

El checkout es de `release`, no de `main`: el guion compara la copia contra el
`prisma/schema.prisma` de la carpeta desde la que corre, y la copia es de lo
que está publicado. Con `main` adelantado en una migración, el ensayo diría
"esquema desconocido" de copias sanas. Va a una carpeta con la fecha del día,
`~/proyectos/sesion-ensayo-AAAA-MM-DD`, que queda para escribir el acta (§4):
si ya existe (un segundo intento el mismo día), se reusa y se pone en el
`release` actual.

**Bien:** imprime `Ensayo con el código de release <sha> (<fecha>)` y la
carpeta privada. Anotar el SHA para el acta.

### 3.2 Elegir y bajar las dos copias

Mismas consultas que el workflow automático: la diaria de `LastModified` más
reciente y la mensual de `LastModified` más vieja.

```bash
elegir() {  # $1 = prefijo, $2 = índice (-1 la más nueva, 0 la más vieja)
  aws s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$1" \
    --endpoint-url "$R2_ENDPOINT" \
    --query "sort_by(Contents || \`[]\`, &LastModified)[$2].Key" --output text
}
DIARIA="$(elegir backups/sesion-backup- -1)"
MENSUAL="$(elegir backups/mensuales/ 0)"
printf 'Diaria:  %s\nMensual: %s\n' "$DIARIA" "$MENSUAL"
for k in "$DIARIA" "$MENSUAL"; do
  case "$k" in ""|None) echo "ERROR: falta una de las dos copias"; break ;; esac
done
mkdir -p "$TRABAJO_ENSAYO/diaria" "$TRABAJO_ENSAYO/mensual"
aws s3 cp "s3://$R2_BUCKET/$DIARIA"  "$TRABAJO_ENSAYO/diaria/copia.dump.gpg"  --endpoint-url "$R2_ENDPOINT" --only-show-errors
aws s3 cp "s3://$R2_BUCKET/$MENSUAL" "$TRABAJO_ENSAYO/mensual/copia.dump.gpg" --endpoint-url "$R2_ENDPOINT" --only-show-errors
sha256sum "$TRABAJO_ENSAYO"/*/copia.dump.gpg
```

**Bien:** dos claves de la forma `backups/sesion-backup-AAAA-MM-DD-HHMMSS.dump.gpg`
y `backups/mensuales/sesion-backup-…`, y dos huellas de 64 caracteres. La
mensual es la más vieja que quede (las mensuales se guardan 12 meses; la
primera es `backups/mensuales/sesion-backup-2026-09-22-112134.dump.gpg`).
Anotar claves y huellas para el acta.
**Si dice "falta una de las dos copias":** seguir sólo con la que exista y
decirlo en el acta; si falta la diaria, parar.

### 3.3 Postgres 17 local, propio y efímero

`scripts/ensayo/ensayo-manual.sh` sabe levantar su propio contenedor, pero lo
**borra al terminar**, y después hace falta la base para descifrar las
transcripciones (§3.5). Por eso el contenedor se levanta acá, en memoria
(`--tmpfs`) y sólo escuchando en 127.0.0.1, y el guion lo usa vía
`DATABASE_URL` (acepta únicamente localhost).

```bash
export CONTENEDOR_ENSAYO="sesion-ensayo-manual-$$"
docker run -d --name "$CONTENEDOR_ENSAYO" -e POSTGRES_PASSWORD=ensayo \
  -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data postgres:17 > /dev/null
for i in $(seq 1 30); do
  docker exec "$CONTENEDOR_ENSAYO" pg_isready -U postgres > /dev/null 2>&1 && break
  sleep 1
done
PUERTO_ENSAYO="$(docker port "$CONTENEDOR_ENSAYO" 5432/tcp | head -1 | sed 's/.*://')"
export DATABASE_URL="postgresql://postgres:ensayo@127.0.0.1:${PUERTO_ENSAYO}/postgres"
export DB_ENSAYO="postgresql://postgres:ensayo@127.0.0.1:${PUERTO_ENSAYO}/ensayo_manual"
psql -X -At -c 'SHOW server_version' "$DATABASE_URL"
```

**Bien:** imprime `17.x`. Esta `DATABASE_URL` es la del contenedor, nunca Neon.

### 3.4 Copia diaria: descifrar, restaurar, verificar esquema y descifrar notas

```bash
cd "$TRABAJO_ENSAYO/diaria"
inicio=$(date +%s)
"$REPO_ENSAYO/scripts/ensayo/ensayo-manual.sh" ./copia.dump.gpg 2>&1 | tee salida.txt
echo "duración: $(( $(date +%s) - inicio )) s"
psql -X -At -c \
  "SELECT 'última migración: ' || migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1" \
  "$DB_ENSAYO"
cd "$REPO_ENSAYO"
```

El guion: descifra con
gpg y restaura con `pg_restore --exit-on-error` (`scripts/ensayo/restaurar.sh`),
y corre `scripts/ensayo/verificar-restauracion.mjs` con el llavero, que:

0. lee la última migración aplicada en la copia, busca su contrato en
   `scripts/ensayo/contratos.mjs` (`nuevo` = `prisma/schema.prisma` del
   checkout de release; `produccion-d02ae0e` =
   `scripts/ensayo/esquema-produccion.prisma`) y exige que **todas** las
   tablas, columnas y tipos sean exactamente los de ese contrato. Si no, o si
   la migración no tiene contrato, dice "esquema restaurado desconocido" y por
   qué, y falla;
1. cuenta filas por tabla contra mínimos;
2. revisa el formato de toda columna `*_encrypted`;
3. **descifra** con id de clave y AAD la nota clínica
   (`nota_final_encrypted`, o `nota_ia_encrypted` si no hay ninguna final)
   más vieja y más nueva, y la versión del Recorrido (`hilo_versiones`) más
   vieja y más nueva. Valida la forma (SOAP con sus cuatro claves; objeto JSON
   para el Recorrido). No imprime contenido. (Con una copia ENC1 de la base
   anterior descifraría en cambio `nota_soap_encrypted` y el contexto
   longitudinal; este procedimiento ya no las ensaya, ver §1);
4. cuenta filas huérfanas por cada clave foránea.

**Bien:** termina con `restauración verificada: OK`, dice `esquema restaurado:
nuevo (contrato elegido por su última migración, …)` (o el de un contrato
congelado, como `nuevo-sin-whatsapp`, si la copia es anterior a la última
migración publicada), `columnas cifradas: …
(ENC2, … por clave {"2":…}, inválidos 0)`, `muestras descifradas: 4/4`,
`violaciones 0`, y deja `resultado-manual.json`.

**También bien, con una clave histórica:** una copia anterior al recifrado
del 29-sep tiene blobs de la clave 1. Si la 1 está declarada histórica, dice
`muestras descifradas: 0/4, de clave histórica: 4` (o 2/4 si la copia está a
medio recifrar), `clave histórica no disponible: id 1, N blobs` y
`restauración verificada: OK`. La copia se restauró; sus notas no se pueden
leer porque la clave no existe. Va al acta así, con la fecha de la copia.

**Si falla,** no aparece `restauración verificada: OK`: el guion termina con
`Problemas:` y una línea por motivo (o, si ni siquiera restauró, con un
`ERROR:` de gpg o de pg_restore, como `no se pudo descifrar: passphrase
equivocada o archivo dañado/truncado`). Leer el motivo antes de concluir nada:

- `falta la clave N en el llavero`: hay datos cifrados con una clave que el
  `CLAVES_CIFRADO` cargado no trae (una retirada o una copia incompleta del
  llavero). No es corrupción: conseguir esa clave y repetir. Si la clave ya no
  existe en ningún lado, repetir con `CLAVES_HISTORICAS_IDS=N` exportada: el
  ensayo pasa a informarla como histórica (y conviene declararla también en
  Actions, `docs/operaciones.md` §4).
- `no descifra con la clave N`: la clave con ese id no es la de esa época, o
  está mal copiada, o el dato está alterado. Descartar primero lo de la copia.
- `tabla hilos vacía` / `tabla hilo_versiones vacía` / `no hay ninguna versión
  del Recorrido`: el verificador exige al menos un Recorrido. Si producción
  todavía no generó ninguno, el fallo es real pero no es del respaldo: anotar en
  el acta que la muestra del Recorrido no se pudo probar.
- `esquema restaurado desconocido: …`: el motivo viene después de los dos
  puntos. "no corresponde a su última migración" lista columnas que faltan o
  sobran: la copia no es lo que dice ser. "no tiene contrato" o "no está en
  el release publicado": el checkout no es `origin/release` actualizado
  (`git fetch` y repetir 3.1), o la copia tiene una migración que nunca salió
  por Publicar. La tabla completa de veredictos está en `docs/operaciones.md`
  §4, "Cómo se juzga una copia".

Seguir igual con §3.5 para tener el dato de la transcripción.

### 3.5 Copia diaria: descifrar la transcripción más vieja y más nueva

El guion no toca las transcripciones (`sesiones_clinicas.transcripcion_encrypted`).
Este bloque las descifra con el mismo llavero y las mismas reglas (ENC1: sin
AAD, prueba cada clave; ENC2: id del byte 4 y AAD
`sesiones_clinicas:transcripcion_encrypted:<id>`). Imprime ids, clave y sí/no;
**nunca el texto**. Se probó con blobs sintéticos ENC1 y ENC2 (clave correcta,
equivocada, ausente y blob movido de fila) y, el 8-oct, dentro del ensayo
general completo con copias inventadas (§7); no se probó contra una copia real.

```bash
cat > "$TRABAJO_ENSAYO/transcripcion.mjs" <<'JS'
import { execFileSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";

const psql = process.env.PG_BIN ? `${process.env.PG_BIN}/psql` : "psql";
const sql = (q) => {
  try {
    return execFileSync(psql, ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", q, process.env.DB_ENSAYO],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  } catch {
    // El mensaje de psql ya salió arriba; sin la cadena de conexión ni la pila.
    console.log("transcripciones: no se pudo consultar ensayo_manual (el error de psql está arriba). " +
      "Casi siempre es que la restauración de este bloque o del anterior falló: mirar su ERROR.");
    process.exit(1);
  }
};

const llavero = new Map();
for (const e of (process.env.CLAVES_CIFRADO ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const i = e.indexOf("=");
  const clave = Buffer.from(e.slice(i + 1).trim(), "base64");
  if (i <= 0 || clave.length !== 32) throw new Error("CLAVES_CIFRADO: entrada mal formada (no se muestra)");
  llavero.set(Number(e.slice(0, i).trim()), clave);
}
if (llavero.size === 0) throw new Error("falta CLAVES_CIFRADO");
const historicas = new Set((process.env.CLAVES_HISTORICAS_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number));

const enc1 = sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
  AND table_name='sesiones_clinicas' AND column_name='nota_soap_encrypted'`) === "1";
const fecha = enc1 ? `"createdAt"` : "creada_en";

function abrir(blob, id) {
  const prefijo = blob.subarray(0, 4).toString("ascii");
  if (enc1) {
    if (prefijo !== "ENC1" || blob.length < 32) return { ok: false, motivo: "formato (no es ENC1)" };
    for (const [claveId, clave] of llavero) {
      try {
        const d = createDecipheriv("aes-256-gcm", clave, blob.subarray(4, 16), { authTagLength: 16 });
        d.setAuthTag(blob.subarray(16, 32));
        return { ok: true, claveId, texto: Buffer.concat([d.update(blob.subarray(32)), d.final()]).toString("utf8") };
      } catch { /* siguiente clave */ }
    }
    return { ok: false, motivo: "autenticación: ninguna clave del llavero la abre" };
  }
  if (prefijo !== "ENC2" || blob.length < 33) return { ok: false, motivo: "formato (no es ENC2)" };
  const claveId = blob[4];
  if (historicas.has(claveId)) return { ok: false, historica: true, claveId, motivo: `clave histórica no disponible: id ${claveId}` };
  const clave = llavero.get(claveId);
  if (!clave) return { ok: false, claveId, motivo: `clave_ausente: falta la clave ${claveId} en el llavero` };
  try {
    const d = createDecipheriv("aes-256-gcm", clave, blob.subarray(5, 17), { authTagLength: 16 });
    d.setAAD(Buffer.from(`sesiones_clinicas:transcripcion_encrypted:${id}`, "utf8"));
    d.setAuthTag(blob.subarray(17, 33));
    return { ok: true, claveId, texto: Buffer.concat([d.update(blob.subarray(33)), d.final()]).toString("utf8") };
  } catch {
    return { ok: false, claveId, motivo: "autenticación: dato alterado o clave equivocada" };
  }
}

const total = Number(sql(`SELECT count(*) FROM sesiones_clinicas WHERE transcripcion_encrypted IS NOT NULL`));
console.log(`formato ${enc1 ? "ENC1 (producción d02ae0e)" : "ENC2 (esquema nuevo)"}; transcripciones no nulas: ${total}`);
if (total === 0) { console.log("NO HAY transcripciones en la copia: nada que descifrar"); process.exit(1); }
let fallo = false;
for (const [orden, cual] of [["ASC", "más vieja"], ["DESC", "más nueva"]]) {
  const [id, hex] = sql(`SELECT id, encode(transcripcion_encrypted, 'hex') FROM sesiones_clinicas
    WHERE transcripcion_encrypted IS NOT NULL ORDER BY ${fecha} ${orden}, id ${orden} LIMIT 1`).split("|");
  const r = abrir(Buffer.from(hex, "hex"), id);
  const leida = r.ok && typeof r.texto === "string" && r.texto.trim().length > 0;
  if (!leida && !r.historica) fallo = true;
  console.log(`transcripción ${cual} (sesiones_clinicas ${id}, clave ${r.claveId ?? "?"}): ` +
    (leida ? "descifrada y leída: sí" : r.historica ? `${r.motivo}, no se prueba`
      : `descifrada y leída: NO — ${r.motivo ?? "descifra pero está vacía"}`));
}
process.exit(fallo ? 1 : 0);
JS
node "$TRABAJO_ENSAYO/transcripcion.mjs" | tee "$TRABAJO_ENSAYO/diaria/transcripcion.txt"
```

**Bien:** dos líneas `descifrada y leída: sí`, o `clave histórica no
disponible: id N, no se prueba` en las de una clave declarada histórica (no
cuenta como fallo; va al acta así). **Si dice "NO HAY
transcripciones":** la copia no tiene ninguna; anotarlo, no es un fallo del
respaldo pero deja la transcripción sin probar.

### 3.6 Copia mensual: lo mismo sobre la otra copia

El guion crea la base `ensayo_manual` y se niega si ya existe: se borra antes.

```bash
psql -X -q -v ON_ERROR_STOP=1 -c 'DROP DATABASE ensayo_manual' "$DATABASE_URL"
cd "$TRABAJO_ENSAYO/mensual"
inicio=$(date +%s)
"$REPO_ENSAYO/scripts/ensayo/ensayo-manual.sh" ./copia.dump.gpg 2>&1 | tee salida.txt
echo "duración: $(( $(date +%s) - inicio )) s"
psql -X -At -c \
  "SELECT 'última migración: ' || migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1" \
  "$DB_ENSAYO"
node "$TRABAJO_ENSAYO/transcripcion.mjs" | tee "$TRABAJO_ENSAYO/mensual/transcripcion.txt"
cd "$REPO_ENSAYO"
```

Mismo criterio de **Bien** que 3.4 y 3.5. La mensual más vieja es anterior a
migraciones posteriores, así que es esperable que diga un contrato congelado:
la del 22-sep tiene como última migración
`20260918120000_grabador_restaurado` y da `esquema restaurado:
nuevo-con-audio` (corrida automática `37814736865`, 8-oct). Las diarias de
antes de publicar `20261008120000_whatsapp_asistido` dan
`nuevo-sin-whatsapp`. Es anterior al recifrado del 29-sep: sus blobs son de la
clave 1 (el automático del 2-oct contó 99). Si la clave 1 no está en el gestor,
esta es la copia que da "clave histórica no disponible".

Ahora es el momento de copiar al acta lo que haga falta de
`$TRABAJO_ENSAYO/{diaria,mensual}/` (`salida.txt`, `resultado-manual.json`,
`transcripcion.txt`): en §3.7 se borra todo.

### 3.7 Limpiar (correr siempre, aunque algo haya fallado)

```bash
cd "$REPO_ENSAYO"
docker rm -f "$CONTENEDOR_ENSAYO" > /dev/null 2>&1 || true
rm -rf "$TRABAJO_ENSAYO"
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_KEY CLAVES_CIFRADO \
      CLAVES_HISTORICAS_IDS DATABASE_URL DB_ENSAYO R2_ENDPOINT R2_BUCKET TRABAJO_ENSAYO
docker ps -a --filter "name=sesion-ensayo" --format '{{.Names}}'
```

**Bien:** la última línea no imprime nada. Si se creó un token de R2 sólo para
esto, borrarlo en Cloudflare. La carpeta `$REPO_ENSAYO`
(`~/proyectos/sesion-ensayo-AAAA-MM-DD`) queda para escribir el acta (§4).

---

## 4. El acta

**Dónde:** `docs/operaciones/actas/AAAA-MM-DD-restauracion.md`, con la fecha
**del día del ensayo**, copiando `docs/operaciones/actas/PLANTILLA-acta-restauracion.md`.

**Qué mira el guardián** (`scripts/ci/acta-vigente.mjs`, paso "Acta de
restauración vigente" de `.github/workflows/ci.yml`): **sólo el nombre del
archivo**. Toma los archivos de esa carpeta cuyo nombre empieza con
`AAAA-MM-DD` y termina en `.md`, se queda con la fecha más reciente y falla si
tiene más de 100 días. Si no hay ninguna acta, avisa sin fallar hasta el
2026-12-20 y desde ese día falla (y sin CI verde en `main` no se publica). No
lee el contenido: lo que el acta dice es responsabilidad de quien la firma.
Consecuencias:

- Tiene que llegar a `main` (por PR) para contar: el CI de `main` corre sobre
  su propio checkout.
- La plantilla no cuenta (su nombre no empieza con fecha).
- No poner una fecha que no sea la del ensayo: una fecha futura el guardián la
  aceptaría igual (edad negativa), y el acta mentiría.

**Qué tiene que decir** (la plantilla, ajustada a estas copias):

- Fecha, quién ejecutó, SHA de `release` usado (3.1), destino: *contenedor
  postgres:17 local en tmpfs*; duración total.
- Por cada copia (diaria y mensual): la clave de R2 y su `sha256`, el esquema
  que informó el guion (en la diaria, `nuevo` o, si es de antes de la última
  migración publicada, un contrato congelado como `nuevo-sin-whatsapp`; en la
  mensual del 22-sep, `nuevo-con-audio`) y la última migración.
- Conteo de filas por tabla (la tabla que imprime el guion, o
  `resultado-manual.json`) comparado a ojo con lo que tiene hoy el consultorio.
- Formato de cifrado: `ENC2` en todas las columnas `*_encrypted`, blobs por id
  de clave, inválidos: 0; ningún id fuera del llavero.
- Claves foráneas: verificadas / violaciones (0).
- **Descifrado**, por copia, con ids y sí/no, sin texto:
  - nota clínica más vieja y más nueva;
  - versión del Recorrido más vieja y más nueva;
  - transcripción más vieja y más nueva (3.5);
  - ids de clave del llavero usados (el número, nunca el valor).
- Si algo dijo NO: el motivo que imprimió el guion (clave ausente,
  autenticación, formato), sin texto clínico.
- Próximo ensayo: dentro de 90 días (100 como máximo).

**Qué no va:** ninguna credencial, passphrase, clave, endpoint con accountId,
cadena de conexión ni texto clínico. Ids de filas sí (ya figuran en el issue #33).

---

## 5. Tiempo

Medido el 8-oct en el ensayo general (§7), en esta máquina, con copias
inventadas de unos 15 KB y un R2 simulado local:

| Bloque | Tiempo medido |
| --- | --- |
| 3.1 secretos y checkout (sin contar escribir las siete respuestas) | 5 s, casi todo el `git fetch` |
| 3.2 elegir y bajar las dos copias | 2 s |
| 3.3 Postgres 17 en Docker (imagen ya bajada) | 2 s |
| 3.4 restaurar y verificar la diaria | 4 s |
| 3.5 transcripciones de la diaria | menos de 1 s |
| 3.6 la mensual, con sus transcripciones | 4 s |
| 3.7 limpiar | menos de 1 s |
| **Total de los bloques** | **17 s** |

Con las copias reales cambian dos cosas, que no se pudieron medir: la bajada
desde R2 (la diaria pesaba 1,5 MB y la mensual 0,9 MB a fines de septiembre,
según los logs de `.github/workflows/backup.yml`) y la restauración, que crece con el
tamaño; a ese tamaño debería seguir siendo cosa de segundos. Lo que sí lleva
tiempo es lo de alrededor:

| Parte | Tiempo |
| --- | --- |
| Juntar los secretos (§1) | 5–15 min si están en el gestor; indefinido si no |
| Primer `docker pull postgres:17`, si no está | 1–3 min |
| Correr §3 entero y leer cada salida | 10–15 min |
| Escribir el acta, PR y merge | 20–30 min |

**Total: menos de una hora**, casi toda en juntar secretos y en el acta.

---

## 6. El ensayo automático hoy: qué falla y si bloquea este

**Actualización del 6-oct:** el automático corrió por calendario el 2-oct
(corrida `37012091950`) y salió verde con las dos copias: la diaria del 2-oct
(clave 2, 183 blobs) y la mensual del 22-sep (clave 1, 99 blobs), las dos
`esquema restaurado: nuevo`, 4/4 muestras con clave conocida y 0 violaciones.
Lo que sigue es el estado al 26-sep, que explica por qué hasta entonces no
había corrido.

**Lo que se ve en GitHub** (`gh run list`, 26-sep):

- `.github/workflows/ensayo-restauracion.yml` corrió **cuatro veces, todas el 16-sep, a mano, y
  las cuatro terminaron en `failure`**. Nunca corrió por calendario. Las tres
  primeras fallaron al elegir las copias (una por un error de `sort_by` con el
  prefijo vacío, que ya está corregido). La cuarta (corrida `35127235936`,
  issue #33) **restauró y verificó entera la diaria** (esquema
  `produccion-d02ae0e`, 13 tablas, 17 FK sin violaciones, 123 blobs ENC1 con
  formato válido) y falló porque **no existía ninguna copia mensual**. Esa
  diaria era de la base **anterior**: al día siguiente producción se
  reconstruyó.
- Esa causa ya no está. El cambio `583e112` (21-sep) hizo que la primera corrida
  lograda de cada mes deje la copia mensual, y el log de `.github/workflows/backup.yml` del 22-sep
  (corrida `35720959243`) dice `Copia mensual de 2026-09:
  …/backups/mensuales/sesion-backup-2026-09-22-112134.dump.gpg`; la del 26-sep
  dice `Ya hay copia mensual de 2026-09 (1)`. `.github/workflows/backup.yml` está en verde
  todos los días desde el 15-sep.
- Pero el ensayo automático **no volvió a correr** desde entonces. O sea:
  **ninguna copia del esquema nuevo (ENC2) se restauró nunca**, ni a mano ni
  en automático. Nadie comprobó todavía que la mensual se restaura. La próxima corrida por
  calendario es el **2-oct 07:00 UTC**. El issue #33 sigue abierto y su texto
  dice "día 1", que quedó viejo (el cron es el día 2).
- La variable `CLAVES_CIFRADO_IDS` existe (valor `1`, cargada el 16-sep). Con
  las copias ENC2 de ahora sí sirve: el automático cuenta los blobs por id y
  falla si aparece uno que no está en esa lista. Si el llavero de producción
  tiene más de una clave, la variable tiene que listarlas todas.
- **Lo que el automático no prueba y no va a probar:** que una nota se lea.
  No tiene clave clínica, por decisión del dueño. Tampoco toca transcripciones.

**¿Bloquea el ensayo manual?** **No.** El manual toma cualquier archivo que el
dueño le dé; sólo depende de que existan las copias en R2 (hoy hay una diaria
por día y una mensual) y de los secretos de §1. Que el automático esté en rojo
no impide nada de §3. Si por alguna razón no apareciera la mensual en 3.2, el
ensayo sobre la diaria alcanza para el acta y para decidir el vaciado, diciéndolo.

Correr el automático a mano (Actions → *Ensayo de restauración* → *Run
workflow*) antes del 2-oct cerraría el punto 3 de "Comprobaciones pendientes
del dueño" en `docs/operaciones.md` §4 y probablemente el issue #33. Este
documento no lo dispara.

---

## 7. Verificado y no verificado

**Verificado corriendo, el 8-oct, sin ningún secreto real** (`release` =
`445141f`): un ensayo general con todo inventado. Se armó una base con las
migraciones de `release` y datos ficticios cifrados en ENC2 con dos claves
generadas al azar (la 1 en septiembre, la 2 en octubre); se hizo `pg_dump` y
`gpg` con los mismos parámetros que `.github/workflows/backup.yml` y una passphrase inventada;
y se subieron una diaria vieja, una mensual (sin la migración de WhatsApp) y
una diaria nueva a un S3 local (`motoserver/moto` en Docker) con credenciales
inventadas. Después se corrieron los siete bloques de §3, extraídos tal cual
de este archivo, en una sola sesión de bash:

- 3.1 a 3.7 dicen lo que este documento dice que dicen: el SHA de release,
  la diaria más nueva y la mensual (no la diaria vieja), `17.11`,
  `esquema restaurado: nuevo` en la diaria y `nuevo-sin-whatsapp` en la
  mensual, `muestras descifradas: 4/4`, `violaciones 0`,
  `restauración verificada: OK`, dos transcripciones `sí` por copia, y 3.7
  sin contenedores ni carpeta privada al final.
- Con el llavero sin la clave 1 y `CLAVES_HISTORICAS_IDS=1`: la diaria da
  `2/4, de clave histórica: 2`, la mensual `0/4, de clave histórica: 4`,
  `clave histórica no disponible: id 1, 6 blobs` y OK, como dice §3.4.
- Con el llavero sin la clave 1 y sin declararla: `Problemas:` y
  `falta la clave 1 en el llavero … No es corrupción`, y la transcripción
  `NO — clave_ausente`.
- Con la passphrase equivocada: `ERROR: … no se pudo descifrar: passphrase
  equivocada o archivo dañado/truncado.`
- Un segundo intento el mismo día reusa la carpeta de release sin error.

Lo que este ensayo general no prueba: la autenticación contra R2 (el S3 local
acepta cualquier credencial), la región `auto` de R2 (el S3 local la acepta
para leer pero no para crear un bucket, cosa que el ensayo no hace) y nada de
lo que depende de los valores reales (abajo).

**Verificado leyendo el repo y GitHub** (26-sep, `main` = `a6f6e74`):

- El flujo de `.github/workflows/backup.yml` (pg_dump custom → gpg AES-256 simétrico → R2 bajo
  `backups/` y `backups/mensuales/`) y que `scripts/ensayo/restaurar.sh`
  lo invierte con la misma passphrase.
- Que `ensayo-manual.sh` borra su contenedor al salir, exige base local, y
  falla si `ensayo_manual` ya existe (de ahí 3.3 y el `DROP` de 3.6).
- Que el verificador reconoce el esquema de producción d02ae0e y el nuevo,
  descifra ENC1 probando cada clave del llavero y ENC2 con id y AAD, y **no**
  descifra transcripciones.
- Que ENC1 usaba `NOTES_ENCRYPTION_KEY` en base64 de 32 bytes (`1e9312e^`).
- Que la reconstrucción del 17-sep se ve en los respaldos: el índice del dump
  pasa de 14 tablas con datos (`2026-09-17-112606`, la última ENC1) a 22 (18-sep
  en adelante), y `origin/release` es igual a `origin/main` (`a6f6e74`,
  publicado el 26-sep). Las migraciones posteriores al 22-sep no cambian
  columnas.
- Que la copia mensual `2026-09-22-112134` existe (log de Actions) y que el
  guardián sólo lee el nombre del archivo.
- Nombres de secrets en Actions; `BACKUP_ENCRYPTION_KEY` sin cambios desde el
  3-sep.
- El bloque 3.5, contra blobs sintéticos ENC1/ENC2 con un `psql` simulado.

**No verificado: hace falta correr con secretos.**

- Que el dueño tenga copia offline de `BACKUP_ENCRYPTION_KEY` y que coincida
  con la del secret de Actions.
- Que el `CLAVES_CIFRADO` que el dueño cargue sea el llavero completo de
  producción: que traiga todos los ids que aparecen en las copias.
- Que la base nueva ya tenga al menos un Recorrido, una nota clínica y una
  transcripción: el verificador exige muestras y falla sin ellas.
- (Verificado después, el 2-oct, por el automático: la mensual del 22-sep
  restaura con el esquema `nuevo`.)
- (Retirado el 8-oct, ver §1) que el dueño tenga `NOTES_ENCRYPTION_KEY` y que sea la misma con
  la que se cifró todo lo de la base anterior (ENC1 no admitía rotación).
- Que notas, versiones del Recorrido y transcripciones descifren: es justamente
  lo que el ensayo tiene que mostrar.
- Los tiempos de §5 con copias del tamaño real.
- (Verificado el 8-oct: `docker port` y la red en WSL con Docker Desktop
  funcionan; el bloque 3.3 corrió.)
