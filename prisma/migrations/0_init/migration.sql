-- CreateTable
CREATE TABLE "organizaciones" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashed_password" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones" (
    "id" TEXT NOT NULL,
    "nombre_profesional" TEXT NOT NULL,
    "direccion" TEXT NOT NULL DEFAULT '',
    "whatsapp_origen" TEXT NOT NULL DEFAULT '',
    "tarifa_default" INTEGER NOT NULL,
    "horas_anticipacion" INTEGER NOT NULL DEFAULT 24,
    "template_recordatorio" TEXT NOT NULL DEFAULT 'Hola {{nombre}}. Te recordamos tu sesión:
{{fecha}}  |  {{hora}}
{{direccion}}

Cualquier cambio, avisame con anticipación. Gracias.',
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "configuraciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT,
    "tarifa" INTEGER NOT NULL,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "duracion" INTEGER NOT NULL DEFAULT 50,
    "modalidad" TEXT NOT NULL DEFAULT 'presencial',
    "estado" TEXT NOT NULL DEFAULT 'programado',
    "tarifa_cobrada" INTEGER NOT NULL,
    "pago_estado" TEXT NOT NULL DEFAULT 'pendiente',
    "pago_fecha" TIMESTAMP(3),
    "pago_metodo" TEXT,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordatorios" (
    "id" TEXT NOT NULL,
    "programado_en" TIMESTAMP(3) NOT NULL,
    "enviado_en" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "texto_enviado" TEXT,
    "error" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "turno_id" TEXT NOT NULL,

    CONSTRAINT "recordatorios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "configuraciones_organization_id_key" ON "configuraciones"("organization_id");

-- CreateIndex
CREATE INDEX "pacientes_organization_id_activo_idx" ON "pacientes"("organization_id", "activo");

-- CreateIndex
CREATE INDEX "pacientes_organization_id_apellido_idx" ON "pacientes"("organization_id", "apellido");

-- CreateIndex
CREATE INDEX "turnos_organization_id_fecha_idx" ON "turnos"("organization_id", "fecha");

-- CreateIndex
CREATE INDEX "turnos_organization_id_pago_estado_idx" ON "turnos"("organization_id", "pago_estado");

-- CreateIndex
CREATE INDEX "turnos_paciente_id_idx" ON "turnos"("paciente_id");

-- CreateIndex
CREATE INDEX "recordatorios_estado_programado_en_idx" ON "recordatorios"("estado", "programado_en");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuraciones" ADD CONSTRAINT "configuraciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordatorios" ADD CONSTRAINT "recordatorios_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

