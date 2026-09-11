import type { RepositorioRegistro } from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { ApiError } from "@/app/api/_lib/responses";
import { hashTokenCuenta } from "@/lib/cuenta-tokens";
import { ENTRADA_INVITACION_INVALIDA, ENTRADA_REGISTRO_ERROR, TERMINOS_VERSION } from "@/lib/glosario";
import { OPCIONES_TRANSACCION, tomarLocks } from "@/lib/intentos-serializados";
import type { ClienteCifrado } from "@/lib/prisma-encryption";
import { VIGENCIA_ABSOLUTA_MS } from "@/lib/sesion-acceso";

export function repositorioRegistro(prisma: ClienteCifrado): RepositorioRegistro {
  return {
    contarVigentes: (creadaPorId, ahora) =>
      prisma.invitacion.count({ where: { creadaPorId, usadaEn: null, venceEn: { gt: ahora } } }),
    crearInvitacion: (datos) => prisma.invitacion.create({ data: datos, select: { id: true } }),
    buscarInvitacion: (tokenHash) =>
      prisma.invitacion.findUnique({
        where: { tokenHash },
        select: { id: true, creadaPorId: true, venceEn: true, usadaEn: true },
      }),
    async registrar(datos) {
      const claveEmail = await hashTokenCuenta(datos.email);
      try {
        return await prisma.$transaction(async (tx) => {
          await tomarLocks(tx, [`invitacion:${datos.invitacionId}`, `registro-email:${claveEmail}`]);
          if (await tx.user.findUnique({ where: { email: datos.email }, select: { id: true } })) {
            throw new ApiError(ENTRADA_REGISTRO_ERROR, 400);
          }
          const tomada = await tx.invitacion.updateMany({
            where: { id: datos.invitacionId, usadaEn: null, venceEn: { gt: datos.ahora } },
            data: { usadaEn: datos.ahora },
          });
          if (tomada.count !== 1) throw new ApiError(ENTRADA_INVITACION_INVALIDA, 400);
          const invitacion = await tx.invitacion.findUniqueOrThrow({
            where: { id: datos.invitacionId },
            select: { creadaPorId: true, creadaPor: { select: { organizationId: true } } },
          });
          const org = await tx.organization.create({ data: { nombre: `Consultorio de ${datos.nombre}` } });
          const user = await tx.user.create({
            data: { nombre: datos.nombre, email: datos.email, hashedPassword: datos.hashedPassword, organizationId: org.id, rol: "titular" },
          });
          await tx.configuracion.create({ data: { organizationId: org.id, nombreProfesional: "", tarifaDefault: 0 } });
          const sesion = await tx.sesionAcceso.create({
            data: {
              userId: user.id,
              tokenHash: datos.sesion.tokenHash,
              creadaEn: datos.ahora,
              ultimoUsoEn: datos.ahora,
              venceEn: new Date(datos.ahora.getTime() + VIGENCIA_ABSOLUTA_MS),
              ip: datos.sesion.ip,
              userAgent: datos.sesion.userAgent,
            },
            select: { id: true },
          });
          await tx.eventoAuditoria.createMany({
            data: [
              {
                organizationId: org.id, actorTipo: "usuario", actorId: user.id, accion: "cuenta.registro",
                entidad: "usuario", entidadId: user.id,
                detalle: { aceptaTerminos: true, versionTerminos: TERMINOS_VERSION, invitacionId: datos.invitacionId },
              },
              // Quien invitó se entera en SU rastro: la invitación se usó.
              {
                organizationId: invitacion.creadaPor.organizationId, actorTipo: "usuario", actorId: invitacion.creadaPorId,
                accion: "cuenta.invitacion_usada", entidad: "usuario", entidadId: invitacion.creadaPorId,
                detalle: { invitacionId: datos.invitacionId, usuarioNuevoId: user.id },
              },
            ],
          });
          return { userId: user.id, organizationId: org.id, sesionId: sesion.id };
        }, OPCIONES_TRANSACCION);
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
          throw new ApiError(ENTRADA_REGISTRO_ERROR, 400);
        }
        throw error;
      }
    },
  };
}
