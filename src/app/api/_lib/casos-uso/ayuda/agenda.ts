// Única lectura de datos que puede pedir Lupita. No usa listarTurnos:
// esa consulta carga también teléfono, tarifa y datos de la sesión.
import { z } from "zod";
import type { db } from "@/lib/db";
import type { Modalidad } from "@/lib/constantes-turno";
import {
  agregarDiasMvd, fechaInputMvd, formatearHoraMvd,
  inicioDelDiaMvd, inicioDeSemanaMvd,
} from "@/lib/fechas-montevideo";

export const periodoAgendaSchema = z.enum(["hoy", "manana", "esta_semana"]);
export type PeriodoAgenda = z.infer<typeof periodoAgendaSchema>;
export const consultaAgendaSchema = z.object({ periodo: periodoAgendaSchema }).strict();

// No tiene operaciones de escritura, otros modelos ni SQL libre.
export type LectorAgenda = { turno: Pick<typeof db.turno, "findMany"> };

export interface TurnoLupita {
  nombre: string;
  dia: string;
  hora: string;
  duracion: number;
  modalidad: Modalidad;
}

export async function consultarAgenda({
  prisma, organizationId, periodo, ahora = new Date(),
}: {
  prisma: LectorAgenda;
  organizationId: string;
  periodo: PeriodoAgenda;
  ahora?: Date;
}): Promise<TurnoLupita[]> {
  // Validar también en este borde: no convertir un período desconocido en hoy.
  periodoAgendaSchema.parse(periodo);
  if (!organizationId) throw new Error("La lectura de agenda requiere consultorio");
  const desde = periodo === "esta_semana"
    ? inicioDeSemanaMvd(ahora)
    : agregarDiasMvd(inicioDelDiaMvd(ahora), periodo === "manana" ? 1 : 0);
  const hasta = agregarDiasMvd(desde, periodo === "esta_semana" ? 7 : 1);
  const turnos = await prisma.turno.findMany({
    where: {
      organizationId,
      paciente: { organizationId },
      fecha: { gte: desde, lt: hasta },
      estado: { not: "cancelado" },
    },
    select: {
      paciente: { select: { nombre: true } },
      fecha: true,
      duracion: true,
      modalidad: true,
    },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });
  return turnos.map((turno) => ({
    nombre: turno.paciente.nombre,
    dia: fechaInputMvd(turno.fecha),
    hora: formatearHoraMvd(turno.fecha),
    duracion: turno.duracion,
    modalidad: turno.modalidad,
  }));
}
