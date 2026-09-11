// GET /api/pacientes/[id]/progreso?rango=10s|3m|6m|todo
//
// El recorrido clínico de una paciente: la serie de sesiones del rango, los
// temas de toda su historia y la línea de tiempo de señales de riesgo. El
// armado vive en casos-uso/progreso-clinico.ts; acá solo se lee la base y se
// responde.
//
// Solo entran las sesiones que ya tienen nota (revision o aprobado): una
// sesión que todavía se está procesando no tiene nada que graficar.

import { db } from "@/lib/db";
import { parseDatosEstructurados } from "@/lib/sesion-clinica/schema";

import { getOrganizationId } from "../../../_lib/auth";
import {
  armarProgresoClinico,
  parseRangoProgreso,
} from "../../../_lib/casos-uso/progreso-clinico";
import { ApiError, errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const rango = parseRangoProgreso(
      new URL(request.url).searchParams.get("rango"),
    );

    const paciente = await db.paciente.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    const filas = await db.sesionClinica.findMany({
      where: {
        organizationId,
        estado: { in: ["revision", "aprobado"] },
        turno: { pacienteId: id },
      },
      orderBy: { turno: { fecha: "asc" } },
      select: {
        id: true,
        datosEstructurados: true,
        turno: { select: { fecha: true } },
      },
    });

    const progreso = armarProgresoClinico({
      pacienteId: paciente.id,
      // El parseo del tablero valida el shape; una fila corrupta entra como
      // sesión sin datos en vez de tirar abajo todo el recorrido.
      sesiones: filas.map((fila) => ({
        sesionId: fila.id,
        fecha: fila.turno.fecha,
        datos: parseDatosEstructurados(fila.datosEstructurados),
      })),
      rango,
      ahora: new Date(),
    });

    return ok(progreso);
  } catch (error) {
    return errorResponse(error);
  }
}
