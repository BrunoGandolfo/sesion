// Trabajos para el worker (M2M con PROCESSING_SECRET). `?tipos=a,b` limita
// a los tipos que ese worker sabe ejecutar; sin el parámetro, todos los de
// ejecutor worker. Cada trabajo viaja con su ticket y su adjunto.

import type { TipoTrabajo } from "@prisma/client";
import { db } from "@/lib/db";

import { requireM2M } from "../../_lib/auth";
import { identidadWorker, registrarLatido } from "../../_lib/casos-uso/sesion/latido";
import { entregarTrabajos } from "../../_lib/casos-uso/trabajos/entregar";
import { ApiError, errorResponse } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BATCH_SIZE = 5;
const TIPOS: ReadonlyArray<TipoTrabajo> = [
  "borrar_audio_r2",
  "borrar_transcript_asr",
  "generar_feedback",
  "integrar_contexto",
];

function tiposDe(request: Request): TipoTrabajo[] | undefined {
  const crudo = new URL(request.url).searchParams.get("tipos");
  if (!crudo) return undefined;
  const tipos = crudo.split(",").map((t) => t.trim()).filter(Boolean);
  for (const t of tipos) {
    if (!(TIPOS as readonly string[]).includes(t)) {
      throw new ApiError(`Tipo de trabajo desconocido: ${t}`, 400);
    }
  }
  return tipos as TipoTrabajo[];
}

export async function GET(request: Request) {
  const noAutorizado = requireM2M(request);
  if (noAutorizado) return noAutorizado;

  try {
    const ahora = new Date();
    const entregados = await entregarTrabajos({
      prisma: db,
      ahora,
      limite: BATCH_SIZE,
      tipos: tiposDe(request),
    });
    await registrarLatido({ prisma: db, ...identidadWorker(request), ahora, tipo: "poll" });
    return Response.json(entregados);
  } catch (error) {
    return errorResponse(error);
  }
}
