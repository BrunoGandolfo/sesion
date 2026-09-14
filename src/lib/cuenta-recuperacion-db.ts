import type { RepositorioRecuperacion } from "@/app/api/_lib/casos-uso/recuperar-cuenta";
import { MAX_RECUPERACIONES_HORA, VIGENCIA_RESET_MS } from "@/lib/cuenta-tokens";
import { registrarPedidoRecuperar } from "@/lib/intentos-acceso";
import { OPCIONES_TRANSACCION, tomarLocks } from "@/lib/intentos-serializados";
import type { ClienteCifrado } from "@/lib/prisma-encryption";
import { cerrarTodas } from "@/lib/sesion-acceso";

export function repositorioRecuperacion(prisma: ClienteCifrado): RepositorioRecuperacion {
  return {
    registrarPedido: (huella, ahora) => registrarPedidoRecuperar(prisma, huella, ahora),

    reservarSolicitud: (email, tokenHash, ahora) =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { email }, select: { id: true, email: true } });
        if (!user) return null;
        await tomarLocks(tx, [`recuperar:${user.id}`]);
        // Cuenta los ENVIADOS en la última hora más los que están en vuelo
        // (reservados y todavía sin confirmar). Una fila cuyo correo falló se
        // borra y no gasta cupo; una en vuelo cuenta, si no cinco pedidos en
        // paralelo mandarían cinco correos antes de que el primero confirme.
        // Las huérfanas (en vuelo de un proceso que murió) las purga el cron
        // de mantenimiento al cabo de una hora.
        const desde = new Date(ahora.getTime() - VIGENCIA_RESET_MS);
        const enCupo = await tx.passwordReset.count({
          where: { userId: user.id, OR: [{ enviadoEn: { gt: desde } }, { enviadoEn: null, creadoEn: { gt: desde } }] },
        });
        if (enCupo >= MAX_RECUPERACIONES_HORA) return null;
        const fila = await tx.passwordReset.create({
          data: {
            userId: user.id, tokenHash, creadoEn: ahora, enviadoEn: null,
            venceEn: new Date(ahora.getTime() + VIGENCIA_RESET_MS),
          },
          select: { id: true },
        });
        return { resetId: fila.id, userId: user.id, email: user.email };
      }, OPCIONES_TRANSACCION),

    confirmarEnvio: (resetId, userId, ahora) =>
      prisma.$transaction(async (tx) => {
        await tomarLocks(tx, [`recuperar:${userId}`]);
        await tx.passwordReset.updateMany({
          where: { userId, usadoEn: null, enviadoEn: { not: null }, id: { not: resetId } },
          data: { usadoEn: ahora },
        });
        await tx.passwordReset.updateMany({ where: { id: resetId, userId }, data: { enviadoEn: ahora } });
      }, OPCIONES_TRANSACCION),

    async descartarSolicitud(resetId) {
      await prisma.passwordReset.deleteMany({ where: { id: resetId, enviadoEn: null } });
    },

    async buscar(tokenHash) {
      const fila = await prisma.passwordReset.findUnique({
        where: { tokenHash },
        include: { user: { select: { organizationId: true, hashedPassword: true } } },
      });
      return fila
        ? {
            id: fila.id, userId: fila.userId, usadoEn: fila.usadoEn, venceEn: fila.venceEn, enviadoEn: fila.enviadoEn,
            organizationId: fila.user.organizationId, hashedPassword: fila.user.hashedPassword,
          }
        : null;
    },

    consumir: (reset, hashNuevo, ahora) =>
      prisma.$transaction(async (tx) => {
        await tomarLocks(tx, [`usuario:${reset.userId}`, `recuperar:${reset.userId}`]);
        const usado = await tx.passwordReset.updateMany({
          where: { id: reset.id, userId: reset.userId, usadoEn: null, enviadoEn: { not: null }, venceEn: { gt: ahora } },
          data: { usadoEn: ahora },
        });
        if (usado.count !== 1) return false;
        await tx.user.update({ where: { id: reset.userId }, data: { hashedPassword: hashNuevo } });
        await tx.passwordReset.updateMany({ where: { userId: reset.userId, usadoEn: null }, data: { usadoEn: ahora } });
        // Un enlace robado o un teléfono perdido no sobreviven al cambio.
        await cerrarTodas(tx, { userId: reset.userId, motivo: "restablecimiento", ahora });
        return true;
      }, OPCIONES_TRANSACCION),
  };
}
