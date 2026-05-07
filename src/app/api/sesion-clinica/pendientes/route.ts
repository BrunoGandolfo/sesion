// TODO: agregar `api/sesion-clinica/pendientes` a las exclusiones del matcher en
// src/middleware.ts. Este endpoint se autentica machine-to-machine con
// PROCESSING_SECRET (Bearer token), no con sesión de usuario.

import { db } from "@/lib/db";

import { errorResponse } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 5;

function isAuthorized(request: Request): boolean {
  const secret = process.env.PROCESSING_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

// El upload guarda la clave/IV de cifrado dentro de datosEstructurados bajo
// `_audioCifradoTemporal`. Acepta el campo como string JSON (legacy) o como
// objeto ya parseado (post-extension Prisma).
function extraerCriptoTemporal(
  datosEstructurados: unknown,
): { claveCifrado: string | null; iv: string | null } {
  if (datosEstructurados == null) return { claveCifrado: null, iv: null };
  let parsed: unknown = datosEstructurados;
  if (typeof datosEstructurados === "string") {
    try {
      parsed = JSON.parse(datosEstructurados);
    } catch {
      return { claveCifrado: null, iv: null };
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { claveCifrado: null, iv: null };
  }
  const stash = (parsed as Record<string, unknown>)._audioCifradoTemporal;
  if (typeof stash !== "object" || stash === null) {
    return { claveCifrado: null, iv: null };
  }
  const clave = (stash as Record<string, unknown>).claveCifrado;
  const iv = (stash as Record<string, unknown>).ivCifrado;
  return {
    claveCifrado: typeof clave === "string" ? clave : null,
    iv: typeof iv === "string" ? iv : null,
  };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const sesiones = await db.sesionClinica.findMany({
      where: { estado: "procesando" },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      select: {
        id: true,
        turnoId: true,
        audioR2Key: true,
        duracionAudioSeg: true,
        datosEstructurados: true,
        createdAt: true,
        turno: {
          select: {
            paciente: { select: { nombre: true, apellido: true } },
          },
        },
      },
    });

    const payload = sesiones.map((s) => {
      const { claveCifrado, iv } = extraerCriptoTemporal(s.datosEstructurados);
      return {
        sesionClinicaId: s.id,
        turnoId: s.turnoId,
        audioR2Key: s.audioR2Key,
        duracionAudioSeg: s.duracionAudioSeg,
        pacienteNombre: `${s.turno.paciente.nombre} ${s.turno.paciente.apellido}`,
        claveCifrado,
        iv,
        createdAt: s.createdAt.toISOString(),
      };
    });

    return Response.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
