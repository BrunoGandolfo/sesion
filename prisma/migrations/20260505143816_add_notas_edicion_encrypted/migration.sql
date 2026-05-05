-- ============================================================================
-- add_notas_edicion_encrypted — extensión de la fase 1 del cifrado en reposo
-- ============================================================================
-- Suma una cuarta columna BYTEA al modelo SesionClinica para cifrar también
-- las ediciones manuales de la profesional sobre la nota clínica
-- (notasEdicion). Estrategia idéntica al resto: aditiva, nullable, la
-- columna legacy `notas_edicion` (TEXT) sigue presente y se eliminará
-- junto con las otras 6 en la migración de fase 2.
--
-- Formato del blob almacenado:
--   "ENC1" magic (4B) || IV (12B) || authTag (16B) || ciphertext (NB)
-- ============================================================================

-- AlterTable
ALTER TABLE "sesiones_clinicas" ADD COLUMN     "notas_edicion_encrypted" BYTEA;
