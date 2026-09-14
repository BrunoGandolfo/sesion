import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import { ultimoAvisoPorPaciente } from "../_lib/casos-uso/recordar-cobro";
import {
  buscarTurnosConDeuda,
  calcularDeudores,
  type DeudoresApiItem,
} from "../_lib/domain";
import { errorResponse, ok } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

/**
 * Lista completa de deudores. A diferencia de /api/dashboard (top 10), acá
 * no hay tope. Orden: más días de atraso primero; a igualdad, mayor monto.
 */
export async function GET() {
  try {
    const organizationId = await getOrganizationId();
    const now = new Date();

    const turnos = await buscarTurnosConDeuda(db, organizationId);
    const telefonos = new Map(
      turnos.map((t) => [t.pacienteId, t.paciente.telefono]),
    );

    // Cuándo se le avisó por última vez a cada una. Va en la misma respuesta
    // porque es lo que evita mandar el mismo SMS dos veces: sin esto la
    // pantalla no tiene cómo saberlo y el botón invita a repetir.
    const agrupados = calcularDeudores(turnos, now);
    const ultimoAviso = await ultimoAvisoPorPaciente(
      db,
      organizationId,
      agrupados.map((d) => d.pacienteId),
    );

    const deudores: DeudoresApiItem[] = agrupados
      .map((d) => ({
        pacienteId: d.pacienteId,
        nombre: d.nombre,
        apellido: d.apellido,
        telefono: telefonos.get(d.pacienteId) ?? "",
        sesionesImpagas: d.sesionesImpagas,
        montoTotal: d.montoTotal,
        minutosTotales: d.minutosTotales,
        diasAtraso: d.diasAtraso ?? 0,
        ultimoAvisoEn: ultimoAviso.get(d.pacienteId) ?? null,
      }))
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
