-- Aditiva: una columna con default en configuraciones. El default es el texto
-- que el aviso de cobro tenía fijo hasta ahora (TEMPLATE_COBRO_DEFAULT del
-- glosario), así que ninguna organización ve un cambio hasta que lo edite.
-- AlterTable
ALTER TABLE "configuraciones" ADD COLUMN     "template_cobro" TEXT NOT NULL DEFAULT 'Consultorio {{profesional}}
{{nombre}}, tenés {{sesiones}} sesión/es pendiente/s de pago: {{monto}}.';
