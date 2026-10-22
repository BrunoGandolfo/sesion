-- Reversión administrativa de 20261021150000_borrar_sms.
-- Recrea envios_sms, bajas_sms, configuraciones.canal_recordatorio y sus
-- enums VACÍOS, con la forma que tenían: los datos no vuelven (están en los
-- respaldos anteriores a la migración, docs/operaciones.md). Toda
-- configuración queda con canal 'whatsapp', el único que el código anterior
-- usaba (CANAL_RECORDATORIO_VIGENTE). Sólo hace falta si se vuelve a publicar
-- un código anterior a 676f076: ese código lee estas tablas al crear un
-- turno, en Hoy y en Cobros. Saca su registro de _prisma_migrations para que
-- el historial coincida con la base.
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
-- CreateEnum
CREATE TYPE "canal_recordatorio" AS ENUM ('sms', 'whatsapp', 'ambos');

-- CreateEnum
CREATE TYPE "motivo_sms" AS ENUM ('recordatorio_turno', 'cambio_de_horario', 'recordatorio_cobro');

-- CreateEnum
CREATE TYPE "estado_envio_sms" AS ENUM ('pendiente', 'enviando', 'aceptado', 'entregado', 'no_entregado', 'cancelado', 'fallido', 'desconocido');

-- CreateEnum
CREATE TYPE "motivo_baja_sms" AS ENUM ('respuesta_baja', 'twilio_21610', 'manual');

-- AlterTable
ALTER TABLE "configuraciones" ADD COLUMN     "canal_recordatorio" "canal_recordatorio" NOT NULL DEFAULT 'whatsapp';

-- CreateTable
CREATE TABLE "envios_sms" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "motivo" "motivo_sms" NOT NULL,
    "estado" "estado_envio_sms" NOT NULL DEFAULT 'pendiente',
    "paciente_id" TEXT NOT NULL,
    "turno_id" TEXT,
    "destino" TEXT NOT NULL,
    "programado_en" TIMESTAMP(3) NOT NULL,
    "proximo_intento_en" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "sid" TEXT,
    "codigo_proveedor" TEXT,
    "motivo_no_envio" VARCHAR(500),
    "segmentos" INTEGER,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aceptado_en" TIMESTAMP(3),
    "cerrado_en" TIMESTAMP(3),
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "envios_sms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bajas_sms" (
    "telefono" TEXT NOT NULL,
    "motivo" "motivo_baja_sms" NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bajas_sms_pkey" PRIMARY KEY ("telefono")
);

-- CreateIndex
CREATE UNIQUE INDEX "envios_sms_clave_idempotencia_key" ON "envios_sms"("clave_idempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "envios_sms_sid_key" ON "envios_sms"("sid");

-- CreateIndex
CREATE INDEX "envios_sms_estado_proximo_intento_en_idx" ON "envios_sms"("estado", "proximo_intento_en");

-- CreateIndex
CREATE INDEX "envios_sms_organization_id_aceptado_en_idx" ON "envios_sms"("organization_id", "aceptado_en");

-- CreateIndex
CREATE INDEX "envios_sms_turno_id_idx" ON "envios_sms"("turno_id");

-- AddForeignKey
ALTER TABLE "envios_sms" ADD CONSTRAINT "envios_sms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_sms" ADD CONSTRAINT "envios_sms_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_sms" ADD CONSTRAINT "envios_sms_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021150000_borrar_sms';
COMMIT;
