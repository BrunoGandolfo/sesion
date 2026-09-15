import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionActor } from "@/app/api/_lib/auth";
import { leerVersion } from "@/app/api/_lib/casos-uso/hilo/base";
import { responderHilo } from "@/app/api/_lib/hilo-http";
import { errorResponse } from "@/app/api/_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string }> }) {
  try {
    const { id, version } = await params;
    const { organizationId } = await getSessionActor();
    return responderHilo(await leerVersion(db, { pacienteId: id, organizationId }, z.coerce.number().int().positive().parse(version)));
  } catch (error) { return errorResponse(error); }
}
