import { type Recorrido } from "@/lib/hilo/contenido";

import { ApiError } from "../../responses";
import type { SesionAutorizada } from "../../tickets";
import { exigirPaciente, filtroHilo, leerVersion, resumenSelect, type BaseHilo, type ClienteHilo, type IdentidadHilo } from "./base";

export async function historialHilo(prisma: ClienteHilo, identidad: IdentidadHilo, antes?: number) {
  await exigirPaciente(prisma, identidad);
  const filas = await prisma.hiloVersion.findMany({
    where: { ...filtroHilo(identidad), ...(antes ? { version: { lt: antes } } : {}) },
    select: resumenSelect, orderBy: { version: "desc" }, take: 31,
  });
  return {
    historial: filas.slice(0, 30).map(f => ({ ...f, creadaEn: f.creadaEn.toISOString(), resueltaEn: f.resueltaEn?.toISOString() ?? null })),
    hayMas: filas.length > 30,
  };
}

export async function leerRecorrido(prisma: BaseHilo, identidad: IdentidadHilo): Promise<Recorrido> {
  return prisma.$transaction(async tx => {
    await exigirPaciente(tx, identidad);
    const hilo = await tx.hilo.findFirst({ where: filtroHilo(identidad), select: { vigente: { select: { version: true } } } });
    const propuesta = await tx.hiloVersion.findFirst({ where: { ...filtroHilo(identidad), estado: "propuesta" }, select: { version: true } });
    const desactualizadas = await tx.hiloVersion.findMany({
      where: { ...filtroHilo(identidad), estado: "desactualizada" }, select: resumenSelect, orderBy: { version: "desc" },
    });
    const trabajos = await tx.trabajo.findMany({
      where: { ...filtroHilo(identidad), tipo: "integrar_contexto" }, distinct: ["sesionId"],
      select: { id: true, sesionId: true, estado: true }, orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    });
    const sesiones = await tx.sesionClinica.findMany({
      where: { organizationId: identidad.organizationId, estado: "aprobada", turno: { pacienteId: identidad.pacienteId } },
      select: { id: true, turno: { select: { fecha: true } } }, orderBy: [{ turno: { fecha: "desc" } }, { id: "desc" }],
    });
    return {
      pacienteId: identidad.pacienteId,
      vigente: hilo?.vigente ? await leerVersion(tx, identidad, hilo.vigente.version) : null,
      propuesta: propuesta ? await leerVersion(tx, identidad, propuesta.version) : null,
      desactualizadas: desactualizadas.map(f => ({ ...f, creadaEn: f.creadaEn.toISOString(), resueltaEn: f.resueltaEn?.toISOString() ?? null })),
      ...await historialHilo(tx, identidad),
      totalSesionesAprobadas: sesiones.length,
      sesionesAprobadas: sesiones.map(s => ({ id: s.id, fecha: s.turno.fecha.toISOString() })),
      trabajos: trabajos.filter(t => t.estado !== "hecho").reverse() as Recorrido["trabajos"],
    };
  }, { isolationLevel: "RepeatableRead" });
}

/** El ticket de una sesión solo permite leer el hilo de SU paciente. */
export async function leerHiloParaWorker(prisma: BaseHilo, pacienteId: string, sesion: SesionAutorizada) {
  const permitida = await prisma.sesionClinica.findFirst({
    where: { id: sesion.sesionId, organizationId: sesion.organizationId, estado: "procesando", intento: sesion.intento, turno: { pacienteId } },
    select: { id: true },
  });
  if (!permitida) throw new ApiError("No autorizado", 401);
  return prisma.$transaction(async tx => {
    const identidad = { pacienteId, organizationId: sesion.organizationId };
    await exigirPaciente(tx, identidad);
    const hilo = await tx.hilo.findFirst({ where: identidad, select: { vigente: { select: { version: true } } } });
    const vigente = hilo?.vigente ? await leerVersion(tx, identidad, hilo.vigente.version) : null;
    return { tipo: "hilo_vigente" as const, pacienteId, version: vigente?.version ?? 0, contenido: vigente?.contenido ?? null };
  }, { isolationLevel: "RepeatableRead" });
}
