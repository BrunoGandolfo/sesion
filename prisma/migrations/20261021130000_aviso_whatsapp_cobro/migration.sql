-- Aditiva: un valor nuevo del enum. Con el canal "WhatsApp desde mi
-- teléfono", Recordar cobro anota cada apertura en avisos_whatsapp con tipo
-- `cobro`, colgada del turno impago más viejo de la paciente. Las filas de
-- `recordatorio` no cambian. Agregar un valor dentro de la transacción de
-- Prisma está permitido mientras esta misma migración no lo use.
-- AlterEnum
ALTER TYPE "tipo_aviso_whatsapp" ADD VALUE 'cobro';
