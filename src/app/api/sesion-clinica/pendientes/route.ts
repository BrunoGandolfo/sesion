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
        createdAt: true,
        turno: {
          select: {
            paciente: { select: { nombre: true, apellido: true } },
          },
        },
      },
    });

    const payload = sesiones.map((s) => ({
      sesionClinicaId: s.id,
      turnoId: s.turnoId,
      audioR2Key: s.audioR2Key,
      duracionAudioSeg: s.duracionAudioSeg,
      pacienteNombre: `${s.turno.paciente.nombre} ${s.turno.paciente.apellido}`,
      createdAt: s.createdAt.toISOString(),
    }));

    return Response.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
