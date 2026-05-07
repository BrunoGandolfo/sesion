import { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma liviano para autenticación.
 * Sin extensión de cifrado — compatible con Edge Runtime.
 * Solo se usa en auth.ts para lookup de usuarios.
 */
const globalForAuth = globalThis as unknown as {
  prismaAuth: PrismaClient | undefined;
};

export const dbAuth = globalForAuth.prismaAuth ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForAuth.prismaAuth = dbAuth;
