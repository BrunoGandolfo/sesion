-- AlterTable
ALTER TABLE "configuraciones" ADD COLUMN     "recordatorio_modo" TEXT NOT NULL DEFAULT 'dia_anterior';

-- AlterTable
ALTER TABLE "sesiones_clinicas" ADD COLUMN     "pausas" JSONB;

