-- CreateTable
CREATE TABLE "hot_words" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "pacienteId" TEXT,
    "termino" VARCHAR(200) NOT NULL,
    "categoria" VARCHAR(50),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hot_words_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hot_words_organizationId_idx" ON "hot_words"("organizationId");

-- CreateIndex
CREATE INDEX "hot_words_scope_idx" ON "hot_words"("scope");

-- CreateIndex
CREATE INDEX "hot_words_pacienteId_idx" ON "hot_words"("pacienteId");

-- CreateIndex
CREATE UNIQUE INDEX "hot_words_organizationId_scope_pacienteId_termino_key" ON "hot_words"("organizationId", "scope", "pacienteId", "termino");

-- AddForeignKey
ALTER TABLE "hot_words" ADD CONSTRAINT "hot_words_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_words" ADD CONSTRAINT "hot_words_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
