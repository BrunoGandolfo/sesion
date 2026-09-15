import { contenidoHiloSchema, type ContenidoHilo } from "@/lib/hilo/contenido";

import { ApiError } from "../../responses";
import { aplicarVigente, auditarHilo, bloquearHilo, CONFLICTO_HILO, exigirVersion, insertarVersion, leerVersion, type BaseHilo, type IdentidadHilo } from "./base";

interface Escritura extends IdentidadHilo {
  prisma: BaseHilo; usuarioId: string; basadaEnVersion: number; ahora?: Date;
}

export async function editarHilo(input: Escritura & { contenido: ContenidoHilo }) {
  const contenido = contenidoHiloSchema.parse(input.contenido);
  const ahora = input.ahora ?? new Date();
  return input.prisma.$transaction(async tx => {
    const hilo = await bloquearHilo(tx, input);
    exigirVersion(hilo, input.basadaEnVersion);
    const nueva = await insertarVersion(tx, input, hilo, {
      contenido: { ...contenido, cambios: [] }, actor: "profesional", estado: "aplicada",
      basadaEnVersion: input.basadaEnVersion, usuarioId: input.usuarioId, ahora,
    });
    await aplicarVigente(tx, input, nueva.id, input.usuarioId, ahora);
    await auditarHilo(tx, input, "hilo.editar", nueva.version, input.usuarioId, ahora);
    return leerVersion(tx, input, nueva.version);
  });
}

export async function aceptarPropuesta(input: Escritura & { propuestaId: string; contenido?: ContenidoHilo }) {
  const contenido = input.contenido === undefined ? undefined : contenidoHiloSchema.parse(input.contenido);
  const ahora = input.ahora ?? new Date();
  return input.prisma.$transaction(async tx => {
    const hilo = await bloquearHilo(tx, input);
    exigirVersion(hilo, input.basadaEnVersion);
    const propuesta = await tx.hiloVersion.findFirst({
      where: { id: input.propuestaId, pacienteId: input.pacienteId, organizationId: input.organizationId },
    });
    if (!propuesta) throw new ApiError("Propuesta no encontrada", 404);
    if (propuesta.estado !== "propuesta" || (propuesta.basadaEnVersion ?? 0) !== input.basadaEnVersion) throw new ApiError(CONFLICTO_HILO, 409);
    await tx.hiloVersion.update({ where: { id: propuesta.id }, data: {
      estado: "aplicada", resueltaEn: ahora, resueltaPorUserId: input.usuarioId,
    } });
    const vigente = contenido === undefined ? propuesta : await insertarVersion(tx, input, hilo, {
      contenido: { ...contenido, cambios: [] }, actor: "profesional", estado: "aplicada",
      basadaEnVersion: input.basadaEnVersion, propuestaOrigenId: propuesta.id,
      sesionOrigenId: propuesta.sesionOrigenId, usuarioId: input.usuarioId, ahora,
    });
    await aplicarVigente(tx, input, vigente.id, input.usuarioId, ahora);
    await auditarHilo(tx, input, contenido === undefined ? "hilo.aceptar" : "hilo.aceptar_editada", vigente.version, input.usuarioId, ahora);
    return leerVersion(tx, input, vigente.version);
  });
}

export async function rechazarPropuesta(input: Escritura & { propuestaId: string }) {
  const ahora = input.ahora ?? new Date();
  return input.prisma.$transaction(async tx => {
    const hilo = await bloquearHilo(tx, input);
    exigirVersion(hilo, input.basadaEnVersion);
    const propuesta = await tx.hiloVersion.findFirst({ where: {
      id: input.propuestaId, pacienteId: input.pacienteId, organizationId: input.organizationId,
    } });
    if (!propuesta) throw new ApiError("Propuesta no encontrada", 404);
    if (!["propuesta", "desactualizada"].includes(propuesta.estado)) throw new ApiError(CONFLICTO_HILO, 409);
    await tx.hiloVersion.update({ where: { id: propuesta.id }, data: {
      estado: "rechazada", resueltaEn: ahora, resueltaPorUserId: input.usuarioId,
    } });
    await auditarHilo(tx, input, "hilo.rechazar", propuesta.version, input.usuarioId, ahora);
    return { ok: true };
  });
}
