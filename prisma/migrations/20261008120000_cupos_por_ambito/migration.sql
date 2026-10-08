-- DESTRUCTIVA: el código que usaba esto salió en 1c6551b
--
-- NO borra ni cambia filas: la marca está porque scripts/ci/migraciones.mjs
-- lee `DROP CONSTRAINT` como un DROP, y Postgres no tiene otra forma de
-- cambiar la clave primaria que borrarla y volver a crearla. Toda fila
-- existente queda con ambito = 'ayuda' (el DEFAULT), así que la clave nueva
-- (user_id, dia, ambito) es única desde el primer instante.
--
-- El sha de arriba NO es el último código que usó la clave vieja: 1c6551b
-- (release al escribir esto) todavía reserva con ON CONFLICT (user_id, dia).
-- Entre esta migración y el avance de release, ese código no encuentra la
-- restricción que nombra y Postgres contesta un error: /api/ayuda da 500
-- durante esos segundos. No hay forma aditiva de evitarlo (la clave vieja
-- impide la fila de Lux del mismo día). Se elige así: Lupita caída unos
-- segundos durante el despliegue, no una segunda tabla de cupos.
--
-- Prisma 5 manda este archivo entero como una sola transacción: no hay un
-- instante sin clave primaria.
-- Reversión: scripts/mantenimiento/revertir-cupos-por-ambito.sql.

-- CreateEnum
CREATE TYPE "ambito_cupo" AS ENUM ('ayuda', 'lux');

-- AlterTable
ALTER TABLE "cupos_ayuda" DROP CONSTRAINT "cupos_ayuda_pkey",
ADD COLUMN     "ambito" "ambito_cupo" NOT NULL DEFAULT 'ayuda',
ADD CONSTRAINT "cupos_ayuda_pkey" PRIMARY KEY ("user_id", "dia", "ambito");
