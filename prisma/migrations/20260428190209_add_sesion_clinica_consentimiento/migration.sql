-- CreateTable
CREATE TABLE "consentimientos_grabacion" (
    "id" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firmadoEn" TIMESTAMP(3) NOT NULL,
    "revocadoEn" TIMESTAMP(3),
    "textoVersion" TEXT NOT NULL,
    "textoCompleto" TEXT NOT NULL,
    "firmaDigital" TEXT NOT NULL,
    "ipOrigen" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consentimientos_grabacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones_clinicas" (
    "id" TEXT NOT NULL,
    "turnoId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "duracionAudioSeg" INTEGER,
    "audioR2Key" TEXT,
    "audioBorradoEn" TIMESTAMP(3),
    "transcripcion" TEXT,
    "notaSubjetivo" TEXT,
    "notaObjetivo" TEXT,
    "notaAnalisis" TEXT,
    "notaPlan" TEXT,
    "datosEstructurados" TEXT,
    "modeloASR" TEXT,
    "modeloLLM" TEXT,
    "procesadoEn" TIMESTAMP(3),
    "error" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "aprobadoEn" TIMESTAMP(3),
    "notasEdicion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sesiones_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consentimientos_grabacion_pacienteId_idx" ON "consentimientos_grabacion"("pacienteId");

-- CreateIndex
CREATE INDEX "consentimientos_grabacion_organizationId_idx" ON "consentimientos_grabacion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_clinicas_turnoId_key" ON "sesiones_clinicas"("turnoId");

-- CreateIndex
CREATE INDEX "sesiones_clinicas_organizationId_idx" ON "sesiones_clinicas"("organizationId");

-- CreateIndex
CREATE INDEX "sesiones_clinicas_estado_idx" ON "sesiones_clinicas"("estado");

-- AddForeignKey
ALTER TABLE "consentimientos_grabacion" ADD CONSTRAINT "consentimientos_grabacion_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos_grabacion" ADD CONSTRAINT "consentimientos_grabacion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_clinicas" ADD CONSTRAINT "sesiones_clinicas_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_clinicas" ADD CONSTRAINT "sesiones_clinicas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
