import type { PrismaClient } from "@prisma/client";
import type { RepositorioRecuperacion } from "@/app/api/_lib/casos-uso/recuperar-cuenta";
import { tomarLocks, OPCIONES_TRANSACCION } from "@/lib/intentos-serializados";
import { MAX_RECUPERACIONES_HORA, VIGENCIA_RESET_MS } from "@/lib/cuenta-tokens";

// Sólo las rutas Node importan este adaptador. No se agrega nada a authorize().
export function repositorioRecuperacion(prisma: PrismaClient): RepositorioRecuperacion {
  return {
    crearSolicitud: (email, tokenHash, ahora) => prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) return null;
      await tomarLocks(tx, [`recuperar:${user.id}`]);
      const pedidos = await tx.passwordReset.count({ where: {
        userId: user.id, createdAt: { gt: new Date(ahora.getTime() - VIGENCIA_RESET_MS) },
      } });
      if (pedidos >= MAX_RECUPERACIONES_HORA) return null;
      await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: ahora } });
      await tx.passwordReset.create({ data: {
        userId: user.id, tokenHash, createdAt: ahora, expiresAt: new Date(ahora.getTime() + VIGENCIA_RESET_MS),
      } });
      return { email: user.email };
    }, OPCIONES_TRANSACCION),
    async buscar(tokenHash) {
      const fila = await prisma.passwordReset.findUnique({ where: { tokenHash }, include: { user: true } });
      return fila ? { id: fila.id, userId: fila.userId, usedAt: fila.usedAt, expiresAt: fila.expiresAt,
        organizationId: fila.user.organizationId, hashedPassword: fila.user.hashedPassword } : null;
    },
    consumir: (reset, hashNuevo, ahora) => prisma.$transaction(async (tx) => {
      await tomarLocks(tx, [`recuperar:${reset.userId}`]);
      const usado = await tx.passwordReset.updateMany({
        where: { id: reset.id, userId: reset.userId, usedAt: null, expiresAt: { gt: ahora } },
        data: { usedAt: ahora },
      });
      if (usado.count !== 1) return false;
      await tx.user.update({ where: { id: reset.userId }, data: { hashedPassword: hashNuevo } });
      await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: ahora } });
      return true;
    }, OPCIONES_TRANSACCION),
  };
}
