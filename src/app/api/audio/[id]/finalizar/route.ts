import { db } from "@/lib/db";
import { getSessionActor } from "@/app/api/_lib/auth";
import { errorResponse, ok } from "@/app/api/_lib/responses";
import { finalizarAudio } from "@/app/api/_lib/casos-uso/audio";
import { finalizarAudioSchema } from "@/app/api/_lib/audio-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId } = await getSessionActor();
    const { id: sesionId } = await context.params;
    const body = finalizarAudioSchema.parse(await request.json());
    const result = await finalizarAudio({ prisma: db, organizationId, sesionId, ...body });
    const response = ok(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return errorResponse(error); }
}

