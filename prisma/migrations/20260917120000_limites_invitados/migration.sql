-- Límites de las cuentas invitadas: cinco invitaciones en total, una cada
-- treinta días, y quince grabaciones por consultorio invitado. Aditiva: cuatro
-- columnas con valor por omisión. Reversión:
-- scripts/mantenimiento/revertir-limites-invitados.sql.

-- AlterTable
ALTER TABLE "organizaciones" ADD COLUMN     "de_invitacion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "grabaciones_iniciadas" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "invitaciones_generadas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultima_invitacion_en" TIMESTAMP(3);

-- Lo ya generado cuenta. `invitaciones` se purga a los 30 días; el evento
-- `cuenta.invitacion_creada` no se borra nunca. Se unen los dos por id para no
-- contar dos veces la misma.
UPDATE "usuarios" u
SET "invitaciones_generadas" = c.total, "ultima_invitacion_en" = c.ultima
FROM (
  SELECT creada_por_id, COUNT(DISTINCT id)::int AS total, MAX(creada_en) AS ultima
  FROM (
    SELECT id, creada_por_id, creada_en FROM "invitaciones"
    UNION ALL
    SELECT detalle->>'invitacionId', actor_id, creado_en FROM "eventos_auditoria"
    WHERE accion = 'cuenta.invitacion_creada' AND actor_id IS NOT NULL AND detalle->>'invitacionId' IS NOT NULL
  ) t
  GROUP BY creada_por_id
) c
WHERE u.id = c.creada_por_id;

-- Los consultorios que ya nacieron de una invitación (evento `cuenta.registro`,
-- que sólo escribe el alta por invitación) pasan a ser de prueba. Se excluye el
-- que tenga a alguien que ya invitó: ese consultorio es de quien invita, y a
-- esa cuenta estos límites no le aplican.
UPDATE "organizaciones" o
SET "de_invitacion" = true
WHERE o.id IN (SELECT organization_id FROM "eventos_auditoria" WHERE accion = 'cuenta.registro')
  AND NOT EXISTS (
    SELECT 1 FROM "usuarios" u WHERE u.organization_id = o.id AND u.invitaciones_generadas > 0
  );

-- Grabaciones ya iniciadas: las sesiones que existen y las eliminadas, que
-- dejaron su evento `sesion.crear`.
UPDATE "organizaciones" o
SET "grabaciones_iniciadas" = c.total
FROM (
  SELECT organization_id, COUNT(DISTINCT id)::int AS total
  FROM (
    SELECT id, organization_id FROM "sesiones_clinicas"
    UNION ALL
    SELECT entidad_id, organization_id FROM "eventos_auditoria" WHERE accion = 'sesion.crear'
  ) t
  GROUP BY organization_id
) c
WHERE o.id = c.organization_id;
