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
