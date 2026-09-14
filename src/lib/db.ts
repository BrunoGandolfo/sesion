// El único cliente Prisma de la app, con la extensión de cifrado.
//
// Antes había dos: este y `db-auth` (sin cifrado, para que Auth.js no
// arrastrara node:crypto al edge). Con las sesiones en base y el proxy sin
// autenticación (src/proxy.ts) ya no hace falta: todo el código de servidor
// corre en Node y usa este cliente. Construirlo valida CLAVES_CIFRADO: sin
// llavero la app no arranca.

import { PrismaClient } from "@prisma/client";

import { withEncryption } from "./prisma-encryption";

function buildClient() {
  return withEncryption(
    new PrismaClient({
      transactionOptions: {
        maxWait: 30000,
        timeout: 30000,
      },
    }),
  );
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof buildClient> | undefined;
};

export const db = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
