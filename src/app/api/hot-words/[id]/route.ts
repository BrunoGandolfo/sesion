import { db } from "@/lib/db";

import { getOrganizationId } from "../../_lib/auth";
import { actualizarHotWord, borrarHotWord } from "../../_lib/casos-uso/hot-words";
import { errorResponse, ok, validationError } from "../../_lib/responses";
import { hotWordUpdateSchema } from "../../_lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;
    const body = await request.json();
    const parsed = hotWordUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const hotWord = await actualizarHotWord({
      prisma: db,
      organizationId,
      hotWordId: id,
      cambios: parsed.data,
    });

    return ok(hotWord);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const organizationId = await getOrganizationId();
    const { id } = await params;

    const resultado = await borrarHotWord({ prisma: db, organizationId, hotWordId: id });

    return ok(resultado);
  } catch (error) {
    return errorResponse(error);
  }
}
