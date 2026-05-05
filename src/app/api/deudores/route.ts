import { db } from "@/lib/db";
import type { DeudaPaciente } from "@/types/domain";

import { getOrganizationId } from "../_lib/auth";
import { diasDesde, minFecha, sumTarifas } from "../_lib/domain";
import { errorResponse, ok } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Item enriquecido para la página /deudores. Extiende DeudaPaciente con los
 * campos que necesita la UI para armar el recordatorio de cobro:
 *   - telefono:        para construir el link wa.me
 *   - minutosTotales:  suma de duración (en minutos) de las sesiones impagas;
 *                      alimenta el resumen "Trabajaste X horas Y minutos gratis"
 *
 * El sidebar también consume este endpoint y se quedó tipado contra el
 * `DeudaPaciente` base; los campos extra le son inocuos (sólo lee diasAtraso).
 */
export type DeudoresApiItem = DeudaPaciente & {
  telefono: string;
  minutosTotales: number;
};

/**
 * Lista completa de deudores para la página /deudores y para el badge del
 * sidebar. A diferencia de /api/dashboard (que devuelve top 10 y otros
 * widgets), acá no hay tope.
 */
export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const now = new Date();

    const pacientes = await db.paciente.findMany({
      where: {
        organizationId,
        turnos: {
          some: {
            estado: "realizado",
            pagoEstado: "pendiente",
          },
        },
      },
      include: {
        turnos: {
          where: {
            estado: "realizado",
            pagoEstado: "pendiente",
          },
          select: {
            fecha: true,
            estado: true,
            pagoEstado: true,
            tarifaCobrada: true,
            duracion: true,
          },
        },
      },
    });

    const deudores: DeudoresApiItem[] = pacientes
      .map((paciente) => ({
        pacienteId: paciente.id,
        nombre: paciente.nombre,
        apellido: paciente.apellido,
        telefono: paciente.telefono,
        sesionesImpagas: paciente.turnos.length,
        montoTotal: sumTarifas(paciente.turnos),
        minutosTotales: paciente.turnos.reduce(
          (sum, t) => sum + t.duracion,
          0,
        ),
        diasAtraso: diasDesde(minFecha(paciente.turnos), now),
      }))
      .filter((deudor) => deudor.sesionesImpagas > 0)
      .sort((a, b) =>
        b.diasAtraso !== a.diasAtraso
          ? b.diasAtraso - a.diasAtraso
          : b.montoTotal - a.montoTotal,
      );

    return ok(deudores);
  } catch (error) {
    return errorResponse(error);
  }
}
