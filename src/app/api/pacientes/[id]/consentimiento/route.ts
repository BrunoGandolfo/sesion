import { z } from "zod";

import { db } from "@/lib/db";

import { getSessionActor } from "../../../_lib/auth";
import {
  firmarConsentimiento,
  obtenerConsentimiento,
  revocarConsentimiento,
} from "../../../_lib/casos-uso/consentimiento";
import {
  ApiError,
  errorResponse,
  ok,
  validationError,
} from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = {
  params: Promise<{ id: string }>;
};

const createConsentimientoSchema = z.object({
  firmaDigital: z.string().trim().min(1, "Falta la firma digital"),
  textoVersion: z.string().trim().min(1, "Falta la versión del texto"),
});

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("JSON inválido", 400);
  }
}

// getSessionActor y no getOrganizationId incluso en el GET: la ruta resuelve
// la sesión una sola vez y el caso de uso necesita QUIÉN para el rastro.

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId } = await getSessionActor();
    const { id } = await params;

    // Envoltorio único de la API: { data: { consentimiento } }. `null` es
    // una respuesta legítima —la paciente no firmó—, no un 404.
    return ok({
      consentimiento: await obtenerConsentimiento({
        prisma: db,
        organizationId,
        pacienteId: id,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    const parsed = createConsentimientoSchema.safeParse(
      await parseJsonBody(request),
    );
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { consentimiento } = await firmarConsentimiento({
      prisma: db,
      organizationId,
      pacienteId: id,
      usuarioId: userId,
      firmaDigital: parsed.data.firmaDigital,
      textoVersion: parsed.data.textoVersion,
    });

    // Mismo envoltorio que el GET: { data: { consentimiento } }. Antes salía
    // sin `data` y el cliente de API, que desenvuelve siempre, entregaba
    // undefined; ninguno de los dos consumidores lee el cuerpo, así que el
    // contrato roto no se notaba.
    return ok({ consentimiento }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId, userId } = await getSessionActor();
    const { id } = await params;

    // { data: { revocados } }: el mismo envoltorio que el GET y el POST.
    return ok(
      await revocarConsentimiento({
        prisma: db,
        organizationId,
        pacienteId: id,
        usuarioId: userId,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
