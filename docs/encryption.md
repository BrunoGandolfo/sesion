# Cifrado en reposo de datos clínicos y personales

Qué se cifra, cómo, y qué hacer con las claves. Describe el formato vigente,
`ENC2`. El anterior (`ENC1`, una sola clave, sin rótulo por fila) no lo escribe
ni lo lee la app; sólo puede aparecer en un respaldo de la base anterior a la
reconstrucción, y el ensayo de restauración lo reconoce (`docs/operaciones.md` §4).

## 1. Qué se cifra

Extensión de Prisma Client `withEncryption` (`src/lib/prisma-encryption.ts`),
aplicada al único cliente de `src/lib/db.ts`. Cada campo lógico vive en una
columna `Bytes` (`*_encrypted`). Los campos lógicos no existen en
`prisma/schema.prisma`: los define la tabla CAMPOS_CIFRADOS de la extensión,
que es el contrato del anexo de `docs/esquema.md`.

| Modelo (tabla) | Campo lógico | Columna | Tipo al leer |
| --- | --- | --- | --- |
| `Paciente` (`pacientes`) | `notas` | `notas_encrypted` | `string \| null` |
| `Turno` (`turnos`) | `notas` | `notas_encrypted` | `string \| null` |
| `ConsentimientoGrabacion` (`consentimientos_grabacion`) | `textoCompleto` | `texto_completo_encrypted` | `string` |
| | `firmaDigital` | `firma_digital_encrypted` | `string` |
| `HotWord` (`hot_words`) | `termino` | `termino_encrypted` | `string` |
| `SesionClinica` (`sesiones_clinicas`) | `audioClave` | `audio_clave_encrypted` | `string \| null` (base64) |
| | `transcripcion` | `transcripcion_encrypted` | `string \| null` |
| | `notaIa` | `nota_ia_encrypted` | `NotaSoap \| null` |
| | `datos` | `datos_encrypted` | `unknown` (JSON parseado) |
| | `feedback` | `feedback_encrypted` | `unknown` (JSON parseado) |
| | `notaFinal` | `nota_final_encrypted` | `NotaSoap \| null` |
| | `notasEdicion` | `notas_edicion_encrypted` | `string \| null` |
| `HiloVersion` (`hilo_versiones`) | `contenido` | `contenido_encrypted` | `unknown` (JSON parseado) |

`NotaSoap` es `{ subjetivo, objetivo, analisis, plan }`, cada sección
`string | null`; al escribir se normaliza a esas cuatro claves.

Quedan en claro, a propósito: nombre, apellido y teléfono de la paciente (la
búsqueda, el orden de la agenda y el envío de SMS los necesitan en SQL),
fechas y montos, `speech_analytics` (números), IP y navegador en
`sesiones_acceso` e `intentos_acceso` (purgas según fecha y estado; no son treinta días desde la creación en todos los casos). La lista completa está en
`docs/esquema.md`.

**La app no cifra el audio.** Se guarda como `Blob` en IndexedDB mientras se graba (`src/lib/grabacion-storage.ts`), viaja a R2 por TLS con un PUT prefirmado, R2 lo cifra en reposo (cifrado del proveedor, no de la app) y se pide borrarlo al aprobar o eliminar la sesión. El campo lógico `audioClave` (`audio_clave_encrypted`) y la columna `audio_iv` siguen en el esquema sin usarse: sólo tienen valor en sesiones grabadas con la versión que cifraba en el teléfono. Consecuencia que hay que saber: ya no existe una clave cuya destrucción vuelva ilegible un audio que no se pudo borrar. Ver `docs/pipeline.md`.

Los backups de la base se cifran con gpg (`docs/operaciones.md`). El workflow retiene diarios treinta días y mensuales 366 días (doce meses), lo mismo que informa el consentimiento. Una copia anterior puede conservar la clave de un audio grabado con la versión que cifraba; las sesiones nuevas no tienen clave de audio.

## 2. Cómo funciona

### El blob: `ENC2`

```
byte 0-3   "ENC2"
byte 4     id de la clave (1..255)
byte 5-16  IV (12 bytes aleatorios por escritura)
byte 17-32 tag de AES-GCM (16 bytes)
byte 33-   ciphertext
```

AES-256-GCM (`src/lib/encryption.ts`). El **AAD** (datos asociados
autenticados: un rótulo que entra en el tag pero no viaja en el blob) es
`"<tabla>:<columna>:<id de la fila>"` con los nombres de la base, por
ejemplo `sesiones_clinicas:nota_ia_encrypted:7f3a…`. Un blob copiado a otra
fila, otra columna u otra tabla no descifra. Por eso el **id existe antes del
create**: los ids son uuid que genera la app (`crypto.randomUUID()`).

### El llavero: `CLAVES_CIFRADO` (y, rotando, `CLAVES_CIFRADO_NUEVAS`)

`src/lib/llavero.ts`. Una variable con la lista `"1=<base64>,2=<base64>"`
(32 bytes cada una). La activa es la de id más alto; las demás solo leen. Se
valida al construir el cliente: sin llavero, o con una clave mal formada, la
app no arranca. No hay tabla de claves.

Durante una rotación existe además `CLAVES_CIFRADO_NUEVAS`, con el mismo
formato. Las dos se fusionan en un solo llavero: la activa es el id más alto
del conjunto, y un id presente en las dos es un error (la app no arranca).
Existe porque en Vercel `CLAVES_CIFRADO` es *Sensitive*, de solo escritura:
agregar una clave a esa variable exigiría reescribirla entera, o sea conocer
la vigente. Con la segunda variable la clave nueva se agrega sin leer ni
tocar la vigente. Fuera de una rotación no existe, y sin ella todo se
comporta exactamente como con una sola variable.

### Lectura: implícita y tipada

Cada campo lógico es un campo calculado de la extensión `result`, con
`needs` sobre su columna cifrada y sobre `id`. Se puede pedir en `select`
(también dentro de una relación) y su tipo es el de la tabla de §1.

```ts
const p = await db.paciente.findUnique({ where: { id }, select: { id: true, notas: true } });
// p.notas: string | null
```

### Escritura: explícita y tipada

`cifrarPaciente`, `cifrarTurno`, `cifrarConsentimiento`, `cifrarHotWord`,
`cifrarSesion`, `cifrarHiloVersion` (`src/lib/prisma-encryption.ts`) reciben
el **id de la fila** y los campos lógicos, y devuelven `{ id, ...columnas }`
listo para `data`. `null` deja la columna en NULL; `undefined` o ausente no
la toca. Los campos `json` (`datos`, `feedback`, `contenido`) aceptan el
objeto o el string JSON ya serializado.

```ts
const id = crypto.randomUUID();
await db.turno.create({
  data: { fecha, tarifaCobrada, pacienteId, organizationId, ...cifrarTurno(id, { notas }) },
});

await db.sesionClinica.updateMany({
  where: { id, organizationId, estado: "revision" },
  data: { estado: "aprobada", ...cifrarSesion(id, { notaFinal, notasEdicion, audioClave: null }) },
});
```

Escribir un campo lógico directamente en `data` no compila (no existe en el
tipo generado). Escribir una columna `*Encrypted` a mano pasa por la guarda 2.

### Guardas (extensión `query`, seis modelos)

1. **Nada cifrado en `where` ni `orderBy`** (también dentro de `AND` / `OR` /
   `NOT`): error en runtime. `assertConsultaSinCifrados` está exportada para
   probarla sin base.
2. **Toda escritura de una columna cifrada lleva el id de su fila y el blob
   descifra con el AAD de esa fila**: `data.id` en `create`/`createMany`,
   `where.id` en `update`/`updateMany`, ambos en `upsert`. Un `create` sin
   id, un `updateMany` por organización, o un blob cifrado para otra fila se
   rechazan antes de llegar a la base. Cuesta un descifrado por columna
   escrita. `assertEscrituraCifradaConsistente` está exportada.

Las guardas también recorren las escrituras anidadas siguiendo las relaciones
del cliente generado: `create`, `createMany`, `update`, `updateMany`, `upsert`
y `connectOrCreate`, incluso bajo modelos sin columnas cifradas. Un update
singular cifrado usa `{ where: { id }, data: ... }`: la relación implícita o
`data.id` no demuestran cuál es el destino. No se hacen lecturas previas ni se
adivinan ids. Cambiar el id de una fila cifrada se rechaza para no invalidar el
AAD de las columnas existentes. El SQL crudo no pasa por estas guardas.

La base protege además `eventos_auditoria` contra UPDATE, DELETE y TRUNCATE, y
`hilo_versiones` contra borrado y contra cualquier UPDATE que no sea uno de
estos dos: la resolución (`estado`, `resuelta_en`, `resuelta_por_user_id`), o
el cambio de envoltorio, en el que la ÚNICA columna que cambia es
`contenido_encrypted`, el blob nuevo es ENC2 y su id de clave (byte 4) es
distinto del anterior. Una versión se reescribe solo para cambiar la clave con
que está cifrada, nunca su contenido: otro blob con el mismo id de clave se
rechaza aunque sea válido para la fila, y las dos cosas en un mismo UPDATE
también. Son triggers de `20260916013000_inmutabilidad`, con la función
reemplazada por `20260928120000_hilo_versiones_recifrado`, efectivos también
ante SQL crudo (ERRCODE 55000). La base no tiene la clave: garantiza que solo
cambie la clave, no puede comparar los textos. Que el texto sea el mismo lo
asegura el re-cifrado del cron, que descifra y vuelve a cifrar lo mismo.

## 3. Rotación de claves

Sin ventana de mantenimiento, y **sin leer nunca la clave vigente**: en
Vercel Production `CLAVES_CIFRADO` es *Sensitive* y nadie puede leerla. El
procedimiento no la necesita. Se agrega la nueva en otra variable
(`CLAVES_CIFRADO_NUEVAS`), el cron recifra todo con ella y al final la nueva
pasa a ser la única.

Reglas para todos los pasos:

- Las claves entran a la terminal con `read -rs` (no se ven ni quedan en el
  historial) y salen con `printf '%s'`, **nunca `echo`**: `echo` agrega un
  salto de línea que termina dentro de la variable.
- Ninguna clave se pega en el chat, un issue, un commit, un acta ni una
  captura. Al acta va el **id**, nunca el valor.
- Los comandos `vercel` se corren desde un directorio vinculado al proyecto
  de Sesión (`vercel link`). Cada paso dice también dónde está en el panel.
- `<ID_NUEVO>` es el id de clave más alto en uso más uno. Los ids en uso
  están en la variable de Actions `CLAVES_CIFRADO_IDS` (solo ids, se puede
  leer): `gh variable get CLAVES_CIFRADO_IDS`. Hoy es `1`, así que la
  primera rotación usa `2`. Nunca reutilizar un id retirado.

### Paso 0. Generar la clave nueva y guardarla en el gestor, ANTES que nada

Obligatorio. El acta del ensayo (paso 5) verifica que la clave esté en el
gestor. Una clave que existe solo en Vercel es una clave que se pierde: así
se perdió la 1.

```bash
NUEVA="$(openssl rand -base64 32)"
# 32 bytes exactos; tiene que imprimir 32.
printf '%s' "$NUEVA" | base64 -d | wc -c
# Al portapapeles, sin mostrarla (WSL/Windows: clip.exe; macOS: pbcopy;
# Linux: wl-copy o xclip -selection clipboard).
printf '%s' "$NUEVA" | clip.exe
```

En el gestor de contraseñas, entrada nueva, pegar como contraseña. Etiqueta:
`CLAVES_CIFRADO id <ID_NUEVO> — Vercel Production — <AAAA-MM-DD>`. Guardar.
Vaciar el portapapeles (copiar cualquier otra cosa).

Comprobar que lo guardado es lo generado: copiar la contraseña desde el
gestor y pegarla en el `read`:

```bash
read -rsp 'Clave nueva, copiada DESDE el gestor: ' COPIA; printf '\n'
[ "$COPIA" = "$NUEVA" ] && printf 'coincide\n' || printf 'NO COINCIDE: no seguir\n'
unset NUEVA
```

Si no dice `coincide`, no seguir: corregir la entrada del gestor y repetir la
comprobación. Desde acá, lo que se carga es `COPIA`, la del gestor.

### Paso 1. Cargar `CLAVES_CIFRADO_NUEVAS` en Production (Sensitive) y desplegar

`CLAVES_CIFRADO` no se toca.

```bash
printf '%s' "<ID_NUEVO>=$COPIA" | vercel env add CLAVES_CIFRADO_NUEVAS production --sensitive
```

(Panel: Settings → Environment Variables → Add; nombre
`CLAVES_CIFRADO_NUEVAS`, valor `<ID_NUEVO>=` seguido de la clave pegada del
gestor, solo **Production**, **Sensitive** marcado.)

Desplegar: un cambio de variable no llega a la app hasta el próximo
despliegue. Panel: Deployments → el último de Production → ⋯ → Redeploy.

Comprobar: `curl -fsS https://sesionapp.app/api/health` contesta 200 y la
app abre una nota vieja. Desde este despliegue todo lo que se escribe sale
con la clave nueva; lo viejo se sigue leyendo con la 1. Si el id nuevo
repitiera uno de `CLAVES_CIFRADO`, el build falla (`ErrorLlavero: …
repetido en CLAVES_CIFRADO y CLAVES_CIFRADO_NUEVAS`) y el despliegue no se
publica: la app sigue con el anterior. Corregir el valor (borrar la
variable y volver a crearla) y desplegar de nuevo.

A partir de acá los respaldos diarios ya traen blobs con `<ID_NUEVO>`: hacer
el paso 4 hoy mismo, no al final (ver ahí por qué).

### Paso 2. Recifrar hasta que `pendientes` y `errores` den 0

El cron diario (`/api/cron/mantenimiento`, 04:00 UTC) recifra hasta 200
filas por corrida en **todas** las columnas de §1, incluida
`hilo_versiones.contenido_encrypted` (la base admite ese único cambio: el
mismo contenido, otra clave; ver §2 Guardas). Para no esperar, con
`CRON_SECRET` (copia del gestor; es una lista, sirve cualquiera de sus
valores):

```bash
read -rsp 'CRON_SECRET: ' CRON_SECRET; printf '\n'
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  'https://sesionapp.app/api/cron/mantenimiento?recifrar=todo'
unset CRON_SECRET
```

Corre hasta agotar o hasta 50 s. La respuesta trae
`"recifrado":{"recifradas":…,"pendientes":…,"errores":…}`. Repetir hasta
que **`pendientes` sea 0 y `errores` sea 0 en la misma respuesta**.
`pendientes` es la suma de todas las columnas cifradas, así que 0 significa
0 en cada una, `hilo_versiones` incluida.

Sin copia de `CRON_SECRET`: `vercel crons run /api/cron/mantenimiento` (o
Settings → Cron Jobs → Run) dispara una tanda de 200 sin conocer el secreto;
el resultado aparece en Logs, filtrando `[mantenimiento]`:
`recifradas=… pendientes=0 errores=0`. Repetir hasta que la línea dé 0 y 0.

`errores` mayor que 0 es un blob que no descifra con ninguna clave del
llavero: el log de esa corrida dice tabla, columna e id. No se sigue al
paso 3 hasta resolverlo: retirar la clave vieja lo volvería ilegible.

### Paso 3. La nueva pasa a ser la única: una sola variable, como antes

Solo con `pendientes` 0 y `errores` 0 del paso 2. Las dos cosas antes de
desplegar: con `<ID_NUEVO>` en las dos variables el build falla y el
despliegue no se publica.

```bash
vercel env rm CLAVES_CIFRADO production --yes
printf '%s' "<ID_NUEVO>=$COPIA" | vercel env add CLAVES_CIFRADO production --sensitive
vercel env rm CLAVES_CIFRADO_NUEVAS production --yes
unset COPIA
```

(Panel: borrar `CLAVES_CIFRADO`; crearla de nuevo con `<ID_NUEVO>=` y la
clave del gestor, Production, Sensitive; borrar `CLAVES_CIFRADO_NUEVAS`.)
Si `COPIA` ya no está en la terminal, volver a leerla del gestor con
`read -rsp`.

Desplegar (Redeploy, como en el paso 1). Comprobar: `/api/health` en 200,
una nota vieja y una versión del Recorrido se abren, y una corrida más del
paso 2 da `pendientes` 0 y `errores` 0 con el llavero de una sola clave.
Si algo quedó con la clave vieja, su lectura falla con `clave 1 ausente del
llavero` (nunca un texto vacío): volver a cargar `CLAVES_CIFRADO_NUEVAS` no
sirve (la vieja ya no está en Vercel); ver la advertencia del paso 4.

Estado final: una sola variable, `CLAVES_CIFRADO="<ID_NUEVO>=…"`, sin
`CLAVES_CIFRADO_NUEVAS`.

### Paso 4. Agregar el id nuevo a `CLAVES_CIFRADO_IDS` de GitHub Actions

Se AGREGA al valor que ya tiene; nunca se escribe la lista de memoria (en la
segunda rotación, `1,2` tiene que quedar `1,2,3`, no `1,3`):

```bash
IDS="$(gh variable get CLAVES_CIFRADO_IDS)"; printf 'antes: %s\n' "$IDS"
gh variable set CLAVES_CIFRADO_IDS --body "$IDS,<ID_NUEVO>"
gh variable get CLAVES_CIFRADO_IDS          # tiene que ser lo de antes más ,<ID_NUEVO>
```

Hacerlo apenas termina el paso 1: desde ese despliegue los respaldos traen
blobs con el id nuevo, y el ensayo automático (día 2 de cada mes) falla ante
un id que no figura en la lista. Los ids viejos **se quedan** mientras
existan respaldos que los usen: las diarias vencen solas, las mensuales
duran 366 días. Un id viejo se saca recién cuando venció la última copia
anterior a la rotación.

**Los respaldos anteriores a la rotación solo abren sus notas con la clave
anterior. Si esa clave no está guardada offline, las notas de esos
respaldos son irrecuperables; la base (tablas, filas, claves foráneas) sí se
restaura.** Después del paso 3 la clave anterior deja de existir en Vercel.
Si no está en el gestor, esa es la última copia que había.

### Paso 5. Repetir el ensayo manual con el primer respaldo posterior

Con la primera copia diaria tomada **después del paso 3** (el respaldo corre
a las 06:00 UTC), seguir `docs/operaciones/ensayo-manual.md`. Lo que este
paso prueba es la **diaria**: §3.2 la elige sola (la más reciente), y §3.4 y
§3.5 se corren con el llavero `<ID_NUEVO>=<clave del gestor>`, leído con
`read -rs`. Tiene que descifrar todas las muestras.

La mensual más vieja (§3.6) es anterior a la rotación y trae blobs con la
clave vieja. Se ensaya con el llavero de su época: la clave vieja **y** la
nueva, las dos del gestor. Si la vieja no está en el gestor, §3.6 va a decir
`falta la clave <n> en el llavero`: no es corrupción ni un fallo del paso 5.
Se anota en el acta como clave histórica no disponible (id y fecha de la
copia), junto con la advertencia del paso 4, y el ensayo sigue válido para
la diaria.

El acta registra que la clave nueva estaba en el gestor antes de cargarse
(paso 0), los ids (nunca los valores) y qué muestras descifraron.

Incidentes ("creo que se filtró la clave"): `docs/operaciones.md` §5.

## 4. Verificación rápida

Muestra de distribución por id de clave en tres columnas (no certifica que
el resto del esquema ya terminó de recifrarse):

```sql
SELECT 'pacientes' AS tabla, get_byte(notas_encrypted, 4) AS id_clave, count(*)
  FROM pacientes WHERE notas_encrypted IS NOT NULL GROUP BY 2
UNION ALL
SELECT 'sesiones_clinicas', get_byte(nota_ia_encrypted, 4), count(*)
  FROM sesiones_clinicas WHERE nota_ia_encrypted IS NOT NULL GROUP BY 2
UNION ALL
SELECT 'hilo_versiones', get_byte(contenido_encrypted, 4), count(*)
  FROM hilo_versiones GROUP BY 2;
```

Un blob no nulo cuyos primeros cuatro bytes no sean `\x454e4332` (`ENC2` en
hex) es un problema: la extensión falla al leer esa fila.

## 5. Las claves

- Generar: `openssl rand -base64 32`.
- Guardarla en el gestor de contraseñas antes de cargarla en ningún lado
  (§3, paso 0).
- Cargar en Vercel con `printf '%s' … | vercel env add … --sensitive`, no
  `echo` (agrega un salto de línea).
- CI usa `1=<32 bytes en cero en base64>` solo para pasar la validación al
  importar `src/lib/db.ts`; los tests de cifrado generan claves propias.
- Sin la clave, las notas no se recuperan. Copia en el gestor de contraseñas,
  con fecha.

## 6. Tests

- `src/lib/__tests__/llavero.test.ts`, `src/lib/__tests__/encryption.test.ts`: unitarios.
- `src/lib/__tests__/prisma-encryption.test.ts`: unitario (cifrarX, guardas)
  e integración contra la base de test (`DATABASE_URL_TEST`, esquema nuevo),
  incluidos "blob movido de fila no descifra" y la rotación.
- `src/lib/__tests__/hilo-recifrado-integracion.test.ts`: integración, por SQL
  crudo, de lo que la base admite en `hilo_versiones` (la resolución, o solo
  la clave del contenido). `src/lib/__tests__/endurecer-integracion.test.ts`:
  el cron recifra las versiones del Recorrido sin cambiar su contenido.
- La conexión y el vaciado de la base de test para estos archivos están en
  `src/lib/__tests__/base-identidad.ts`.
