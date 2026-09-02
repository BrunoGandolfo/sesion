-- CreateEnum
CREATE TYPE "ActorAuditoria" AS ENUM ('usuario', 'worker', 'sistema');

-- AlterTable
ALTER TABLE "sesiones_clinicas" ADD COLUMN     "hablante_terapeuta" TEXT DEFAULT 'S0',
ADD COLUMN     "nota_soap_original_encrypted" BYTEA,
ADD COLUMN     "prompt_version" TEXT;

-- CreateTable
CREATE TABLE "eventos_auditoria" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_tipo" "ActorAuditoria" NOT NULL,
    "actor_id" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "detalle" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eventos_auditoria_organization_id_created_at_idx" ON "eventos_auditoria"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "eventos_auditoria_entidad_entidad_id_idx" ON "eventos_auditoria"("entidad", "entidad_id");

