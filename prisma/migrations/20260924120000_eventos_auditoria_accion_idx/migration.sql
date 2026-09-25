-- Aditiva. La métrica horaria de rastros perdidos cuenta eventos por acción y
-- fecha para todas las organizaciones (auditoria-metricas.ts): sin este índice
-- recorre entera la única tabla que nunca se purga. El trigger de
-- inmutabilidad no impide crear índices. Declarado en schema.prisma como
-- @@index([accion, creadoEn]).
--
-- Sin CONCURRENTLY, por lo mismo que 20260923120100_turnos_pago_fecha_idx:
-- Prisma corre cada migration.sql en una transacción y CONCURRENTLY no la
-- admite.

CREATE INDEX "eventos_auditoria_accion_creado_en_idx" ON "eventos_auditoria"("accion", "creado_en");
