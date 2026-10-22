-- DESTRUCTIVA: el código que usaba esto salió en 7059ccd
--
-- Sesión sólo usa WhatsApp (decisión del dueño, 21-oct-2026): el SMS
-- desaparece entero. Borra envios_sms (cada SMS programado o enviado:
-- destino, estado y fechas, nunca el texto), bajas_sms (los teléfonos que
-- respondieron BAJA), configuraciones.canal_recordatorio y sus enums. El
-- código dejó de leerlos en 676f076 (rama borrar-sms).
--
-- ANTES DE PUBLICAR: el respaldo diario conserva estos datos (diarios 30
-- días, mensuales 366). Cómo consultarlos en una base aislada:
-- docs/operaciones.md, "Los datos del SMS, después de borrarlo".
--
-- PUBLICACIÓN EN DOS PASOS. 7059ccd es el PASO 1 de integracion: todo el
-- código sin SMS, sin esta migración: Prisma todavía conoce las tablas,
-- que nada consulta, y la columna con @ignore, fuera del cliente (sin eso
-- leer la configuración pide la columna). Este archivo es el PASO 2.
-- Publicar primero 7059ccd y recién después este commit: si release
-- todavía fuera 12b59e9 (que lee y escribe estas tablas y la columna),
-- entre que Publicar aplica la migración y avanza release el código viejo
-- da 500 al crear o mover un turno, en Hoy y en cualquier lectura de la
-- configuración (Prisma pide canal_recordatorio).
-- Reversión (tablas y columna VACÍAS, sólo para volver a publicar un código
-- anterior): scripts/mantenimiento/revertir-borrar-sms.sql.
--
-- Prisma 5 manda este archivo entero como una sola transacción.

-- DropForeignKey
ALTER TABLE "envios_sms" DROP CONSTRAINT "envios_sms_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "envios_sms" DROP CONSTRAINT "envios_sms_paciente_id_fkey";

-- DropForeignKey
ALTER TABLE "envios_sms" DROP CONSTRAINT "envios_sms_turno_id_fkey";

-- AlterTable
ALTER TABLE "configuraciones" DROP COLUMN "canal_recordatorio";

-- DropTable
DROP TABLE "bajas_sms";

-- DropTable
DROP TABLE "envios_sms";

-- DropEnum
DROP TYPE "canal_recordatorio";

-- DropEnum
DROP TYPE "estado_envio_sms";

-- DropEnum
DROP TYPE "motivo_baja_sms";

-- DropEnum
DROP TYPE "motivo_sms";

