-- ============================================================================
-- encrypt_notas_clinicas — fase 1/2 del rollout de cifrado en reposo
-- ============================================================================
-- Estrategia elegida: (a) MIGRACIÓN EN DOS PASOS.
--
-- Justificación: el cifrado AES-256-GCM se hace en código de aplicación con la
-- clave NOTES_ENCRYPTION_KEY; no se puede transformar plaintext → ciphertext
-- desde una sentencia SQL `USING`. La estrategia (b) `ALTER TYPE ... USING`
-- perdería los datos existentes al castear `text → bytea` (queda el texto
-- crudo en bytes, sin cifrar y sin authTag, lo que rompería al lector
-- cifrado).
--
-- En esta migración (fase 1) solo SE AGREGAN tres columnas `bytea NULL`
-- nuevas, sin tocar ni renombrar ninguna existente. Es 100% aditiva y
-- reversible (un ROLLBACK trivial dropea las tres columnas).
--
-- Posteriormente Bruno corre `scripts/migrate-encrypt-existing-notas.ts`,
-- que lee las columnas en texto plano y rellena las cifradas. El script es
-- idempotente (detecta el prefijo magic "ENC1") y batched (50 filas por
-- transacción).
--
-- Una migración futura (fase 2, fuera del alcance de este PR) eliminará las
-- 6 columnas legacy y renombrará las cifradas:
--   transcripcion_encrypted        → transcripcion          (bytea NULL)
--   nota_soap_encrypted            → nota_soap              (bytea NULL)
--   datos_estructurados_encrypted  → datos_estructurados    (bytea NULL)
-- y dropeará: transcripcion (texto), nota_subjetivo, nota_objetivo,
-- nota_analisis, nota_plan, datos_estructurados (texto).
--
-- Formato del blob cifrado almacenado en cada columna:
--   bytes  0..4   "ENC1" magic prefix (0x45 0x4E 0x43 0x31)
--   bytes  4..16  IV (12 bytes, generado con CSPRNG por cifrado)
--   bytes 16..32  authTag de AES-GCM (16 bytes)
--   bytes 32..N   ciphertext
-- ============================================================================

-- AlterTable
ALTER TABLE "sesiones_clinicas" ADD COLUMN     "transcripcion_encrypted" BYTEA;
ALTER TABLE "sesiones_clinicas" ADD COLUMN     "nota_soap_encrypted" BYTEA;
ALTER TABLE "sesiones_clinicas" ADD COLUMN     "datos_estructurados_encrypted" BYTEA;
