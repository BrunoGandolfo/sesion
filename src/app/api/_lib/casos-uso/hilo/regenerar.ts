import type { z } from "zod";
import { regenerarHiloSchema } from "@/lib/hilo/contenido";
import { ApiError } from "../../responses";
import { crearTrabajo } from "../trabajos/crear";
import { auditarHilo, bloquearHilo, exigirVersion, filtroHilo, type BaseHilo, type IdentidadHilo } from "./base";

export async function regenerarHilo(input: IdentidadHilo & z.infer<typeof regenerarHiloSchema> & { prisma: BaseHilo; usuarioId: string; ahora?: Date }) {
  const ahora = input.ahora ?? new Date();
  return input.prisma.$transaction(async tx => {
    const identidad = filtroHilo(input);
    const hilo = await bloquearHilo(tx, identidad);
    exigirVersion(hilo, input.basadaEnVersion);
    let sesionId: string | null = null;
    if (input.propuestaId) {
      const propuesta = await tx.hiloVersion.findFirst({ where: { ...identidad, id: input.propuestaId } });
      if (!propuesta) throw new ApiError("Propuesta no encontrada", 404);
      if (!["desactualizada", "rechazada"].includes(propuesta.estado)) throw new ApiError("Esta propuesta ya no se puede volver a generar", 409);
      sesionId = propuesta.sesionOrigenId;
      await tx.hiloVersion.update({ where: { id: propuesta.id }, data: { estado: "rechazada", resueltaEn: ahora, resueltaPorUserId: input.usuarioId } });
    } else {
      const trabajo = await tx.trabajo.findFirst({ where: { ...identidad, id: input.trabajoId, tipo: "integrar_contexto", estado: "fallido" } });
      if (!trabajo) throw new ApiError("Trabajo fallido no encontrado", 404);
      sesionId = trabajo.sesionId;
    }
    if (!sesionId) throw new ApiError("La sesión de origen ya no está disponible", 409);
    if (await tx.hiloVersion.count({ where: { ...identidad, sesionOrigenId: sesionId, estado: "aplicada" } })) {
      throw new ApiError("Esta sesión ya se incorporó al Recorrido. Podés editar la versión vigente.", 409);
    }
    const sesion = await tx.sesionClinica.findFirst({ where: { id: sesionId, organizationId: input.organizationId, turno: { pacienteId: input.pacienteId }, estado: "aprobada" }, select: { id: true } });
    if (!sesion) throw new ApiError("La sesión de origen ya no está disponible", 409);
    const ultimo = await tx.trabajo.findFirst({ where: { ...identidad, sesionId, tipo: "integrar_contexto" }, orderBy: [{ creadoEn: "desc" }, { id: "desc" }] });
    if (ultimo && (["pendiente", "en_curso"].includes(ultimo.estado) || (input.trabajoId && ultimo.id !== input.trabajoId))) throw new ApiError("Ya se pidió otra propuesta para esta sesión", 409);
    if (await tx.hiloVersion.count({ where: { ...identidad, sesionOrigenId: sesionId, estado: "propuesta" } })) throw new ApiError("Ya hay una propuesta para esta sesión", 409);
    const trabajo = await crearTrabajo({ prisma: tx, ...identidad, sesionId, tipo: "integrar_contexto", payload: { sesionId, pacienteId: input.pacienteId } });
    await auditarHilo(tx, identidad, "hilo.regenerar", input.basadaEnVersion, input.usuarioId, ahora, trabajo.id);
    return { trabajoId: trabajo.id };
  });
}
