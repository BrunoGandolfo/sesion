# Cifrado en reposo de datos clínicos

Qué se cifra, cómo, y qué hacer con la clave. Describe el estado destino
tras la Fase 4 (solo columnas `*_encrypted`). Lo que dependa de que esa fase
esté aplicada está marcado con "[verificar tras Fase 4]". La versión de fase 1
está en `docs/historico/encryption-fase1.md`.

## 1. Qué se cifra

Extensión de Prisma Client `withEncryption` (`src/lib/prisma-encryption.ts`),
aplicada al cliente único de `src/lib/db.ts`. Cada campo lógico se escribe y
se lee desde una columna `Bytes` con `@map` a snake_case.

`SesionClinica`:

| Campo lógico | Columna | Contenido |
| --- | --- | --- |
| `transcripcion` | `transcripcion_encrypted` | Transcripción diarizada. |
| `notaSubjetivo`, `notaObjetivo`, `notaAnalisis`, `notaPlan` | `nota_soap_encrypted` | Un solo JSON `{subjetivo, objetivo, analisis, plan}`. |
| `notaSoapOriginal` | `nota_soap_original_encrypted` | Nota tal como la generó la IA; se escribe una sola vez. |
| `datosEstructurados` | `datos_estructurados_encrypted` | JSON de datos extraídos, incluida la clave temporal del audio mientras el audio existe. |
| `notasEdicion` | `notas_edicion_encrypted` | Comentarios de la profesional al aprobar. |

`PacienteContextoClinico` (Golden Thread), sin agrupar:

| Campo lógico | Columna |
| --- | --- |
| `hipotesisDiagnostica` | `hipotesis_diagnostica_encrypted` |
| `resumenAcumulativo` | `resumen_acumulativo_encrypted` |
| `riesgosHistoricos` | `riesgos_historicos_encrypted` (JSON serializado) |

No se cifran `objetivosTerapeuticos`, `intervencionesProbadas` ni
`temasRecurrentes` (columnas `Json`), por decisión documentada en
`prisma/schema.prisma`: son consultables para tableros.

El audio se cifra aparte, en el navegador, con una clave por sesión (ver
`docs/pipeline.md` §3.2). Los backups de la base se cifran con gpg (ver
`docs/operaciones.md`).

## 2. Cómo funciona

- Algoritmo AES-256-GCM (`src/lib/encryption.ts`). Clave de 32 bytes en
  `NOTES_ENCRYPTION_KEY`, codificada en base64. Se valida al construir el
  cliente: si falta o no decodifica a 32 bytes, la app no arranca.
- Formato del blob: `"ENC1"` (4 bytes) `||` IV (12 bytes) `||` tag (16 bytes)
  `||` ciphertext. IV aleatorio por escritura.
- La extensión intercepta `create`, `update`, `updateMany`, `upsert`,
  `find*`, `delete`, `deleteMany` de los dos modelos. Al escribir, traduce los
  campos lógicos a la columna cifrada. Al leer, agrega la columna cifrada al
  `select` y devuelve los campos lógicos descifrados.
- Un campo cifrado no puede usarse en `where` ni `orderBy`: la extensión
  lanza un error en runtime.
- Escribir directamente `*Encrypted` saltea la extensión. El único uso
  legítimo es `notaSoapEncrypted: null` al descartar una nota
  (`eliminar-sesion.ts`).

## 3. Estado tras la Fase 4

- [verificar tras Fase 4] Ya no existen columnas en texto plano para
  `transcripcion`, `notaSubjetivo`, `notaObjetivo`, `notaAnalisis`,
  `notaPlan`, `datosEstructurados`, `notasEdicion`, `hipotesisDiagnostica`,
  `resumenAcumulativo` ni `riesgosHistoricos`. Los campos lógicos existen solo
  en la extensión.
- [verificar tras Fase 4] El fallback de lectura a columna legacy (hoy un
  `console.warn` con "falling back to legacy column" en
  `prisma-encryption.ts`) deja de tener sentido: un blob sin prefijo `ENC1`
  debe tratarse como dato corrupto, no como legacy.
- [verificar tras Fase 4] Los dumps anteriores a la Fase 4 contienen texto
  clínico en claro en las columnas legacy. Descartarlos una vez que exista un
  backup posterior a la migración.
- `notaSoapOriginal` nunca tuvo columna en claro; si su blob no tiene prefijo
  la extensión devuelve `null`.

## 4. Verificación rápida

```sql
SELECT
  COUNT(*) FILTER (WHERE substring(nota_soap_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea) AS nota_soap_ok,
  COUNT(*) FILTER (WHERE substring(datos_estructurados_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea) AS datos_ok,
  COUNT(*) FILTER (WHERE substring(transcripcion_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea) AS transcripcion_ok,
  COUNT(*) AS total
FROM sesiones_clinicas;
```

`454e4331` es `ENC1` en hex. Un blob no nulo sin ese prefijo es un problema.

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
`DATABASE_URL_TEST` a producción.
