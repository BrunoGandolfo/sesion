# Cifrado de notas clínicas — guía operacional

Este documento describe el sistema de cifrado en reposo de notas clínicas: qué cifra, cómo funciona, cómo verificar que está bien aplicado, cómo gestionar la clave maestra, y cómo hacer rollback.

Está pensado para alguien con conocimiento básico de terminal y SQL. No requiere saber criptografía ni leer el código de la app.

---

## 1. Qué se cifra y por qué

El sistema cifra los campos de `SesionClinica` que contienen información clínica sensible del paciente. Hay **4 campos lógicos cifrados**, almacenados en 4 columnas físicas `BYTEA`:

| Campo lógico (Prisma) | Columna física (Postgres) | Contenido en claro |
| --- | --- | --- |
| `transcripcionEncrypted` | `transcripcion_encrypted` | Transcripción diarizada completa de la sesión. |
| `notaSoapEncrypted` | `nota_soap_encrypted` | JSON con las 4 secciones SOAP consolidadas: `{subjetivo, objetivo, analisis, plan}`. La extensión de Prisma toma `notaSubjetivo`, `notaObjetivo`, `notaAnalisis`, `notaPlan` desde la app y los serializa a un único JSON cifrado. |
| `datosEstructuradosEncrypted` | `datos_estructurados_encrypted` | JSON con temas, emociones, alianza, alertas extraídas por IA. |
| `notasEdicionEncrypted` | `notas_edicion_encrypted` | Ediciones manuales que la profesional hace sobre la nota generada. |

**Por qué cifrar.** La Ley 18.331 de Uruguay clasifica los datos de salud como datos sensibles. Su tratamiento exige medidas técnicas que limiten el acceso no autorizado, incluso ante una filtración de la base de datos. El cifrado en reposo es la mitigación principal: si alguien obtiene un dump de la DB, ve blobs binarios sin valor.

**Estrategia aditiva (fase 1).** El schema actual mantiene en paralelo las columnas legacy en texto plano (ver §5) y las 4 columnas `*_encrypted`. La fase 2 (próximo sprint) elimina las legacy y renombra las cifradas a sus nombres definitivos.

---

## 2. Cómo funciona

**Algoritmo:** AES-256-GCM. Clave única de 32 bytes derivada de la variable de entorno `NOTES_ENCRYPTION_KEY` (codificada en base64). GCM aporta autenticación: detecta cualquier manipulación del ciphertext.

**Formato del blob.** Cada valor cifrado en la DB es un `BYTEA` con esta estructura concatenada:

```
"ENC1" magic (4 bytes) || IV (12 bytes) || authTag (16 bytes) || ciphertext (N bytes)
```

- **Magic prefix `ENC1`** — bytes `0x45 0x4E 0x43 0x31`. Permite distinguir a simple vista si una fila está cifrada (ver §4).
- **IV** — 12 bytes aleatorios por escritura (recomendación estándar para GCM).
- **authTag** — 16 bytes generados por GCM al cifrar; se verifican al descifrar.
- **ciphertext** — el plaintext UTF-8 cifrado.

Un plaintext vacío produce un blob de 32 bytes (4 + 12 + 16 + 0). El cifrado y descifrado ocurren a nivel aplicación, mediante una extensión de Prisma Client (`src/lib/prisma-encryption.ts`). Las columnas cifradas no deben usarse en `WHERE`, `ORDER BY` ni índices — la extensión rechaza esos usos explícitamente.

---

## 3. Migraciones involucradas

Dos migraciones aditivas componen la fase 1:

1. **`20260505142540_encrypt_notas_clinicas`** — agrega tres columnas `BYTEA NULL`:
   - `transcripcion_encrypted`
   - `nota_soap_encrypted`
   - `datos_estructurados_encrypted`
2. **`20260505143816_add_notas_edicion_encrypted`** — agrega la cuarta:
   - `notas_edicion_encrypted`

Ambas son **100% aditivas**: no tocan, renombran ni eliminan columnas existentes. Aplicarlas y luego revertirlas no destruye datos (ver §8).

---

## 4. Cómo verificar que el cifrado funciona

Para confirmar que las filas existentes están cifradas, conectarse a la DB y ejecutar:

```sql
SELECT
  id,
  encode(substring(transcripcion_encrypted FROM 1 FOR 4), 'hex') AS transcripcion_prefix,
  encode(substring(nota_soap_encrypted FROM 1 FOR 4), 'hex') AS nota_soap_prefix,
  encode(substring(datos_estructurados_encrypted FROM 1 FOR 4), 'hex') AS datos_prefix,
  encode(substring(notas_edicion_encrypted FROM 1 FOR 4), 'hex') AS notas_edicion_prefix
FROM sesiones_clinicas
LIMIT 10;
```

Cada `*_prefix` no nulo debe valer exactamente `454e4331` (el magic `ENC1` en hex). Cualquier otro valor o un `NULL` cuando se esperaba contenido indica una fila sin cifrar (legacy o falla de migración).

**Conteo agregado por columna:**

```sql
SELECT
  COUNT(*) FILTER (
    WHERE substring(transcripcion_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea
  ) AS transcripcion_ok,
  COUNT(*) FILTER (
    WHERE substring(nota_soap_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea
  ) AS nota_soap_ok,
  COUNT(*) FILTER (
    WHERE substring(datos_estructurados_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea
  ) AS datos_estructurados_ok,
  COUNT(*) FILTER (
    WHERE substring(notas_edicion_encrypted FROM 1 FOR 4) = '\x454e4331'::bytea
  ) AS notas_edicion_ok,
  COUNT(*) AS total_filas
FROM sesiones_clinicas;
```

Para cada columna, comparar el `*_ok` contra cuántas filas legacy correspondientes tenían contenido. Si una `*_ok` quedó en cero pero la columna legacy tenía datos, la migración no se completó para esa columna (ver §7).

---

## 5. Columnas legacy a eliminar en fase 2

Mientras dure la fase 1, conviven en `sesiones_clinicas` las columnas cifradas y las **7 columnas legacy en texto plano**:

| Nombre Prisma | Nombre físico en Postgres | Tipo | Cifrada en |
| --- | --- | --- | --- |
| `transcripcion` | `transcripcion` | `TEXT` | `transcripcion_encrypted` |
| `notaSubjetivo` | `"notaSubjetivo"` | `TEXT` | `nota_soap_encrypted` (sección S del JSON) |
| `notaObjetivo` | `"notaObjetivo"` | `TEXT` | `nota_soap_encrypted` (sección O del JSON) |
| `notaAnalisis` | `"notaAnalisis"` | `TEXT` | `nota_soap_encrypted` (sección A del JSON) |
| `notaPlan` | `"notaPlan"` | `TEXT` | `nota_soap_encrypted` (sección P del JSON) |
| `datosEstructurados` | `"datosEstructurados"` | `TEXT` | `datos_estructurados_encrypted` |
| `notasEdicion` | `"notasEdicion"` | `TEXT` | `notas_edicion_encrypted` |

> **Atención al escribir SQL crudo.** Estas 7 columnas legacy **no** tienen `@map` en el schema, así que Postgres las almacena con el mismo nombre camelCase que usa Prisma. Como Postgres folds identificadores no-quoted a minúsculas, hay que **envolverlas en comillas dobles** en cualquier query SQL para que se resuelvan: `SELECT "notaSubjetivo" FROM sesiones_clinicas`, no `SELECT nota_subjetivo`. La única que se puede escribir sin comillas es `transcripcion` porque ya está en minúsculas. Esto incluye los `DROP COLUMN` de fase 2.
>
> En contraste, las 4 columnas `*_encrypted` **sí** tienen `@map` a snake_case (`transcripcion_encrypted`, `nota_soap_encrypted`, `datos_estructurados_encrypted`, `notas_edicion_encrypted`) y se usan sin comillas.

Estas columnas se mantienen para que el script de backfill (§7) pueda leer los datos originales, y para que la extensión de Prisma tenga un fallback de lectura si una fila no quedó cifrada. La fase 2 las eliminará y renombrará las `*_encrypted` a sus nombres definitivos (`transcripcion`, `nota_soap`, `datos_estructurados`, `notas_edicion`).

**Implicancia para backups.** Hasta que ocurra fase 2, los dumps de la DB contienen PII en plaintext en las columnas legacy. Cifrar los nuevos datos no los protege si el último dump físico aún tiene los mismos campos en claro al lado. Una vez completada fase 2, descartar los dumps anteriores que todavía contengan columnas legacy.

---

## 6. Gestión de la clave

**Una sola clave maestra**, codificada en base64 (32 bytes), almacenada en la variable `NOTES_ENCRYPTION_KEY`. No hay rotación automática, ni KMS, ni servicios externos: todo es Node `crypto` nativo leyendo `process.env`.

**Generar la clave por primera vez:**

```bash
openssl rand -base64 32
```

El comando imprime una línea como `J2x9...=`. Copiala completa, sin espacios al final.

**Guardarla en `.env` local** (el archivo está en `.gitignore`):

```
NOTES_ENCRYPTION_KEY="LA-CLAVE-BASE64-GENERADA"
```

**Subirla a Vercel producción.** Usar `printf` (no `echo`, porque `echo` agrega un `\n` final que rompe el parseo de la clave):

```bash
printf 'LA-CLAVE-BASE64-GENERADA' | vercel env add NOTES_ENCRYPTION_KEY production -y
```

Verificar que quedó:

```bash
vercel env ls production
```

**Resguardo.** Guardar una copia de la clave en **1Password** con un timestamp claro (ej: `NOTES_ENCRYPTION_KEY (activa desde 2026-05-05)`). Sin esa copia, perder la clave equivale a perder las notas: AES-256-GCM no tiene puerta trasera.

**Reglas operativas:**

- No commitear la clave bajo ningún concepto.
- No compartirla por chat, email o ticket sin cifrar.
- No loguearla, ni siquiera parcialmente, en consola, Sentry o archivos.

---

## 7. Procedimiento de backfill (datos preexistentes)

El script `scripts/migrate-encrypt-existing-notas.ts` recorre las filas existentes de `sesiones_clinicas` y rellena las columnas `*_encrypted` a partir del contenido de las columnas legacy.

**Cuándo correrlo.** **Una sola vez**, después de:

1. Aplicar las dos migraciones de §3.
2. Setear `NOTES_ENCRYPTION_KEY` en producción (§6).
3. Tomar un backup de la base (Neon → branch o snapshot manual).

Si alguno de los tres pasos falta, no correr el script.

**Comando:**

```bash
npx tsx scripts/migrate-encrypt-existing-notas.ts
```

**Idempotencia.** El script es idempotente: detecta filas cuyas columnas `*_encrypted` ya empiezan con `ENC1` y las omite. Es seguro re-correrlo si una corrida previa quedó parcial. Procesa en lotes y al final imprime un resumen con `total candidatas`, `procesadas`, `ya cifradas (skip)` y `fallidas`. Si `fallidas > 0`, el proceso termina con exit code 1.

**Verificación.** Correr la query agregada de §4 y comparar contra los conteos de filas legacy con contenido.

---

## 8. Rollback

El esquema fase 1 está diseñado para revertirse sin pérdida de datos preexistentes:

1. **Desactivar la extensión de Prisma** (`withEncryption(...)` en el bootstrap del cliente). Sin este paso, las queries siguen pidiendo columnas que ya no existirán y fallan.
2. **Revertir las migraciones** de §3 (`prisma migrate resolve` + `down`, o un `DROP COLUMN` manual de las cuatro columnas `*_encrypted`).
3. **Las 7 columnas legacy** (§5) **siguen intactas** con todo el plaintext original. La app vuelve a operar sobre ellas como antes del cifrado.

**Importante — datos creados durante fase 1.** Mientras la extensión estuvo activa, las escrituras nuevas fueron sólo a las columnas `*_encrypted` (la extensión las redirige y omite las legacy). Si se hace rollback **después** de que se hayan creado/actualizado sesiones bajo cifrado, esos datos viven únicamente en las columnas cifradas y se perderán al hacer `DROP COLUMN`. En ese escenario, antes de revertir las migraciones, descifrar y volcar manualmente esas filas a las columnas legacy correspondientes.

**Fallback de lectura sin rollback.** La extensión también tiene un fallback in-memory: si lee una fila cuya columna `*_encrypted` está vacía o no arranca con `ENC1`, no falla — emite un `console.warn` y devuelve el contenido de la columna legacy. Eso permite que el sistema funcione durante el período entre aplicar las migraciones y completar el backfill, sin un rollback explícito.
