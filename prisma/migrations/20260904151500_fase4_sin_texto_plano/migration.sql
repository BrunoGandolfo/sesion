-- AlterTable
ALTER TABLE "paciente_contexto_clinico" DROP COLUMN "hipotesis_diagnostica",
DROP COLUMN "resumen_acumulativo",
DROP COLUMN "riesgos_historicos";

-- AlterTable
ALTER TABLE "sesiones_clinicas" DROP COLUMN "datosEstructurados",
DROP COLUMN "notaAnalisis",
DROP COLUMN "notaObjetivo",
DROP COLUMN "notaPlan",
DROP COLUMN "notaSubjetivo",
DROP COLUMN "notasEdicion",
DROP COLUMN "transcripcion";


-- Esquema residual de Evolution API (WhatsApp), 30 tablas sin datos, fuera del sistema desde septiembre 2026
DROP SCHEMA IF EXISTS "evolution" CASCADE;
