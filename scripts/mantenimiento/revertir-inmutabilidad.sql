-- Reversión administrativa de 20260916013000_inmutabilidad y, con ella, de
-- 20260928120000_hilo_versiones_recifrado (que solo reemplazó el cuerpo de
-- proteger_hilo_version(); al borrar la función se va también eso).
-- No elimina datos; retira las garantías hasta que se vuelvan a aplicar los
-- SQL de las dos migraciones, en ese orden.
-- No la ejecuta la app ni el despliegue automático de Prisma.
-- No borra su fila de `_prisma_migrations`: después de revertir, `prisma
-- migrate deploy` NO repone los triggers, porque cree que la migración sigue
-- aplicada. Para restituirlos hay que correr a mano los `migration.sql` de
-- `20260916013000_inmutabilidad` y `20260928120000_hilo_versiones_recifrado`.
-- Para revertir SOLO el recifrado y conservar las garantías:
-- scripts/mantenimiento/revertir-hilo-versiones-recifrado.sql.
BEGIN;
DROP TRIGGER eventos_auditoria_inmutable ON eventos_auditoria;
DROP TRIGGER hilo_versiones_contenido_inmutable ON hilo_versiones;
DROP TRIGGER hilo_versiones_sin_borrado ON hilo_versiones;
DROP FUNCTION rechazar_mutacion_inmutable();
DROP FUNCTION proteger_hilo_version();
COMMIT;
