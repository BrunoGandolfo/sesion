import { getCurrentOrganizationId, getServerSession } from "@/lib/auth-utils";

import { ApiError, errorResponse } from "./responses";

export async function getOrganizationId() {
  try {
    return await getCurrentOrganizationId();
  } catch {
    throw new ApiError("No autorizado", 401);
  }
}

export interface SessionActor {
  organizationId: string;
  userId: string;
}

/**
 * Igual que getOrganizationId (401 sin sesión) pero devuelve también el
 * userId, para que las rutas que registran auditoría lo tengan con UNA sola
 * llamada a auth() en vez de resolver la sesión dos veces.
 */
export async function getSessionActor(): Promise<SessionActor> {
  const session = await getServerSession();
  if (!session) {
    throw new ApiError("No autorizado", 401);
  }
  return { organizationId: session.organizationId, userId: session.userId };
}

/**
 * Auth M2M para el worker Python: `Authorization: Bearer ${PROCESSING_SECRET}`
 * exacto. Devuelve null si está autorizado; si no, la misma respuesta 401
 * que producían las copias locales de isAuthorized en callback, pendientes,
 * aprobadas-sin-contexto y contexto-clinico. Sin secret configurado nunca
 * autoriza. Cubre solo el caso Bearer puro: contexto-clinico además acepta
 * sesión de usuario, y los crons/seed usan otros secrets (CRON_SECRET,
 * SEED_SECRET); esos casos siguen en sus rutas.
 */
export function requireM2M(request: Request): Response | null {
  return requireBearer(request, process.env.PROCESSING_SECRET);
}

/**
 * Auth de los crons (Vercel Cron u otro scheduler): `Authorization: Bearer
 * ${CRON_SECRET}` exacto. Misma semántica que requireM2M: null si autoriza,
 * 401 si no; sin secret configurado nunca autoriza.
 */
export function requireCron(request: Request): Response | null {
  return requireBearer(request, process.env.CRON_SECRET);
}

/**
 * Comparación exacta del header Authorization contra `Bearer ${secret}`.
 * Cuerpo único de requireM2M, requireCron y del seed (SEED_SECRET).
 * Devuelve null si autoriza; si no, la respuesta 401 de errorResponse.
 * Un secret ausente o vacío nunca autoriza.
 */
export function requireBearer(
  request: Request,
  secret: string | undefined,
): Response | null {
  if (!secret) {
    return errorResponse(new ApiError("No autorizado", 401));
  }
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return null;
  return errorResponse(new ApiError("No autorizado", 401));
}
