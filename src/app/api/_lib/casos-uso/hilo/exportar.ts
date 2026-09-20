// Exportar el Recorrido: lo que necesita la hoja de impresión, en una lectura.
//
// Qué va y qué no:
//   - La versión vigente, completa.
//   - Las versiones que estuvieron vigentes antes, completas: son lo que la
//     profesional dio por bueno en su momento.
//   - Todas las versiones como filas del historial, sin contenido. Una
//     propuesta sin revisar, una desactualizada o una descartada NO llevan
//     su texto: la IA la escribió y ella no la adoptó, y en un archivo
//     clínico se leería como su criterio.
//   - Una propuesta aceptada con ediciones queda "aplicada", pero lo que fue
//     vigente es la edición: su texto tampoco va.
//   - Las fechas de las sesiones, para que la hoja muestre fechas y no ids.
//   - Los datos de "Cómo va" sobre todas las sesiones.
//
// La auditoría se escribe DENTRO de la transacción que lee, con `auditar`: si
// el registro falla, no salen datos. A diferencia de registrarAuditoria, que
// se traga el error, acá exportar sin rastro no es una opción.

import { ACCION_EXPORTAR_RECORRIDO } from "@/lib/consentimiento-hechos";
import type { db } from "@/lib/db";
import { contenidoHiloSchema, type ResumenVersionHilo, type VersionHilo } from "@/lib/hilo/contenido";

import { auditar } from "../../auditoria";
import { ApiError } from "../../responses";
import type { ProgresoClinico } from "../progreso-clinico";
import { filtroHilo, resumenSelect, type BaseHilo, type IdentidadHilo } from "./base";
import { leerProgreso } from "./progreso";

export type ClienteExportacion = BaseHilo & Pick<typeof db, "configuracion">;

export interface ExportacionRecorrido {
  paciente: { nombre: string; apellido: string };
  nombreProfesional: string | null;
  exportadoEn: string;
  vigente: VersionHilo | null;
  /** Las que estuvieron vigentes antes, de la más nueva a la más vieja. */
  anteriores: VersionHilo[];
  /** Todas las versiones, de la más nueva a la más vieja, sin contenido. */
  versiones: ResumenVersionHilo[];
  /** Notas aprobadas: traduce los ids de sesión a fechas. */
  sesiones: { id: string; fecha: string }[];
  progreso: ProgresoClinico;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function exportarRecorrido(
  prisma: ClienteExportacion,
  identidad: IdentidadHilo,
  usuarioId: string,
  ahora = new Date(),
): Promise<ExportacionRecorrido> {
  return prisma.$transaction(async tx => {
    const paciente = await tx.paciente.findFirst({
      where: { id: identidad.pacienteId, organizationId: identidad.organizationId },
      select: { nombre: true, apellido: true },
    });
    if (!paciente) throw new ApiError("Paciente no encontrado", 404);

    const configuracion = await tx.configuracion.findUnique({
      where: { organizationId: identidad.organizationId }, select: { nombreProfesional: true },
    });
    const hilo = await tx.hilo.findFirst({ where: filtroHilo(identidad), select: { vigenteId: true } });
    const filas = await tx.hiloVersion.findMany({
      where: filtroHilo(identidad), select: resumenSelect, orderBy: { version: "desc" },
    });

    const reemplazadasPorEdicion = new Set(filas.map(f => f.propuestaOrigenId).filter(Boolean));
    const conContenido = filas.filter(f => f.id === hilo?.vigenteId
      || (f.estado === "aplicada" && !reemplazadasPorEdicion.has(f.id)));
    const contenidos = await tx.hiloVersion.findMany({
      where: { ...filtroHilo(identidad), id: { in: conContenido.map(f => f.id) } },
      select: { id: true, contenido: true },
    });
    const contenidoDe = new Map(contenidos.map(c => [c.id, contenidoHiloSchema.parse(c.contenido)]));

    const resumen = (f: (typeof filas)[number]): ResumenVersionHilo => ({
      ...f, creadaEn: f.creadaEn.toISOString(), resueltaEn: iso(f.resueltaEn),
    });
    const completa = (f: (typeof filas)[number]): VersionHilo => ({ ...resumen(f), contenido: contenidoDe.get(f.id)! });
    const vigente = filas.find(f => f.id === hilo?.vigenteId);
    const anteriores = conContenido.filter(f => f.id !== hilo?.vigenteId);

    const sesiones = await tx.sesionClinica.findMany({
      where: { organizationId: identidad.organizationId, estado: "aprobada", turno: { pacienteId: identidad.pacienteId } },
      select: { id: true, turno: { select: { fecha: true } } },
      orderBy: [{ turno: { fecha: "asc" } }, { id: "asc" }],
    });
    const progreso = await leerProgreso(tx, identidad, "todo", ahora);

    await auditar(tx, {
      organizationId: identidad.organizationId, actorTipo: "usuario", actorId: usuarioId,
      accion: ACCION_EXPORTAR_RECORRIDO, entidad: "hilo", entidadId: identidad.pacienteId,
      detalle: {
        vigente: vigente?.version ?? null,
        versiones: filas.length,
        conContenido: conContenido.map(f => f.version),
        sesiones: progreso.totalSesiones,
      },
      creadoEn: ahora,
    });

    return {
      paciente,
      nombreProfesional: configuracion?.nombreProfesional ?? null,
      exportadoEn: ahora.toISOString(),
      vigente: vigente ? completa(vigente) : null,
      anteriores: anteriores.map(completa),
      versiones: filas.map(resumen),
      sesiones: sesiones.map(s => ({ id: s.id, fecha: s.turno.fecha.toISOString() })),
      progreso,
    };
  }, { isolationLevel: "RepeatableRead", timeout: 12_000 });
}
