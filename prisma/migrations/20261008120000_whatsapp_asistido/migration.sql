-- Aditiva: un enum y una columna con default en configuraciones, un enum y
-- una tabla nueva. No toca filas existentes: toda organización queda en
-- `sms`, que es el comportamiento de antes. Reversión:
-- scripts/mantenimiento/revertir-whatsapp-asistido.sql.
--
-- `canal_recordatorio` lo lee el cron de SMS al despachar; `avisos_whatsapp`
-- registra cada vez que la profesional abrió el enlace de WhatsApp de un
-- turno. El "por qué no salió" del SMS cancelado por canal va en
-- envios_sms.motivo_no_envio, que es texto: no hace falta tocar un enum.
-- CreateEnum
CREATE TYPE "canal_recordatorio" AS ENUM ('sms', 'whatsapp', 'ambos');

-- CreateEnum
CREATE TYPE "tipo_aviso_whatsapp" AS ENUM ('recordatorio');

-- AlterTable
ALTER TABLE "configuraciones" ADD COLUMN     "canal_recordatorio" "canal_recordatorio" NOT NULL DEFAULT 'sms';

-- CreateTable
CREATE TABLE "avisos_whatsapp" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "turno_id" TEXT NOT NULL,
    "tipo" "tipo_aviso_whatsapp" NOT NULL,
    "fecha_turno" TIMESTAMP(3) NOT NULL,
    "abierto_en" TIMESTAMP(3) NOT NULL,
    "usuario_id" TEXT NOT NULL,

    CONSTRAINT "avisos_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avisos_whatsapp_turno_id_tipo_idx" ON "avisos_whatsapp"("turno_id", "tipo");

-- AddForeignKey
ALTER TABLE "avisos_whatsapp" ADD CONSTRAINT "avisos_whatsapp_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos_whatsapp" ADD CONSTRAINT "avisos_whatsapp_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

