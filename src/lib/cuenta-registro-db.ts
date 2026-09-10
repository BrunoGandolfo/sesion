import type { PrismaClient } from "@prisma/client";
import type { RepositorioRegistro } from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { ApiError } from "@/app/api/_lib/responses";
import { OPCIONES_TRANSACCION, tomarLocks } from "@/lib/intentos-serializados";
import { hashTokenCuenta } from "@/lib/cuenta-tokens";
import { ENTRADA_INVITACION_INVALIDA, ENTRADA_REGISTRO_ERROR, TERMINOS_VERSION } from "@/lib/glosario";

export function repositorioRegistro(prisma: PrismaClient): RepositorioRegistro {
  return {
    async crearInvitacion(datos) {
      await prisma.invitacion.create({ data: { ...datos, organizationId: null, email: null } });
    },
    buscarInvitacion: (tokenHash) => prisma.invitacion.findUnique({ where: { tokenHash } }),
    async registrar(datos) {
      const claveEmail = await hashTokenCuenta(datos.email);
      try {
        return await prisma.$transaction(async tx => {
          await tomarLocks(tx, [`invitacion:${datos.invitacionId}`, `registro-email:${claveEmail}`]);
          if (await tx.user.findUnique({ where: { email: datos.email }, select: { id: true } })) throw new ApiError(ENTRADA_REGISTRO_ERROR, 400);
          const tomada = await tx.invitacion.updateMany({
            where: { id: datos.invitacionId, usedAt: null, expiresAt: { gt: datos.ahora }, organizationId: null,
              OR: [{ email: null }, { email: datos.email }] }, data: { usedAt: datos.ahora },
          });
          if (tomada.count !== 1) throw new ApiError(ENTRADA_INVITACION_INVALIDA, 400);
          const org = await tx.organization.create({ data: { nombre: `Consultorio de ${datos.nombre}` } });
          const user = await tx.user.create({ data: { nombre: datos.nombre, email: datos.email, hashedPassword: datos.hashedPassword, organizationId: org.id } });
          await tx.configuracion.create({ data: { organizationId: org.id, nombreProfesional: "", tarifaDefault: 0 } });
          await tx.eventoAuditoria.create({ data: {
            organizationId: org.id, actorTipo: "usuario", actorId: user.id, accion: "cuenta.registro",
            entidad: "usuario", entidadId: user.id,
            detalle: { aceptaTerminos: true, versionTerminos: TERMINOS_VERSION },
          } });
          return { userId: user.id, organizationId: org.id };
        }, OPCIONES_TRANSACCION);
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ApiError(ENTRADA_REGISTRO_ERROR, 400);
        throw error;
      }
    },
  };
}
