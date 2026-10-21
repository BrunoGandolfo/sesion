-- Lux recuerda la conversación por paciente entre visitas (rama lux-memoria).
-- Una fila por turno: la pregunta de la profesional o la respuesta de Lux,
-- con el texto cifrado (contenido_encrypted, llavero CLAVES_CIFRADO, AAD
-- conversaciones_lux:contenido_encrypted:<id>). La escribe el servidor al
-- cerrar cada respuesta (src/app/api/_lib/casos-uso/lux/memoria.ts).
--
-- ADITIVA: una tabla y un enum nuevos; nada existente cambia. El código de
-- release no la ve. Se borra en cascada con la paciente (y con la usuaria);
-- archivar a la paciente la conserva.
-- Reversión: scripts/mantenimiento/revertir-conversaciones-lux.sql.

-- CreateEnum
CREATE TYPE "rol_conversacion_lux" AS ENUM ('profesional', 'lux');

-- CreateTable
CREATE TABLE "conversaciones_lux" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rol" "rol_conversacion_lux" NOT NULL,
    "contenido_encrypted" BYTEA NOT NULL,
    "interrumpida" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversaciones_lux_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversaciones_lux_paciente_id_creado_en_idx" ON "conversaciones_lux"("paciente_id", "creado_en");

-- AddForeignKey
ALTER TABLE "conversaciones_lux" ADD CONSTRAINT "conversaciones_lux_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversaciones_lux" ADD CONSTRAINT "conversaciones_lux_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversaciones_lux" ADD CONSTRAINT "conversaciones_lux_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

