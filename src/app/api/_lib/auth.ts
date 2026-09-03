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
  const secret = process.env.PROCESSING_SECRET;
  if (!secret) {
    return errorResponse(new ApiError("No autorizado", 401));
  }
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return null;
  return errorResponse(new ApiError("No autorizado", 401));
}
