import { db } from "@/lib/db";
import type {
  AlianzaTerapeutica,
  DatosEstructurados,
  FlagsRiesgo,
  IntervencionTerapeuta,
} from "@/types/domain";

import { getOrganizationId } from "../../../_lib/auth";
import { errorResponse } from "../../../_lib/responses";

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

function parseDatos(raw: unknown): Partial<DatosEstructurados> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Partial<DatosEstructurados>;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as Partial<DatosEstructurados>;
  return null;
}

function countIntervenciones(
  intervenciones: IntervencionTerapeuta[] | undefined,
): Record<string, number> {
  const acc: Record<string, number> = {};
  if (!Array.isArray(intervenciones)) return acc;
  for (const i of intervenciones) {
    const tipo = i?.tipo;
    if (typeof tipo === "string") acc[tipo] = (acc[tipo] ?? 0) + 1;
  }
  return acc;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const paciente = await db.paciente.findFirst({
      where: { id, organizationId },
      select: { id: true, nombre: true, apellido: true },
    });

    if (!paciente) {
      return Response.json({
        pacienteId: id,
        nombre: null,
        apellido: null,
        totalSesiones: 0,
        sesiones: [],
      });
    }

    const sesiones = await db.sesionClinica.findMany({
      where: {
        organizationId,
        estado: { in: ["revision", "aprobado"] },
        turno: { pacienteId: id },
      },
      select: {
        id: true,
        datosEstructurados: true,
        turno: { select: { fecha: true } },
      },
    });

    const ordenadas = sesiones
      .slice()
      .sort((a, b) => a.turno.fecha.getTime() - b.turno.fecha.getTime());

    const payload = ordenadas.map((s, idx) => {
      const datos = parseDatos(s.datosEstructurados);
      const alianzaLabel = (datos?.alianzaTerapeutica ?? null) as
        | AlianzaTerapeutica
        | null;

      return {
        fecha: s.turno.fecha.toISOString(),
        numero: idx + 1,
        intensidadEmocional:
          typeof datos?.intensidadEmocional === "number"
            ? datos.intensidadEmocional
            : null,
        alianzaTerapeutica: alianzaLabel ? ALIANZA_MAP[alianzaLabel] : null,
        alianzaLabel,
        temas: Array.isArray(datos?.temas) ? datos!.temas : [],
        intervenciones: countIntervenciones(datos?.intervenciones),
        flagsRiesgo: (datos?.flagsRiesgo ?? null) as FlagsRiesgo | null,
        speechAnalytics: datos?.speechAnalytics ?? null,
        observacionIA: datos?.observacionIA ?? null,
        progresoPercibido:
          typeof datos?.progresoPercibido === "string"
            ? datos.progresoPercibido
            : null,
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
