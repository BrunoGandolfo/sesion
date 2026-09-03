import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import {
  buscarTurnosConDeuda,
  calcularDeudores,
  type DeudoresApiItem,
} from "../_lib/domain";
import { errorResponse, ok } from "../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const deudores: DeudoresApiItem[] = calcularDeudores(turnos, now)
      .map((d) => ({
        pacienteId: d.pacienteId,
        nombre: d.nombre,
        apellido: d.apellido,
        telefono: telefonos.get(d.pacienteId) ?? "",
        sesionesImpagas: d.sesionesImpagas,
        montoTotal: d.montoTotal,
        minutosTotales: d.minutosTotales,
        diasAtraso: d.diasAtraso ?? 0,
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
