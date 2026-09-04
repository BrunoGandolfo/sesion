# Cifrado en reposo de datos clínicos

Qué se cifra, cómo, y qué hacer con la clave. Describe el estado vigente:
solo existen columnas `*_encrypted`; las columnas en texto plano se
eliminaron (Fase 4). La versión de fase 1, con columnas legacy en paralelo y
script de backfill, está en `docs/historico/encryption-fase1.md`.

## 1. Qué se cifra

Extensión de Prisma Client `withEncryption` (`src/lib/prisma-encryption.ts`),
aplicada al cliente único de `src/lib/db.ts`. Cada campo lógico vive en una
columna `Bytes` con `@map` a snake_case. Los campos lógicos no existen en
`prisma/schema.prisma`: los define la extensión.

`SesionClinica`:

| Campo lógico | Tipo al leer | Columna | Contenido |
| --- | --- | --- | --- |
| `transcripcion` | `string \| null` | `transcripcion_encrypted` | Transcripción diarizada. |
| `notaSubjetivo`, `notaObjetivo`, `notaAnalisis`, `notaPlan` | `string \| null` | `nota_soap_encrypted` | Un solo JSON `{subjetivo, objetivo, analisis, plan}`. Una escritura reemplaza el JSON completo: las secciones no enviadas quedan en null. |
| `notaSoapOriginal` | `NotaSoapOriginal \| null` | `nota_soap_original_encrypted` | Nota tal como la generó la IA; se escribe una sola vez. |
| `datosEstructurados` | `unknown` (JSON parseado) | `datos_estructurados_encrypted` | Datos extraídos, incluida la clave temporal del audio mientras el audio existe. |
| `notasEdicion` | `string \| null` | `notas_edicion_encrypted` | Comentarios de la profesional al aprobar. |

`PacienteContextoClinico` (Golden Thread), sin agrupar:

| Campo lógico | Tipo al leer | Columna |
| --- | --- | --- |
| `hipotesisDiagnostica` | `string \| null` | `hipotesis_diagnostica_encrypted` |
| `resumenAcumulativo` | `string \| null` | `resumen_acumulativo_encrypted` |
| `riesgosHistoricos` | `unknown[] \| null` (JSON parseado) | `riesgos_historicos_encrypted` |

No se cifran `objetivosTerapeuticos`, `intervencionesProbadas` ni
`temasRecurrentes` (columnas `Json`), por decisión documentada en
`prisma/schema.prisma`: son consultables para tableros.

Tampoco se cifran todavía `Paciente.notas`, `Turno.notas` ni el texto del
consentimiento: es una tarea aparte.

El audio se cifra aparte, en el navegador, con una clave por sesión (ver
`docs/pipeline.md` §3.2). Los backups de la base se cifran con gpg (ver
`docs/operaciones.md`).

## 2. Cómo funciona

- Algoritmo AES-256-GCM (`src/lib/encryption.ts`). Clave de 32 bytes en
  `NOTES_ENCRYPTION_KEY`, codificada en base64. Se valida al construir el
  cliente: si falta o no decodifica a 32 bytes, la app no arranca.
- Formato del blob: `"ENC1"` (4 bytes) `||` IV (12 bytes) `||` tag (16 bytes)
  `||` ciphertext. IV aleatorio por escritura.
- Un blob no nulo que no descifra (sin prefijo `ENC1`, clave distinta, bytes
  alterados) es un dato corrupto: la lectura falla con error. No hay columna
  en claro a la que caer.

### Lectura: implícita y tipada

Cada campo lógico es un campo calculado de la extensión `result` de Prisma,
con `needs` sobre su columna cifrada y `compute` que descifra. El cliente
extendido lo conoce: se puede pedir en `select` (también dentro de una
relación) y su tipo es el de la tabla de §1. Al seleccionar un campo lógico
Prisma trae solo la columna cifrada y no la expone en el resultado. Sin
`select`, la fila trae todas las columnas, cifradas incluidas, más los campos
calculados.

```ts
const sesion = await db.sesionClinica.findFirst({
  where: { id, organizationId },
  select: { id: true, estado: true, notaPlan: true, datosEstructurados: true },
});
// sesion.notaPlan: string | null    sesion.datosEstructurados: unknown
```

### Escritura: explícita y tipada

`cifrarSesion` y `cifrarContexto` (`src/lib/prisma-encryption.ts`) toman
campos lógicos y devuelven las columnas cifradas listas para `data`, en
`create`, `update`, `updateMany`, `upsert` y `createMany`. `null` cifra como
null (deja la columna en NULL); `undefined` o ausente no toca la columna.
Las cuatro secciones SOAP viajan juntas: enviar una reemplaza el JSON
completo, y enviar las cuatro en null deja `nota_soap_encrypted` en NULL.

```ts
await db.sesionClinica.updateMany({
  where: { id, estado: "revision" },
  data: {
    estado: "aprobado",
    aprobadoEn: new Date(),
    ...cifrarSesion({
      notasEdicion,
      notaSubjetivo: notaEditada?.subjetivo,
      notaPlan: notaEditada?.plan,
      datosEstructurados: JSON.stringify(datosSinClave),
    }),
  },
});
```

Escribir un campo lógico directamente en `data` no compila (no existe en el
tipo generado) y escribir una columna `*Encrypted` a mano saltea el cifrado:
siempre pasar por `cifrarSesion` / `cifrarContexto`.

### Guarda: nada cifrado en `where` ni `orderBy`

Una extensión `query` sobre los dos modelos rechaza en runtime cualquier
`where` u `orderBy` (incluidos `AND` / `OR` / `NOT`) que nombre un campo
lógico o una columna cifrada. `assertConsultaSinCifrados` está exportada para
probarla sin base.

## 3. Estado tras la Fase 4

- Ya no existen columnas en texto plano para `transcripcion`,
  `notaSubjetivo`, `notaObjetivo`, `notaAnalisis`, `notaPlan`,
  `datosEstructurados`, `notasEdicion`, `hipotesisDiagnostica`,
  `resumenAcumulativo` ni `riesgosHistoricos`. Los campos lógicos existen solo
  en la extensión.
- No hay fallback de lectura a columna legacy ni escritura a columnas en
  claro. El script de backfill `scripts/migrate-encrypt-existing-notas.ts`
  quedó vacío y debe borrarse.
- Los dumps anteriores a la Fase 4 contienen texto clínico en claro en las
  columnas legacy. Descartarlos una vez que exista un backup posterior a la
  migración.

## 4. Verificación rápida

```sql
SELECT
  COUNT(*) FILTER (WHERE substring(nota_soap_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea) AS nota_soap_ok,
  COUNT(*) FILTER (WHERE substring(nota_soap_original_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea) AS nota_soap_original_ok,
  COUNT(*) FILTER (WHERE substring(datos_estructurados_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea) AS datos_ok,
  COUNT(*) FILTER (WHERE substring(transcripcion_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea) AS transcripcion_ok,
  COUNT(*) FILTER (WHERE substring(notas_edicion_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea) AS notas_edicion_ok,
  COUNT(*) AS total
FROM sesiones_clinicas;
```

`454e4331` es `ENC1` en hex. Un blob no nulo sin ese prefijo es un problema:
la extensión falla al leer esa fila.

Y que las columnas legacy no existan:

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'sesiones_clinicas' AND column_name IN
      ('transcripcion', 'notaSubjetivo', 'notaObjetivo', 'notaAnalisis',
       'notaPlan', 'datosEstructurados', 'notasEdicion'))
    OR (table_name = 'paciente_contexto_clinico' AND column_name IN
      ('hipotesis_diagnostica', 'resumen_acumulativo', 'riesgos_historicos'))
  );
```

Debe devolver cero filas.

## 5. La clave

- Generar: `openssl rand -base64 32`.
- Cargar en Vercel con `printf` (no `echo`, que agrega un salto de línea):
  `printf 'CLAVE' | vercel env add NOTES_ENCRYPTION_KEY production`.
- Guardar copia en el gestor de contraseñas con fecha. Sin la clave, las
  notas no se recuperan.
- CI usa una clave dummy (32 bytes en cero) solo para pasar la validación al
  importar `db.ts`; los tests de cifrado generan una propia.
- No hay rotación automática. Rotar implica descifrar con la clave vieja y
  re-cifrar con la nueva todas las columnas listadas en §1; no existe script
  para eso hoy.

## 6. Tests

`src/lib/__tests__/prisma-encryption.test.ts` corre contra la rama `test` de
Neon (`DATABASE_URL_TEST`) y hace `TRUNCATE ... CASCADE` en cada caso. Por eso
`vitest.config.ts` fija `fileParallelism: false`. Nunca apuntar
`DATABASE_URL_TEST` a producción. La rama `test` tiene que tener aplicada la
migración que elimina las columnas legacy.
