// Endpoint del Golden Thread. Auth dual en GET y PATCH:
//   - Bearer PROCESSING_SECRET (M2M): worker Python (lee el contexto antes de
//     llamar al LLM; escribe la sugerencia de la Llamada B).
//   - Sesión next-auth (UI): la terapeuta ve/edita el contexto.
// Por la auth M2M este path está excluido del matcher de middleware
// (src/middleware.ts). La lógica vive en src/app/api/_lib/contexto-clinico/*.

import { db } from "@/lib/db";

import { registrarAuditoria } from "../../../_lib/auditoria";
import { getSessionActor, requireM2M } from "../../../_lib/auth";
import { actualizarContexto } from "../../../_lib/contexto-clinico/actualizar";
import { cargarContexto } from "../../../_lib/contexto-clinico/cargar";
import { formatearParaLLM } from "../../../_lib/contexto-clinico/formato-llm";
import {
  cambiosContextoSchema,
  type ActorContexto,
} from "../../../_lib/contexto-clinico/tipos";
import { requirePaciente } from "../../../_lib/pacientes";
import { ApiError, errorResponse, ok, validationError } from "../../../_lib/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // segundos; la convención está en scripts/ci/max-duration.mjs

type RouteParams = { params: Promise<{ id: string }> };

// Bearer primero (más barato; su 401 se descarta porque después se prueba
// sesión). El worker no tiene org: se toma la del paciente. La sesión queda
// scopeada por su org (404 si el paciente no es suyo).
async function autorizar(
  request: Request,
  pacienteId: string,
): Promise<{ actor: ActorContexto; organizationId: string }> {
  if (requireM2M(request) === null) {
    const paciente = await db.paciente.findFirst({
      where: { id: pacienteId },
      select: { organizationId: true },
    });
    if (!paciente) throw new ApiError("Paciente no encontrado", 404);
    return { actor: { tipo: "worker" }, organizationId: paciente.organizationId };
  }
  const { organizationId, userId } = await getSessionActor();
  await requirePaciente(db, pacienteId, organizationId);
  return { actor: { tipo: "terapeuta", userId }, organizationId };
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: pacienteId } = await params;
    const { organizationId } = await autorizar(request, pacienteId);
    const contexto = await cargarContexto({ prisma: db, pacienteId, organizationId });

    if (new URL(request.url).searchParams.get("format") === "llm") {
      return new Response(formatearParaLLM(contexto), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    return ok(contexto);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id: pacienteId } = await params;
    const { actor, organizationId } = await autorizar(request, pacienteId);

    const body = await request.json().catch(() => null);
    const parsed = cambiosContextoSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const { version, contexto } = await actualizarContexto({
      prisma: db,
      pacienteId,
      organizationId,
      cambios: parsed.data,
      actor,
    });

    // Solo NOMBRES de campos y versión: el contenido es PHI y no va al registro.
    await registrarAuditoria({
      organizationId,
      actorTipo: actor.tipo === "terapeuta" ? "usuario" : "worker",
      actorId: actor.tipo === "terapeuta" ? actor.userId : null,
      accion: "contexto.actualizar",
      entidad: "paciente_contexto_clinico",
      entidadId: pacienteId,
      detalle: { version, camposEnviados: Object.keys(parsed.data) },
    });

    return ok(contexto);
  } catch (error) {
    return errorResponse(error);
  }
}
