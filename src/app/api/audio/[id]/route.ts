import { db } from "@/lib/db";
import { getSessionActor } from "@/app/api/_lib/auth";
import { errorResponse, ok } from "@/app/api/_lib/responses";
import { estadoAudio } from "@/app/api/_lib/casos-uso/audio";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId } = await getSessionActor();
    const { id: sesionId } = await context.params;

    const result = await estadoAudio({ prisma: db, organizationId, sesionId });
    const response = ok(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return errorResponse(error); }
}

