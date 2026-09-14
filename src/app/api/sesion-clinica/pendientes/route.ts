// Reclamo del worker (M2M con PROCESSING_SECRET: es lo ÚNICO que ese secreto
// autoriza; el resto va con el ticket de cada sesión). También es el latido:
// cada poll actualiza worker_estado. `?limite=` (1 por defecto, tope 5): el
// worker sólo debe reclamar lo que puede empezar YA, porque el lease de lo
// que espera en su cola no se renueva.

import { db } from "@/lib/db";

import { requireM2M } from "../../_lib/auth";
import { identidadWorker, registrarLatido } from "../../_lib/casos-uso/sesion/latido";
import { limiteReclamo, reclamarSesiones } from "../../_lib/casos-uso/sesion/reclamar";
import { terminosAsr } from "../../_lib/casos-uso/terminos-asr";
import { errorResponse } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET(request: Request) {
  const noAutorizado = requireM2M(request);
  if (noAutorizado) return noAutorizado;

  try {
    const ahora = new Date();
    const reclamadas = await reclamarSesiones({
      prisma: db,
      ahora,
      limite: limiteReclamo(new URL(request.url).searchParams.get("limite")),
      terminosAsr: (organizationId, pacienteId) =>
        terminosAsr({ prisma: db, organizationId, pacienteId }),
    });
    await registrarLatido({ prisma: db, ...identidadWorker(request), ahora, tipo: "poll" });
    return Response.json(reclamadas);
  } catch (error) {
    return errorResponse(error);
  }
}
