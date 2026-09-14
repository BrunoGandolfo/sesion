import { db } from "@/lib/db";

import { getOrganizationId } from "../_lib/auth";
import {
  crearHotWord,
  crearHotWords,
  listarHotWords,
} from "../_lib/casos-uso/hot-words";
import { errorResponse, ok, validationError } from "../_lib/responses";
import {
  hotWordItemSchema,
  hotWordsBulkSchema,
  hotWordsQuerySchema,
} from "../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

export async function GET(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const url = new URL(request.url);

    const parsed = hotWordsQuerySchema.safeParse({
      scope: url.searchParams.get("scope") ?? undefined,
      pacienteId: url.searchParams.get("pacienteId") ?? undefined,
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const hotWords = await listarHotWords({
      prisma: db,
      organizationId,
      scope: parsed.data.scope,
      pacienteId: parsed.data.pacienteId,
    });

    return ok(hotWords);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const organizationId = await getOrganizationId();
    const body: unknown = await request.json();

    // Carga masiva: { hotWords: [...] }. Un término suelto: el objeto solo.
    if (typeof body === "object" && body !== null && "hotWords" in body) {
      const parsed = hotWordsBulkSchema.safeParse(body);
      if (!parsed.success) {
        return validationError(parsed.error);
      }

      const result = await crearHotWords({
        prisma: db,
        organizationId,
        hotWords: parsed.data.hotWords,
      });

      return ok(result, 201);
    }

    const parsed = hotWordItemSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const hotWord = await crearHotWord({
      prisma: db,
      organizationId,
      hotWord: parsed.data,
    });

    return ok(hotWord, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
