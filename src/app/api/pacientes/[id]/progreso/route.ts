import { db } from "@/lib/db";
import {
  parseDatosEstructurados,
  type AlianzaTerapeutica,
  type DatosEstructurados,
} from "@/lib/sesion-clinica/schema";

import { getOrganizationId } from "../../../_lib/auth";
import { ApiError, errorResponse } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const ALIANZA_MAP: Record<AlianzaTerapeutica, number> = {
  fragil: 1,
  inestable: 2,
  estable: 3,
  fuerte: 4,
};

function countIntervenciones(
  intervenciones: DatosEstructurados["intervenciones"],
): Record<string, number> {
  const acc: Record<string, number> = {};
  if (!intervenciones) return acc;
  for (const i of intervenciones) {
    acc[i.tipo] = (acc[i.tipo] ?? 0) + 1;
  }
  return acc;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    // Esta ruta necesita nombre y apellido, así que hace su propio select en
    // vez de requirePaciente (que solo devuelve el id) para no consultar dos
    // veces. 404 como el resto de /api/pacientes/[id]/** (antes 200 vacío).
    const paciente = await db.paciente.findFirst({
      where: { id, organizationId },
      select: { id: true, nombre: true, apellido: true },
    });
    if (!paciente) {
      throw new ApiError("Paciente no encontrado", 404);
    }

    const sesiones = await db.sesionClinica.findMany({
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

    const payload = sesiones.map((s, idx) => {
      // Parseo del tablero (valida el shape; fila corrupta → null).
      const datos = parseDatosEstructurados(s.datosEstructurados);
      const alianzaLabel = datos?.alianzaTerapeutica ?? null;

      return {
        fecha: s.turno.fecha.toISOString(),
        numero: idx + 1,
        intensidadEmocional: datos?.intensidadEmocional ?? null,
        alianzaTerapeutica: alianzaLabel ? ALIANZA_MAP[alianzaLabel] : null,
        alianzaLabel,
        temas: datos?.temas ?? [],
        intervenciones: countIntervenciones(datos?.intervenciones),
        flagsRiesgo: datos?.flagsRiesgo ?? null,
        speechAnalytics: datos?.speechAnalytics ?? null,
        observacionIA: datos?.observacionIA ?? null,
        progresoPercibido: datos?.progresoPercibido ?? null,
      };
    });

    return Response.json({
      pacienteId: paciente.id,
      nombre: paciente.nombre,
      apellido: paciente.apellido,
      totalSesiones: payload.length,
      sesiones: payload,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
