-- CreateTable
CREATE TABLE "paciente_contexto_clinico" (
    "id" TEXT NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "objetivos_terapeuticos" JSONB NOT NULL DEFAULT '[]',
    "intervenciones_probadas" JSONB NOT NULL DEFAULT '[]',
    "temas_recurrentes" JSONB NOT NULL DEFAULT '[]',
    "hipotesis_diagnostica" TEXT,
    "resumen_acumulativo" TEXT,
    "riesgos_historicos" TEXT,
    "hipotesis_diagnostica_encrypted" BYTEA,
    "resumen_acumulativo_encrypted" BYTEA,
    "riesgos_historicos_encrypted" BYTEA,
    "ultima_sesion_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "aprobado_por_terapeuta_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paciente_contexto_clinico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paciente_contexto_clinico_paciente_id_key" ON "paciente_contexto_clinico"("paciente_id");

-- CreateIndex
CREATE INDEX "paciente_contexto_clinico_organization_id_idx" ON "paciente_contexto_clinico"("organization_id");

-- CreateIndex
CREATE INDEX "paciente_contexto_clinico_aprobado_por_terapeuta_en_idx" ON "paciente_contexto_clinico"("aprobado_por_terapeuta_en");

-- AddForeignKey
ALTER TABLE "paciente_contexto_clinico" ADD CONSTRAINT "paciente_contexto_clinico_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_contexto_clinico" ADD CONSTRAINT "paciente_contexto_clinico_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
