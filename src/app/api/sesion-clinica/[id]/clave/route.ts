// La clave AES de la sesión, para que el teléfono cifre cada trozo antes de
// guardarlo y el archivo entero antes de subirlo. Sólo mientras la sesión
// está en grabando y la autorización sigue vigente. POST y sin caché: es
// material criptográfico, no un recurso que se lea.

import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import { claveAudio } from "../../../_lib/casos-uso/audio";
import { errorResponse, ok } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId } = await getSessionActor();
    const { id } = await params;
    const response = ok(await claveAudio({ prisma: db, organizationId, sesionId: id }));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
