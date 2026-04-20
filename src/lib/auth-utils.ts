import { auth } from "@/lib/auth";
import type { Session } from "next-auth";

export type ServerSession = Session & {
  userId: string;
  organizationId: string;
};

export async function getServerSession(): Promise<ServerSession | null> {
  const session = await auth();

  if (!session?.userId || !session.organizationId) {
    return null;
  }

  return session as ServerSession;
}

export async function getCurrentOrganizationId(): Promise<string> {
  const session = await getServerSession();

  if (!session) {
    throw new Error("No hay sesión activa.");
  }

  return session.organizationId;
}
