/**
 * Integración — el intento de login es atómico. Contra la DB real de test
 * (DATABASE_URL_TEST): hace falta Postgres de verdad porque lo que se prueba
 * es `pg_advisory_xact_lock`, que ningún doble puede imitar.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/login-atomico.test.ts
 *
 * QUÉ PROTEGE
 *
 * El agujero que reportó Codex sobre el PR #11: evaluar el contador y
 * registrar el fallo eran dos pasos separados, así que N requests en paralelo
 * leían todos el mismo contador viejo, todos pasaban, y el umbral de 5 no
 * frenaba nada. Un atacante lo saltaba mandando la tanda entera de una.
 *
 * El caso central de acá es exactamente ése: `Promise.all` de N intentos
 * fallidos contra el mismo email y la misma IP, y la cuenta de veces que se
 * llegó a verificar la contraseña tiene que ser el umbral, no N.
 *
 * `eventos_auditoria` NO está en vaciarTablas (los otros tests no la
 * escriben), así que este archivo limpia lo suyo en beforeEach.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { UMBRAL_INTENTOS } from "@/lib/login-intentos";

import { conectarBaseDeTest, vaciarTablas } from "./db-test";

let prismaRaw!: PrismaClient;
let login!: typeof import("@/lib/login-eventos");

/** Instante UTC explícito: todos los intentos comparten la misma hora, así
 *  la ventana de 15 minutos no depende de cuánto tarde la corrida. */
const AHORA = new Date("2026-09-05T15:00:00.000Z");

const IP = "203.0.113.7";
const USER_AGENT = "vitest";

/** Cuántos intentos se mandan a la vez. Más que el umbral, a propósito. */
const EN_PARALELO = 12;

function intentoDe(email: string) {
  return { email, ip: IP, userAgent: USER_AGENT, ahora: AHORA };
}

/** Cuenta las filas de fallo escritas para la clave del email. */
async function fallosDelEmail(email: string): Promise<number> {
  return prismaRaw.eventoAuditoria.count({
    where: {
      entidad: login.ENTIDAD_LOGIN,
      accion: login.ACCION_LOGIN_FALLIDO,
      entidadId: await login.claveEmail(email),
    },
  });
}

beforeAll(async () => {
  ({ prisma: prismaRaw } = conectarBaseDeTest());

  // Mismo patrón que multi-tenant.test.ts: src/lib/db-auth.ts cachea el
  // cliente en globalThis, así que dejarlo puesto ANTES del import hace que
  // el módulo use la base de test. Por eso el import es dinámico.
  (globalThis as unknown as { prismaAuth: unknown }).prismaAuth = prismaRaw;
  login = await import("@/lib/login-eventos");
});

beforeEach(async () => {
  await vaciarTablas(prismaRaw);
  await prismaRaw.eventoAuditoria.deleteMany({
    where: { entidad: "login" },
  });
});

afterAll(async () => {
  await prismaRaw.eventoAuditoria.deleteMany({ where: { entidad: "login" } });
  await prismaRaw.$disconnect();
});

describe("procesarIntento", () => {
  it("N intentos fallidos en paralelo no pasan del umbral", async () => {
    const email = `${randomUUID()}@test.uy`;
    let verificaciones = 0;

    const resultados = await Promise.all(
      Array.from({ length: EN_PARALELO }, () =>
        login.procesarIntento<string>({
          prisma: prismaRaw,
          intento: intentoDe(email),
          verificar: async () => {
            verificaciones += 1;
            return { ok: false, motivo: "password", organizationId: null };
          },
        }),
      ),
    );

    // Ninguno entra: todas las contraseñas eran incorrectas.
    expect(resultados.every((r) => r === null)).toBe(true);

    // Lo que importa: la contraseña se llegó a verificar exactamente UMBRAL
    // veces. Sin el lock, los 12 leían "0 fallos" y verificaban los 12.
    expect(verificaciones).toBe(UMBRAL_INTENTOS);

    // Y quedó escrito exactamente un fallo por verificación. Ni de más (un
    // intento bloqueado no registra nada) ni de menos.
    expect(await fallosDelEmail(email)).toBe(UMBRAL_INTENTOS);
  });

  it("después de la tanda el email queda bloqueado", async () => {
    const email = `${randomUUID()}@test.uy`;

    await Promise.all(
      Array.from({ length: EN_PARALELO }, () =>
        login.procesarIntento({
          prisma: prismaRaw,
          intento: intentoDe(email),
          verificar: async () => ({
            ok: false as const,
            motivo: "password" as const,
            organizationId: null,
          }),
        }),
      ),
    );

    const estado = await login.evaluarIntento(intentoDe(email), prismaRaw);
    expect(estado.bloqueado).toBe(true);
    expect(estado.nivel).toBe(1);
  });

  it("un intento bloqueado no escribe ninguna fila nueva", async () => {
    // Si cada intento bloqueado contara como fallo, quien golpea la puerta
    // dejaría afuera a la profesional para siempre y la tabla crecería sin
    // techo.
    const email = `${randomUUID()}@test.uy`;

    await Promise.all(
      Array.from({ length: EN_PARALELO }, () =>
        login.procesarIntento({
          prisma: prismaRaw,
          intento: intentoDe(email),
          verificar: async () => ({
            ok: false as const,
            motivo: "password" as const,
            organizationId: null,
          }),
        }),
      ),
    );
    const despuesDeLaTanda = await fallosDelEmail(email);

    let verificaciones = 0;
    const resultado = await login.procesarIntento({
      prisma: prismaRaw,
      intento: intentoDe(email),
      verificar: async () => {
        verificaciones += 1;
        return { ok: false as const, motivo: "password" as const, organizationId: null };
      },
    });

    expect(resultado).toBeNull();
    expect(verificaciones).toBe(0);
    expect(await fallosDelEmail(email)).toBe(despuesDeLaTanda);
  });

  it("con la credencial buena devuelve la sesión y registra la entrada", async () => {
    const email = `${randomUUID()}@test.uy`;
    const org = await prismaRaw.organization.create({
      data: { nombre: `Org ${randomUUID()}` },
    });
    const user = await prismaRaw.user.create({
      data: {
        email,
        hashedPassword: "no-importa",
        nombre: "Mariana",
        organizationId: org.id,
      },
    });

    const sesion = await login.procesarIntento<{ id: string }>({
      prisma: prismaRaw,
      intento: intentoDe(email),
      verificar: async () => ({
        ok: true,
        userId: user.id,
        organizationId: org.id,
        sesion: { id: user.id },
      }),
    });

    expect(sesion).toEqual({ id: user.id });
    expect(await fallosDelEmail(email)).toBe(0);

    const entradas = await prismaRaw.eventoAuditoria.count({
      where: {
        entidad: login.ENTIDAD_LOGIN,
        accion: login.ACCION_LOGIN_OK,
        entidadId: user.id,
      },
    });
    expect(entradas).toBe(1);
  });

  it("cuatro fallos no impiden entrar al quinto intento, si la credencial es buena", async () => {
    const email = `${randomUUID()}@test.uy`;
    const org = await prismaRaw.organization.create({
      data: { nombre: `Org ${randomUUID()}` },
    });
    const user = await prismaRaw.user.create({
      data: {
        email,
        hashedPassword: "no-importa",
        nombre: "Mariana",
        organizationId: org.id,
      },
    });

    for (let i = 0; i < UMBRAL_INTENTOS - 1; i++) {
      await login.procesarIntento({
        prisma: prismaRaw,
        intento: intentoDe(email),
        verificar: async () => ({
          ok: false as const,
          motivo: "password" as const,
          organizationId: org.id,
        }),
      });
    }

    const sesion = await login.procesarIntento<{ id: string }>({
      prisma: prismaRaw,
      intento: intentoDe(email),
      verificar: async () => ({
        ok: true,
        userId: user.id,
        organizationId: org.id,
        sesion: { id: user.id },
      }),
    });

    expect(sesion).toEqual({ id: user.id });
  });
});
