# Ensayo manual de restauración: procedimiento para el dueño

Para correr **antes de vaciar la base** (`docs/operaciones/reconstruir-produccion.md`
§3) y, después, cada tres meses. Es el único ensayo que prueba que la
historia clínica de un respaldo **se puede leer**: el automático
(`.github/workflows/ensayo-restauracion.yml`) restaura y cuenta, pero no tiene
ninguna clave clínica, a propósito, y no descifra nada.

Escrito el 26 de septiembre de 2026 sobre `main` en `a6f6e74`, leyendo el repo
y GitHub Actions. Nada de esto se corrió con secretos: lo que depende de ellos
está marcado como **no verificado** en §7.

Qué hace, en una línea: bajar de R2 la copia diaria más reciente y la mensual
más vieja, descifrar cada una con gpg, restaurarla en un Postgres 17 local en
Docker, comprobar el esquema, filas y claves foráneas, **descifrar con el
llavero** la nota clínica y el contexto longitudinal más viejos y más nuevos
(`scripts/ensayo/ensayo-manual.sh`) y la transcripción más vieja y más nueva
(bloque de §3.5), y dejar un acta sin texto clínico.

---

## 1. Secretos que hacen falta y de dónde salen

Ninguno se pega en un comando, un archivo del repo, el chat ni una captura. Se
cargan con `read -rs` en la misma terminal (§3.1) y se borran al final (§3.7).

| Variable en la terminal | Qué es | De dónde sale |
| --- | --- | --- |
| `R2_ENDPOINT` | `https://<accountId>.r2.cloudflarestorage.com` | Copia del dueño del secret de Actions del mismo nombre, o Cloudflare → R2 → la cuenta. No es secreto, pero tampoco va al acta. |
| `R2_BUCKET` | Bucket de **respaldos** (no confundir con `R2_BUCKET_NAME`, el de audio; pueden coincidir) | Copia del dueño del secret de Actions `R2_BUCKET`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Token de R2 con lectura sobre ese bucket | Copia del dueño de los secrets `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. GitHub **no deja leer** un secret ya cargado. Si no hay copia: crear en Cloudflare un token nuevo de sólo lectura (*Object Read*) para ese bucket y borrarlo al terminar; no reemplazar el de Actions. |
| `BACKUP_ENCRYPTION_KEY` | Passphrase de gpg de los respaldos | La copia **offline** que pide `.github/workflows/backup.yml` (línea 22). El secret de Actions se cargó el 3-sep-2026 y no cambió desde entonces, así que todas las copias que hay en R2 hoy usan ese mismo valor. Si no existe copia offline, **parar**: ni este ensayo ni una restauración real son posibles, y eso es un hallazgo más grave que cualquier otro. |
| `CLAVES_CIFRADO` | El llavero, formato `id=<32 bytes base64>[,id=…]` | Ver abajo: para las copias de **hoy** es la clave ENC1 de la app vieja. |

**Qué va en `CLAVES_CIFRADO` para estas copias.** Todas las copias que hay hoy
en R2 son de la base de producción anterior (esquema `produccion-d02ae0e`,
cifrado **ENC1**): así lo dice el acta automática del 16-sep (issue #33, "123
blobs sin identificador de clave", "blobs por clave: ninguna"). ENC1 se cifraba
con **`NOTES_ENCRYPTION_KEY`** de la versión anterior (32 bytes en base64, igual
formato que una entrada del llavero; ver `git show 1e9312e^:src/lib/encryption.ts`).
Entonces:

```
CLAVES_CIFRADO = "1=<valor de NOTES_ENCRYPTION_KEY>"
```

El id `1` es arbitrario para ENC1 (el blob no guarda id: el verificador prueba
cada clave del llavero). Se puede agregar la clave ENC2 de la app nueva como
`2=…`; no molesta.

`NOTES_ENCRYPTION_KEY` sale del proyecto de Vercel de producción (si la
variable no está marcada *Sensitive*, se puede ver) o del gestor de contraseñas
del dueño. **Atención:** `docs/pendientes/03-identidad.md` pide verificar que en
Vercel no quede "la clave ENC1". Sacarla de Vercel está bien; **perderla no**:
la copia mensual de septiembre de 2026 es ENC1 y se retiene doce meses
(hasta septiembre de 2027). Guardarla offline antes de borrarla de Vercel.

No hacen falta: `DATABASE_URL` de Neon (el ensayo nunca toca Neon),
`CLAVES_CIFRADO_IDS` (es del automático), ni nada de Vercel, Railway o Resend.

---

## 2. Herramientas

En Ubuntu/WSL con Bash, en la máquina del dueño:

```bash
bash --version | head -1
docker version --format '{{.Server.Version}}'   # tiene que responder el SERVIDOR
aws --version                                    # AWS CLI v2
gpg --version | head -1
psql --version; pg_restore --version            # 17.x
node --version                                   # v22
```

Estado de esta máquina al escribir esto (26-sep): psql y pg_restore 17.10, gpg
2.4.4 y Node 22.23 están; **`aws` no está instalado** y **`docker` no responde
dentro de WSL** ("could not be found in this WSL 2 distro": Docker Desktop
apagado o sin la integración con WSL activada). Hay que resolver las dos cosas
antes. Si `docker pull` falla con `docker-credential-desktop.exe`, correr con
`DOCKER_CONFIG` apuntando a una carpeta con un `config.json` que diga `{}`.

Si `psql` del PATH no es 17: `export PG_BIN=/usr/lib/postgresql/17/bin`
(los dos guiones del ensayo lo respetan).

---

## 3. Comandos, en orden

Copiar cada bloque entero, uno por vez, en **la misma terminal**. Si un bloque
da ERROR o una salida distinta a la indicada, no seguir: anotar el mensaje
(sin credenciales) y pasar a §3.7 para limpiar.

### 3.1 Terminal privada, checkout y secretos

```bash
set +x
umask 077
cd ~/proyectos/sesion-arreglos
git fetch origin
git worktree add --detach ../sesion-ensayo-acta origin/main
cd ../sesion-ensayo-acta
git log -1 --format='Ensayo con el código de main %h (%cs)'
export TRABAJO_ENSAYO="$(mktemp -d /tmp/sesion-ensayo.XXXXXX)"

read -rp  'Endpoint R2 (https://…r2.cloudflarestorage.com): ' R2_ENDPOINT
read -rp  'Bucket de respaldos (R2_BUCKET): ' R2_BUCKET
read -rsp 'R2 access key id: ' AWS_ACCESS_KEY_ID; printf '\n'
read -rsp 'R2 secret access key: ' AWS_SECRET_ACCESS_KEY; printf '\n'
read -rsp 'Passphrase del respaldo (BACKUP_ENCRYPTION_KEY): ' BACKUP_ENCRYPTION_KEY; printf '\n'
read -rsp 'Llavero (CLAVES_CIFRADO, "1=<NOTES_ENCRYPTION_KEY>"): ' CLAVES_CIFRADO; printf '\n'
export R2_ENDPOINT R2_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_KEY CLAVES_CIFRADO
export AWS_DEFAULT_REGION=auto AWS_PAGER=""
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
unset AWS_SESSION_TOKEN DATABASE_URL
echo "Carpeta privada: $TRABAJO_ENSAYO"
```

Las credenciales van por variables de entorno y no con `aws configure`, para
que no queden escritas en `~/.aws/`. Las dos de checksum hacen lo mismo que
los `aws configure set default.s3.…` de los workflows (R2 no acepta el
checksum nuevo de aws-cli ≥ 2.23 en todas las rutas).

**Bien:** muestra el SHA de main y la carpeta privada. Anotar el SHA para el acta.

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
mensual esperable hoy es `backups/mensuales/sesion-backup-2026-09-22-112134.dump.gpg`
(la única: ver §6). Anotar claves y huellas para el acta.
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
"$OLDPWD/scripts/ensayo/ensayo-manual.sh" ./copia.dump.gpg 2>&1 | tee salida.txt
echo "duración: $(( $(date +%s) - inicio )) s"
psql -X -At -c \
  "SELECT 'última migración: ' || migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1" \
  "$DB_ENSAYO"
cd "$OLDPWD"
```

(`$OLDPWD` es la carpeta del worktree del bloque 3.1.) El guion: descifra con
gpg y restaura con `pg_restore --exit-on-error` (`scripts/ensayo/restaurar.sh`),
y corre `scripts/ensayo/verificar-restauracion.mjs` con el llavero, que:

0. compara **todas** las tablas, columnas y tipos con las dos instantáneas
   conocidas (`scripts/ensayo/esquema-produccion.prisma` = producción d02ae0e,
   y `prisma/schema.prisma` = esquema nuevo). Esa es la verificación de esquema;
   si no coincide con ninguna, dice "esquema restaurado desconocido" y falla;
1. cuenta filas por tabla contra mínimos;
2. revisa el formato de toda columna `*_encrypted`;
3. **descifra** la nota clínica (`nota_soap_encrypted`) más vieja y más nueva
   y, en el esquema de producción, el contexto longitudinal
   (`paciente_contexto_clinico`) más viejo y más nuevo; en el esquema nuevo
   serían las versiones del Recorrido. Valida la forma (SOAP con sus cuatro
   claves, JSON o texto según la columna). No imprime contenido;
4. cuenta filas huérfanas por cada clave foránea.

**Bien:** termina con `restauración verificada: OK`, dice `esquema restaurado:
produccion-d02ae0e`, `muestras descifradas: 4/4`, `violaciones 0`, y deja
`resultado-manual.json`. **Si dice "ENC1 no descifra con ninguna clave del
llavero":** la clave cargada no es la `NOTES_ENCRYPTION_KEY` de esa época (o
está mal copiada); no es corrupción hasta que se descarte eso. Seguir igual con
§3.5 para tener el dato de la transcripción, y reportarlo.

### 3.5 Copia diaria: descifrar la transcripción más vieja y más nueva

El guion no toca las transcripciones (`sesiones_clinicas.transcripcion_encrypted`).
Este bloque las descifra con el mismo llavero y las mismas reglas (ENC1: sin
AAD, prueba cada clave; ENC2: id del byte 4 y AAD
`sesiones_clinicas:transcripcion_encrypted:<id>`). Imprime ids, clave y sí/no;
**nunca el texto**. Se probó con blobs sintéticos ENC1 y ENC2 (clave correcta,
equivocada, ausente y blob movido de fila); no se probó contra una copia real.

```bash
cat > "$TRABAJO_ENSAYO/transcripcion.mjs" <<'JS'
import { execFileSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";

const psql = process.env.PG_BIN ? `${process.env.PG_BIN}/psql` : "psql";
const sql = (q) => execFileSync(psql, ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", q, process.env.DB_ENSAYO],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

const llavero = new Map();
for (const e of (process.env.CLAVES_CIFRADO ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const i = e.indexOf("=");
  const clave = Buffer.from(e.slice(i + 1).trim(), "base64");
  if (i <= 0 || clave.length !== 32) throw new Error("CLAVES_CIFRADO: entrada mal formada (no se muestra)");
  llavero.set(Number(e.slice(0, i).trim()), clave);
}
if (llavero.size === 0) throw new Error("falta CLAVES_CIFRADO");

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
  if (!leida) fallo = true;
  console.log(`transcripción ${cual} (sesiones_clinicas ${id}, clave ${r.claveId ?? "?"}): ` +
    (leida ? "descifrada y leída: sí" : `descifrada y leída: NO — ${r.motivo ?? "descifra pero está vacía"}`));
}
process.exit(fallo ? 1 : 0);
JS
node "$TRABAJO_ENSAYO/transcripcion.mjs" | tee "$TRABAJO_ENSAYO/diaria/transcripcion.txt"
```

**Bien:** dos líneas `descifrada y leída: sí`. **Si dice "NO HAY
transcripciones":** la copia no tiene ninguna; anotarlo, no es un fallo del
respaldo pero deja la transcripción sin probar.

### 3.6 Copia mensual: lo mismo sobre la otra copia

El guion crea la base `ensayo_manual` y se niega si ya existe: se borra antes.

```bash
psql -X -q -v ON_ERROR_STOP=1 -c 'DROP DATABASE ensayo_manual' "$DATABASE_URL"
cd "$TRABAJO_ENSAYO/mensual"
inicio=$(date +%s)
"$OLDPWD/scripts/ensayo/ensayo-manual.sh" ./copia.dump.gpg 2>&1 | tee salida.txt
echo "duración: $(( $(date +%s) - inicio )) s"
cd "$OLDPWD"
node "$TRABAJO_ENSAYO/transcripcion.mjs" | tee "$TRABAJO_ENSAYO/mensual/transcripcion.txt"
```

Mismo criterio de **Bien** que 3.4 y 3.5. Ahora es el momento de copiar al
acta lo que haga falta de `$TRABAJO_ENSAYO/{diaria,mensual}/` (`salida.txt`,
`resultado-manual.json`, `transcripcion.txt`): en §3.7 se borra todo.

### 3.7 Limpiar (correr siempre, aunque algo haya fallado)

```bash
docker rm -f "$CONTENEDOR_ENSAYO" > /dev/null 2>&1 || true
rm -rf "$TRABAJO_ENSAYO"
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_KEY CLAVES_CIFRADO \
      DATABASE_URL DB_ENSAYO R2_ENDPOINT R2_BUCKET
docker ps -a --filter "name=sesion-ensayo" --format '{{.Names}}'
```

**Bien:** la última línea no imprime nada. Si se creó un token de R2 sólo para
esto, borrarlo en Cloudflare. El worktree `../sesion-ensayo-acta` queda para
escribir el acta (§4).

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

- Fecha, quién ejecutó, SHA de `main` usado (3.1), destino: *contenedor
  postgres:17 local en tmpfs*; duración total.
- Por cada copia (diaria y mensual): la clave de R2 y su `sha256`, el esquema
  que informó el guion (`produccion-d02ae0e` esperado) y la última migración.
- Conteo de filas por tabla (la tabla que imprime el guion, o
  `resultado-manual.json`) comparado a ojo con lo esperable: la diaria del
  16-sep tenía 36 pacientes, 113 turnos y 43 sesiones clínicas.
- Formato de cifrado: `ENC1` en todas las columnas `*_encrypted`, inválidos: 0.
- Claves foráneas: verificadas / violaciones (0).
- **Descifrado**, por copia, con ids y sí/no, sin texto:
  - nota clínica más vieja y más nueva;
  - contexto longitudinal más viejo y más nuevo (en el esquema de producción
    ocupa el lugar que la plantilla llama "versión del Recorrido");
  - transcripción más vieja y más nueva (3.5; la plantilla no la tiene:
    agregar las dos líneas);
  - ids de clave del llavero usados (el número, nunca el valor).
- Si algo dijo NO: el motivo que imprimió el guion (clave ausente,
  autenticación, formato), sin texto clínico.
- Próximo ensayo: dentro de 90 días (100 como máximo).

**Qué no va:** ninguna credencial, passphrase, clave, endpoint con accountId,
cadena de conexión ni texto clínico. Ids de filas sí (ya figuran en el issue #33).

---

## 5. Tiempo estimado

| Parte | Tiempo |
| --- | --- |
| Instalar AWS CLI y activar Docker en WSL (una sola vez) | 15–30 min |
| Juntar los secretos (§1) | 5–15 min si están en el gestor; indefinido si no |
| Bajar las dos copias | < 1 min: la diaria del 26-sep pesa 1,5 MB y la mensual del 22-sep, 0,9 MB (logs de `.github/workflows/backup.yml`) |
| Primer `docker pull postgres:17` | 1–3 min |
| Restaurar y verificar cada copia (3.4–3.6) | < 1 min cada una a este tamaño (hipótesis: no se cronometró con una copia real) |
| Escribir el acta, PR y merge | 20–30 min |

**Total: alrededor de una hora**, la mayor parte en preparar y en el acta.

---

## 6. El ensayo automático hoy: qué falla y si bloquea este

**Lo que se ve en GitHub** (`gh run list`, 26-sep):

- `.github/workflows/ensayo-restauracion.yml` corrió **cuatro veces, todas el 16-sep, a mano, y
  las cuatro terminaron en `failure`**. Nunca corrió por calendario. Las tres
  primeras fallaron al elegir las copias (una por un error de `sort_by` con el
  prefijo vacío, que ya está corregido). La cuarta (corrida `35127235936`,
  issue #33) **restauró y verificó entera la diaria** (esquema
  `produccion-d02ae0e`, 13 tablas, 17 FK sin violaciones, 123 blobs ENC1 con
  formato válido) y falló porque **no existía ninguna copia mensual**.
- Esa causa ya no está. El cambio `583e112` (21-sep) hizo que la primera corrida
  lograda de cada mes deje la copia mensual, y el log de `.github/workflows/backup.yml` del 22-sep
  (corrida `35720959243`) dice `Copia mensual de 2026-09:
  …/backups/mensuales/sesion-backup-2026-09-22-112134.dump.gpg`; la del 26-sep
  dice `Ya hay copia mensual de 2026-09 (1)`. `.github/workflows/backup.yml` está en verde
  todos los días desde el 15-sep.
- Pero el ensayo automático **no volvió a correr** desde entonces: nadie
  comprobó con él que la mensual se restaura. La próxima corrida por
  calendario es el **2-oct 07:00 UTC**. El issue #33 sigue abierto y su texto
  dice "día 1", que quedó viejo (el cron es el día 2).
- La variable `CLAVES_CIFRADO_IDS` existe (valor `1`, cargada el 16-sep). Con
  copias ENC1 no sirve de mucho: ENC1 no guarda id de clave y el automático
  sólo puede confirmar el formato.
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
- Que la copia mensual `2026-09-22-112134` existe (log de Actions) y que el
  guardián sólo lee el nombre del archivo.
- Nombres de secrets en Actions; `BACKUP_ENCRYPTION_KEY` sin cambios desde el
  3-sep.
- El bloque 3.5, contra blobs sintéticos ENC1/ENC2 con un `psql` simulado.

**No verificado: hace falta correr con secretos.**

- Que el dueño tenga copia offline de `BACKUP_ENCRYPTION_KEY` y que coincida
  con la del secret de Actions.
- Que tenga `NOTES_ENCRYPTION_KEY` y que sea la misma con la que se cifró
  **todo** lo que hay en las copias (ENC1 no admitía rotación; se supone una
  sola clave en toda la vida de producción, pero no se puede comprobar sin
  descifrar).
- Que las copias actuales sigan siendo del esquema `produccion-d02ae0e`
  (es lo esperable, porque producción no se reconstruyó; la última verificación
  es del 16-sep).
- Que las notas, contextos y transcripciones descifren: es justamente lo que
  el ensayo tiene que mostrar.
- Los tiempos de restauración de §5.
- El comportamiento de `docker port` y de la red en WSL con Docker Desktop:
  hoy Docker no responde en esta distribución y no se pudo ensayar el bloque
  3.3.
