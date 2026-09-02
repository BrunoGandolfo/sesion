import { getCurrentOrganizationId, getServerSession } from "@/lib/auth-utils";

import { ApiError } from "./responses";

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
