// Endpoint M2M: lo consume el worker Python (processor/). Se autentica con
// PROCESSING_SECRET (Bearer token); está excluido del matcher de auth en
// src/middleware.ts.
//
// La política de lease (claim atómico, vencimiento, tope de intentos y paso
// a "error") vive en _lib/casos-uso/reclamar-pendientes.ts. Acá solo auth,
// lectura de la configuración por env y respuesta.

import { db } from "@/lib/db";

import { requireM2M } from "../../_lib/auth";
import { reclamarPendientes } from "../../_lib/casos-uso/reclamar-pendientes";
import { errorResponse } from "../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 5;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const LEASE_MINUTES = envNumber("LEASE_MINUTES", 45);
const MAX_INTENTOS = envNumber("MAX_INTENTOS_PROCESAMIENTO", 3);

export async function GET(request: Request) {
  const noAutorizado = requireM2M(request);
  if (noAutorizado) return noAutorizado;

  try {
    const reclamadas = await reclamarPendientes({
      prisma: db,
      ahora: new Date(),
      limite: BATCH_SIZE,
      leaseMinutos: LEASE_MINUTES,
      maxIntentos: MAX_INTENTOS,
    });

    return Response.json(reclamadas);
  } catch (error) {
    return errorResponse(error);
  }
}
