# Cifrado en reposo de datos clínicos y personales

Base: main e247d8b, 15 de septiembre de 2026. Qué se cifra, cómo, y qué hacer con las claves. Describe el estado vigente
tras la reconstrucción (esquema nuevo, formato `ENC2`). El formato anterior
(`ENC1`, una sola clave, sin rótulo por fila) no tiene datos que leer: la base
se creó desde cero.

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

El esquema PREVÉ audio cifrado por sesión (audio_clave_encrypted) y un IV por segmento (audio_segmentos.iv). La captura de main todavía guarda fragmentos locales sin cifrar y cifra el blob al terminar; no cumple la promesa de cifrado durante la grabación del consentimiento 2.0. La subida nueva está pendiente: ver `docs/pipeline.md`.

Los backups de la base se cifran con gpg (`docs/operaciones.md`). El workflow retiene diarios treinta días y mensuales 366 días; el consentimiento sólo informa treinta. Además, una copia puede conservar la clave de un audio todavía no aprobado. Destruir la clave en la fila activa no vuelve inaccesibles esas copias si se conservan las claves necesarias para descifrarlas.

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

### El llavero: `CLAVES_CIFRADO`

`src/lib/llavero.ts`. Una variable con la lista `"1=<base64>,2=<base64>"`
(32 bytes cada una). La activa es la de id más alto; las demás solo leen. Se
valida al construir el cliente: sin llavero, o con una clave mal formada, la
app no arranca. No hay tabla de claves.

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
`hilo_versiones` contra borrado y cambios de cualquier columna salvo `estado`,
`resuelta_en` y `resuelta_por_user_id`. Son triggers de la migración
`20260916013000_inmutabilidad`, también efectivos ante SQL crudo. El contenido
cifrado de una versión del Recorrido no se reemplaza ni siquiera por otro blob
válido para la misma fila.

## 3. Rotación de claves

Sin ventana de mantenimiento:

1. `openssl rand -base64 32` → agregar `,2=<nueva>` a `CLAVES_CIFRADO` en
   Vercel con `printf` (no `echo`). Deploy. Desde ese instante lo nuevo se
   cifra con la 2; lo viejo se sigue leyendo con la 1.
2. El cron diario de mantenimiento (`/api/cron/mantenimiento`) re-cifra hasta
   200 filas por corrida cuyo id de clave no sea el activo, en todas las
   columnas mutables de §1. Las versiones del Recorrido **no se reescriben**:
   permanecen en `pendientes`, cuentan como `errores` y se informa que hay que
   conservar su clave anterior. La rotación administrativa de esas versiones
   requiere un procedimiento separado; no hay una excepción para el cron.
   Para apurar: `GET /api/cron/mantenimiento?recifrar=todo`
   con el `CRON_SECRET` corre hasta agotar o hasta 50 s. Devuelve el objeto recifrado con recifradas, pendientes y errores.
3. Cuando pendientes y errores dan 0 en TODAS las columnas,
   sacar `1=…` de la variable. Deploy. Si quedara una fila con una clave
   ausente, su lectura falla con `clave 1 ausente del llavero` (nunca un
   texto vacío): el paso 3 no se hace hasta que dé 0.
4. Guardar la clave nueva en el gestor de contraseñas con fecha; la vieja se
   conserva protegida mientras haya backups que la necesiten, incluidas las
   copias mensuales de hasta 366 días y las que una limpieza fallida no haya
   eliminado. Retirarla de la app activa no significa destruirla del archivo
   de claves de recuperación.

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
- Cargar en Vercel con `printf 'CLAVES_CIFRADO=…'`, no `echo` (agrega un
  salto de línea).
- CI usa `1=<32 bytes en cero en base64>` solo para pasar la validación al
  importar `src/lib/db.ts`; los tests de cifrado generan claves propias.
- Sin la clave, las notas no se recuperan. Copia en el gestor de contraseñas,
  con fecha.

## 6. Tests

- `src/lib/__tests__/llavero.test.ts`, `src/lib/__tests__/encryption.test.ts`: unitarios.
- `src/lib/__tests__/prisma-encryption.test.ts`: unitario (cifrarX, guardas)
  e integración contra la base de test (`DATABASE_URL_TEST`, esquema nuevo),
  incluidos "blob movido de fila no descifra" y la rotación.
- La conexión y el vaciado de la base de test para estos archivos están en
  `src/lib/__tests__/base-identidad.ts`.
