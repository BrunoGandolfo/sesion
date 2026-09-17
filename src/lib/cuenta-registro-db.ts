import type { RepositorioRegistro } from "@/app/api/_lib/casos-uso/registrar-cuenta";
import { ApiError } from "@/app/api/_lib/responses";
import { hashTokenCuenta } from "@/lib/cuenta-tokens";
import { ENTRADA_INVITACION_INVALIDA, ENTRADA_REGISTRO_ERROR, TERMINOS_VERSION } from "@/lib/glosario";
import { OPCIONES_TRANSACCION, tomarLocks } from "@/lib/intentos-serializados";
import { cupoInvitacion } from "@/lib/limites-prueba";
import type { ClienteCifrado } from "@/lib/prisma-encryption";
import { VIGENCIA_ABSOLUTA_MS } from "@/lib/sesion-acceso";

export function repositorioRegistro(prisma: ClienteCifrado): RepositorioRegistro {
  return {
    crearInvitacion: (datos) =>
      prisma.$transaction(async (tx) => {
        // Leer el contador y sumarle bajo el mismo lock: sin esto, dos pedidos
        // en paralelo leen "hay cupo" los dos y pasan los dos.
        await tomarLocks(tx, [`invitaciones:${datos.creadaPorId}`]);
        const usuaria = await tx.user.findUniqueOrThrow({
          where: { id: datos.creadaPorId },
          select: { invitacionesGeneradas: true, ultimaInvitacionEn: true },
        });
        const cupo = cupoInvitacion(
          { generadas: usuaria.invitacionesGeneradas, ultimaEn: usuaria.ultimaInvitacionEn },
          datos.creadaEn,
        );
        if (!cupo.disponible) return cupo;
        await tx.user.update({
          where: { id: datos.creadaPorId },
          data: { invitacionesGeneradas: { increment: 1 }, ultimaInvitacionEn: datos.creadaEn },
        });
        return tx.invitacion.create({ data: datos, select: { id: true } });
      }, OPCIONES_TRANSACCION),
    contadorInvitaciones: async (userId) => {
      const usuaria = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { invitacionesGeneradas: true, ultimaInvitacionEn: true },
      });
      return { generadas: usuaria.invitacionesGeneradas, ultimaEn: usuaria.ultimaInvitacionEn };
    },
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
          // De prueba: graba hasta TOPE_GRABACIONES_PRUEBA sesiones (casos-uso/audio.ts).
          const org = await tx.organization.create({ data: { nombre: `Consultorio de ${datos.nombre}`, deInvitacion: true } });
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
