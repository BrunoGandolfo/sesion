-- Lo cobrado de un mes: WHERE organization_id = ? AND pago_fecha entre dos
-- instantes (resumenFinanzas, /api/turnos/cobros, el tablero). Declarado en
-- schema.prisma como @@index([organizationId, pagoFecha]).
--
-- Sin CONCURRENTLY, a propósito. Prisma 5 corre cada migration.sql dentro
-- de una transacción y CONCURRENTLY no la admite: mezclado con cualquier
-- otra sentencia falla con 25001 y la migración queda marcada como fallida
-- (P3018), lo que frena Publicar. Solo en su archivo sí corre, pero si se
-- corta a mitad deja un índice INVALID que hay que limpiar a mano. Un CREATE
-- INDEX común bloquea las escrituras en turnos mientras se construye, y con
-- el volumen de un consultorio (miles de filas) eso son milisegundos.

CREATE INDEX "turnos_organization_id_pago_fecha_idx" ON "turnos"("organization_id", "pago_fecha");
