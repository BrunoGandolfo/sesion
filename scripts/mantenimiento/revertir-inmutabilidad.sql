-- Reversión administrativa de 20260916013000_inmutabilidad.
-- No elimina datos; retira las garantías hasta que se vuelva a aplicar el SQL.
-- No la ejecuta la app ni el despliegue automático de Prisma.
BEGIN;
DROP TRIGGER eventos_auditoria_inmutable ON eventos_auditoria;
DROP TRIGGER hilo_versiones_contenido_inmutable ON hilo_versiones;
DROP TRIGGER hilo_versiones_sin_borrado ON hilo_versiones;
DROP FUNCTION rechazar_mutacion_inmutable();
DROP FUNCTION proteger_hilo_version();
COMMIT;
