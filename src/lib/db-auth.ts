import { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma liviano para autenticación.
 * Sin extensión de cifrado — compatible con Edge Runtime.
 * Auth.js lo usa para lookup de usuarios; las rutas Node de cuentas también
 * lo usan para credenciales e invitaciones, sin datos clínicos.
 */
const globalForAuth = globalThis as unknown as {
  prismaAuth: PrismaClient | undefined;
};

export const dbAuth = globalForAuth.prismaAuth ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForAuth.prismaAuth = dbAuth;
