import { db } from "@/lib/db";
import { getSessionActor } from "@/app/api/_lib/auth";
import { errorResponse, ok } from "@/app/api/_lib/responses";
import { reservarSegmento } from "@/app/api/_lib/casos-uso/audio";
import { segmentoAudioSchema } from "@/app/api/_lib/audio-schemas";
import { objetosAudio } from "@/lib/r2";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId } = await getSessionActor();
    const { id: sesionId } = await context.params;
    const body = segmentoAudioSchema.parse(await request.json());
    const result = await reservarSegmento({ prisma: db, organizationId, sesionId, descriptor: body, objetos: objetosAudio });
    const response = ok(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return errorResponse(error); }
}

