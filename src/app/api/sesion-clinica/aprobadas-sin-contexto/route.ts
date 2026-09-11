// Endpoint M2M: lo consume el worker Python (processor/) para la Llamada B
// del Golden Thread (integrar cada sesión aprobada al contexto longitudinal
// del paciente). Se autentica con PROCESSING_SECRET (Bearer token); está
// excluido del matcher de auth en src/middleware.ts.
//
// La regla "aprobada pero no integrada" vive en
// _lib/casos-uso/sesiones-sin-contexto.ts. Acá solo auth, fecha de corte por
// env y respuesta.

import { db } from "@/lib/db";

import { requireM2M } from "../../_lib/auth";
import { sesionesSinContexto } from "../../_lib/casos-uso/sesiones-sin-contexto";
import { errorResponse } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

const MAX_RESULTADOS = 5;

// Fecha de corte: CONTEXTO_DESDE (ISO). Si falta o no parsea, el inicio del
// día de hoy (hora local del server) — así un deploy sin la env no dispara
// la integración retroactiva de todo el histórico.
function fechaCorte(): Date {
  const raw = process.env.CONTEXTO_DESDE;
  if (raw && raw.trim() !== "") {
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

export async function GET(request: Request) {
  const noAutorizado = requireM2M(request);
  if (noAutorizado) return noAutorizado;

  try {
    const resultado = await sesionesSinContexto({
      prisma: db,
      desde: fechaCorte(),
      limite: MAX_RESULTADOS,
    });

    return Response.json(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}
