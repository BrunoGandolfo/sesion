import { parseDatosEstructurados } from "@/lib/sesion-clinica/schema";
import { armarProgresoClinico, type RangoProgreso } from "../progreso-clinico";
import { exigirPaciente, type ClienteHilo, type IdentidadHilo } from "./base";

export async function leerProgreso(prisma: ClienteHilo, identidad: IdentidadHilo, rango: RangoProgreso, ahora = new Date()) {
  await exigirPaciente(prisma, identidad);
  const filas = await prisma.sesionClinica.findMany({
    where: { organizationId: identidad.organizationId, estado: { in: ["revision", "aprobada"] }, turno: { pacienteId: identidad.pacienteId } },
    orderBy: { turno: { fecha: "asc" } },
    select: { id: true, datos: true, turno: { select: { fecha: true } } },
  });
  return armarProgresoClinico({ pacienteId: identidad.pacienteId, sesiones: filas.map(f => ({ sesionId: f.id, fecha: f.turno.fecha, datos: parseDatosEstructurados(f.datos) })), rango, ahora });
}
