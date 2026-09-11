-- CreateEnum
CREATE TYPE "rol_usuario" AS ENUM ('titular');

-- CreateEnum
CREATE TYPE "motivo_cierre_sesion" AS ENUM ('salida', 'salida_todas', 'cambio_password', 'restablecimiento', 'vencimiento', 'incidente');

-- CreateEnum
CREATE TYPE "tipo_intento_acceso" AS ENUM ('login', 'password', 'recuperar');

-- CreateEnum
CREATE TYPE "modo_recordatorio" AS ENUM ('dia_anterior', 'dos_dias_antes', 'misma_manana');

-- CreateEnum
CREATE TYPE "orientacion_teorica" AS ENUM ('cbt_mi', 'gestalt');

-- CreateEnum
CREATE TYPE "frecuencia_serie" AS ENUM ('semanal', 'quincenal');

-- CreateEnum
CREATE TYPE "estado_turno" AS ENUM ('programado', 'realizado', 'cancelado', 'ausente');

-- CreateEnum
CREATE TYPE "estado_pago" AS ENUM ('pendiente', 'pagado');

-- CreateEnum
CREATE TYPE "modalidad" AS ENUM ('presencial', 'online');

-- CreateEnum
CREATE TYPE "metodo_pago" AS ENUM ('efectivo', 'transferencia', 'mercadopago', 'debito', 'credito', 'otro');

-- CreateEnum
CREATE TYPE "motivo_sms" AS ENUM ('recordatorio_turno', 'cambio_de_horario', 'recordatorio_cobro');

-- CreateEnum
CREATE TYPE "estado_envio_sms" AS ENUM ('pendiente', 'enviando', 'aceptado', 'entregado', 'no_entregado', 'cancelado', 'fallido', 'desconocido');

-- CreateEnum
CREATE TYPE "motivo_baja_sms" AS ENUM ('respuesta_baja', 'twilio_21610', 'manual');

-- CreateEnum
CREATE TYPE "estado_sesion" AS ENUM ('grabando', 'subiendo', 'procesando', 'revision', 'aprobada', 'fallida');

-- CreateEnum
CREATE TYPE "estado_audio" AS ENUM ('sin_audio', 'en_r2', 'borrado');

-- CreateEnum
CREATE TYPE "estado_feedback" AS ENUM ('no_pedido', 'pendiente', 'listo', 'fallido');

-- CreateEnum
CREATE TYPE "tipo_trabajo" AS ENUM ('borrar_audio_r2', 'borrar_transcript_asr', 'generar_feedback', 'integrar_contexto');

-- CreateEnum
CREATE TYPE "estado_trabajo" AS ENUM ('pendiente', 'en_curso', 'hecho', 'fallido');

-- CreateEnum
CREATE TYPE "ejecutor_trabajo" AS ENUM ('app', 'worker');

-- CreateEnum
CREATE TYPE "alcance_hot_word" AS ENUM ('global', 'profesional', 'paciente');

-- CreateEnum
CREATE TYPE "categoria_hot_word" AS ENUM ('termino_clinico', 'modismo_rioplatense', 'nombre_propio', 'otro');

-- CreateEnum
CREATE TYPE "actor_hilo" AS ENUM ('profesional', 'ia');

-- CreateEnum
CREATE TYPE "estado_version_hilo" AS ENUM ('aplicada', 'propuesta', 'desactualizada', 'rechazada');

-- CreateEnum
CREATE TYPE "actor_auditoria" AS ENUM ('usuario', 'worker', 'sistema');

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
    "rol" "rol_usuario" NOT NULL DEFAULT 'titular',
    "organization_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones_acceso" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_en" TIMESTAMP(3) NOT NULL,
    "vence_en" TIMESTAMP(3) NOT NULL,
    "cerrada_en" TIMESTAMP(3),
    "motivo_cierre" "motivo_cierre_sesion",
    "ip" TEXT,
    "user_agent" VARCHAR(120),

    CONSTRAINT "sesiones_acceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intentos_acceso" (
    "id" TEXT NOT NULL,
    "tipo" "tipo_intento_acceso" NOT NULL,
    "clave" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" VARCHAR(120),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intentos_acceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "vence_en" TIMESTAMP(3) NOT NULL,
    "usado_en" TIMESTAMP(3),
    "enviado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitaciones" (
    "id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "vence_en" TIMESTAMP(3) NOT NULL,
    "usada_en" TIMESTAMP(3),
    "creada_por_id" TEXT NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cupos_ayuda" (
    "user_id" TEXT NOT NULL,
    "dia" VARCHAR(10) NOT NULL,
    "usadas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cupos_ayuda_pkey" PRIMARY KEY ("user_id","dia")
);

-- CreateTable
CREATE TABLE "configuraciones" (
    "id" TEXT NOT NULL,
    "nombre_profesional" TEXT NOT NULL,
    "direccion" TEXT NOT NULL DEFAULT '',
    "whatsapp_origen" TEXT NOT NULL DEFAULT '',
    "tarifa_default" INTEGER NOT NULL,
    "recordatorio_modo" "modo_recordatorio" NOT NULL DEFAULT 'dia_anterior',
    "template_recordatorio" TEXT NOT NULL DEFAULT 'Hola {{nombre}}. Te recordamos tu sesión:
{{fecha}}  |  {{hora}}
{{direccion}}

Cualquier cambio, avisame con anticipación. Gracias.',
    "orientacion_teorica" "orientacion_teorica" NOT NULL DEFAULT 'cbt_mi',
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "configuraciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "tarifa" INTEGER NOT NULL,
    "notas_encrypted" BYTEA,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_turno" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "frecuencia" "frecuencia_serie" NOT NULL,
    "hora_ancla" TIMESTAMP(3) NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "series_turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "duracion" INTEGER NOT NULL DEFAULT 50,
    "modalidad" "modalidad" NOT NULL DEFAULT 'presencial',
    "estado" "estado_turno" NOT NULL DEFAULT 'programado',
    "tarifa_cobrada" INTEGER NOT NULL,
    "pago_estado" "estado_pago" NOT NULL DEFAULT 'pendiente',
    "pago_fecha" TIMESTAMP(3),
    "pago_metodo" "metodo_pago",
    "notas_encrypted" BYTEA,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "serie_id" TEXT,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "consentimientos_grabacion" (
    "id" TEXT NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "firmado_en" TIMESTAMP(3) NOT NULL,
    "revocado_en" TIMESTAMP(3),
    "texto_version" TEXT NOT NULL,
    "texto_completo_encrypted" BYTEA NOT NULL,
    "firma_digital_encrypted" BYTEA NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consentimientos_grabacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones_clinicas" (
    "id" TEXT NOT NULL,
    "turno_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "estado" "estado_sesion" NOT NULL DEFAULT 'grabando',
    "audio_estado" "estado_audio" NOT NULL DEFAULT 'sin_audio',
    "audio_clave_encrypted" BYTEA,
    "duracion_audio_seg" INTEGER,
    "pausas" JSONB,
    "audio_borrado_en" TIMESTAMP(3),
    "intento" INTEGER NOT NULL DEFAULT 0,
    "fallos_seguidos" INTEGER NOT NULL DEFAULT 0,
    "proximo_intento_en" TIMESTAMP(3),
    "lease_vence_en" TIMESTAMP(3),
    "ticket_hash" CHAR(64),
    "fallo_codigo" TEXT,
    "fallo_detalle" VARCHAR(500),
    "generacion" INTEGER NOT NULL DEFAULT 0,
    "transcripcion_encrypted" BYTEA,
    "speech_analytics" JSONB,
    "nota_ia_encrypted" BYTEA,
    "datos_encrypted" BYTEA,
    "feedback_estado" "estado_feedback" NOT NULL DEFAULT 'no_pedido',
    "feedback_encrypted" BYTEA,
    "feedback_error" VARCHAR(500),
    "asr_transcript_id" TEXT,
    "modelo_asr" TEXT,
    "modelo_llm" TEXT,
    "prompt_version" TEXT,
    "procesada_en" TIMESTAMP(3),
    "uso" JSONB,
    "nota_final_encrypted" BYTEA,
    "notas_edicion_encrypted" BYTEA,
    "aprobada_en" TIMESTAMP(3),
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizada_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sesiones_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_segmentos" (
    "sesion_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "indice" INTEGER NOT NULL,
    "iv" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "confirmado_en" TIMESTAMP(3),

    CONSTRAINT "audio_segmentos_pkey" PRIMARY KEY ("sesion_id","indice")
);

-- CreateTable
CREATE TABLE "trabajos" (
    "id" TEXT NOT NULL,
    "tipo" "tipo_trabajo" NOT NULL,
    "ejecutor" "ejecutor_trabajo" NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sesion_id" TEXT,
    "paciente_id" TEXT,
    "payload" JSONB NOT NULL,
    "estado" "estado_trabajo" NOT NULL DEFAULT 'pendiente',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximo_intento_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_vence_en" TIMESTAMP(3),
    "ticket_hash" CHAR(64),
    "ultimo_error" VARCHAR(500),
    "uso" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hecho_en" TIMESTAMP(3),

    CONSTRAINT "trabajos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_estado" (
    "id" TEXT NOT NULL DEFAULT 'worker',
    "worker_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ultimo_poll_en" TIMESTAMP(3) NOT NULL,
    "ultimo_trabajo_en" TIMESTAMP(3),

    CONSTRAINT "worker_estado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hot_words" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "alcance" "alcance_hot_word" NOT NULL,
    "paciente_id" TEXT,
    "termino_encrypted" BYTEA NOT NULL,
    "termino_hash" CHAR(64) NOT NULL,
    "categoria" "categoria_hot_word",
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hot_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hilos" (
    "paciente_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "vigente_id" TEXT,
    "ultima_version" INTEGER NOT NULL DEFAULT 0,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hilos_pkey" PRIMARY KEY ("paciente_id")
);

-- CreateTable
CREATE TABLE "hilo_versiones" (
    "id" TEXT NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "basada_en_version" INTEGER,
    "actor" "actor_hilo" NOT NULL,
    "estado" "estado_version_hilo" NOT NULL,
    "contenido_encrypted" BYTEA NOT NULL,
    "sesion_origen_id" TEXT,
    "prompt_version" TEXT,
    "modelo_llm" TEXT,
    "creada_por_user_id" TEXT,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resuelta_en" TIMESTAMP(3),
    "resuelta_por_user_id" TEXT,
    "propuesta_origen_id" TEXT,

    CONSTRAINT "hilo_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_auditoria" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_tipo" "actor_auditoria" NOT NULL,
    "actor_id" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "detalle" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_acceso_token_hash_key" ON "sesiones_acceso"("token_hash");

-- CreateIndex
CREATE INDEX "sesiones_acceso_user_id_cerrada_en_idx" ON "sesiones_acceso"("user_id", "cerrada_en");

-- CreateIndex
CREATE INDEX "intentos_acceso_clave_creado_en_idx" ON "intentos_acceso"("clave", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "password_resets_user_id_enviado_en_idx" ON "password_resets"("user_id", "enviado_en");

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_token_hash_key" ON "invitaciones"("token_hash");

-- CreateIndex
CREATE INDEX "invitaciones_creada_por_id_idx" ON "invitaciones"("creada_por_id");

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
CREATE INDEX "turnos_serie_id_idx" ON "turnos"("serie_id");

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

-- CreateIndex
CREATE INDEX "consentimientos_grabacion_paciente_id_idx" ON "consentimientos_grabacion"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_clinicas_turno_id_key" ON "sesiones_clinicas"("turno_id");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_clinicas_ticket_hash_key" ON "sesiones_clinicas"("ticket_hash");

-- CreateIndex
CREATE INDEX "sesiones_clinicas_organization_id_estado_idx" ON "sesiones_clinicas"("organization_id", "estado");

-- CreateIndex
CREATE INDEX "sesiones_clinicas_estado_proximo_intento_en_lease_vence_en_idx" ON "sesiones_clinicas"("estado", "proximo_intento_en", "lease_vence_en");

-- CreateIndex
CREATE UNIQUE INDEX "trabajos_ticket_hash_key" ON "trabajos"("ticket_hash");

-- CreateIndex
CREATE INDEX "trabajos_estado_ejecutor_proximo_intento_en_idx" ON "trabajos"("estado", "ejecutor", "proximo_intento_en");

-- CreateIndex
CREATE INDEX "trabajos_sesion_id_idx" ON "trabajos"("sesion_id");

-- CreateIndex
CREATE INDEX "trabajos_paciente_id_idx" ON "trabajos"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "hot_words_organization_id_alcance_paciente_id_termino_hash_key" ON "hot_words"("organization_id", "alcance", "paciente_id", "termino_hash");

-- CreateIndex
CREATE UNIQUE INDEX "hilos_vigente_id_key" ON "hilos"("vigente_id");

-- CreateIndex
CREATE INDEX "hilo_versiones_paciente_id_estado_idx" ON "hilo_versiones"("paciente_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "hilo_versiones_paciente_id_version_key" ON "hilo_versiones"("paciente_id", "version");

-- CreateIndex
CREATE INDEX "eventos_auditoria_organization_id_creado_en_idx" ON "eventos_auditoria"("organization_id", "creado_en");

-- CreateIndex
CREATE INDEX "eventos_auditoria_entidad_entidad_id_idx" ON "eventos_auditoria"("entidad", "entidad_id");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_acceso" ADD CONSTRAINT "sesiones_acceso_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupos_ayuda" ADD CONSTRAINT "cupos_ayuda_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuraciones" ADD CONSTRAINT "configuraciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_turno" ADD CONSTRAINT "series_turno_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_turno" ADD CONSTRAINT "series_turno_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_serie_id_fkey" FOREIGN KEY ("serie_id") REFERENCES "series_turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_sms" ADD CONSTRAINT "envios_sms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_sms" ADD CONSTRAINT "envios_sms_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_sms" ADD CONSTRAINT "envios_sms_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos_grabacion" ADD CONSTRAINT "consentimientos_grabacion_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos_grabacion" ADD CONSTRAINT "consentimientos_grabacion_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_clinicas" ADD CONSTRAINT "sesiones_clinicas_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_clinicas" ADD CONSTRAINT "sesiones_clinicas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_segmentos" ADD CONSTRAINT "audio_segmentos_sesion_id_fkey" FOREIGN KEY ("sesion_id") REFERENCES "sesiones_clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_segmentos" ADD CONSTRAINT "audio_segmentos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trabajos" ADD CONSTRAINT "trabajos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_words" ADD CONSTRAINT "hot_words_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_words" ADD CONSTRAINT "hot_words_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hilos" ADD CONSTRAINT "hilos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hilos" ADD CONSTRAINT "hilos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hilos" ADD CONSTRAINT "hilos_vigente_id_fkey" FOREIGN KEY ("vigente_id") REFERENCES "hilo_versiones"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "hilo_versiones" ADD CONSTRAINT "hilo_versiones_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "hilos"("paciente_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hilo_versiones" ADD CONSTRAINT "hilo_versiones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- A MANO (Prisma no lo expresa). Si este archivo se regenera con
-- `prisma migrate diff --from-empty --to-schema-datamodel`, volver a pegar
-- este bloque entero al final.
-- ============================================================================

-- Duración del turno, en minutos: exactamente los valores de DURACIONES en
-- src/lib/constantes-turno.ts. Postgres no puede leer ese archivo: si cambia
-- uno, cambia el otro a mano.
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_duracion_check"
  CHECK ("duracion" IN (30, 45, 50, 60, 90));

-- Recorrido: a lo sumo UNA propuesta abierta de la IA por paciente.
-- (Índice único parcial; Prisma no lo modela, la extensión lo ignora.)
CREATE UNIQUE INDEX "hilo_una_propuesta_abierta"
  ON "hilo_versiones" ("paciente_id") WHERE "estado" = 'propuesta';

-- Hot words sin paciente: el UNIQUE de Prisma no aplica cuando paciente_id
-- es NULL (Postgres trata cada NULL como distinto). Este índice cubre ese
-- caso para los alcances global y profesional.
CREATE UNIQUE INDEX "hot_words_sin_paciente_unico"
  ON "hot_words" ("organization_id", "alcance", "termino_hash")
  WHERE "paciente_id" IS NULL;

-- Cotas de sanidad que la app no debería poder violar.
ALTER TABLE "audio_segmentos" ADD CONSTRAINT "audio_segmentos_indice_check"
  CHECK ("indice" >= 0);
ALTER TABLE "audio_segmentos" ADD CONSTRAINT "audio_segmentos_bytes_check"
  CHECK ("bytes" > 0);
ALTER TABLE "hilo_versiones" ADD CONSTRAINT "hilo_versiones_version_check"
  CHECK ("version" >= 1);
ALTER TABLE "cupos_ayuda" ADD CONSTRAINT "cupos_ayuda_usadas_check"
  CHECK ("usadas" >= 0);
