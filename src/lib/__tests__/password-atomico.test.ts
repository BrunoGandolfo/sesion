/**
 * Integración — el cambio de contraseña es atómico. Contra la DB real de test
 * (DATABASE_URL_TEST): hace falta Postgres de verdad porque lo que se prueba
 * es `pg_advisory_xact_lock`, que ningún doble puede imitar.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgres://..." \
 *   npx vitest run src/lib/__tests__/password-atomico.test.ts
 *
 * QUÉ PROTEGE (Codex, P1 sobre el PR #13)
 *
 * Es el mismo agujero que el del login, palabra por palabra, en la otra
 * puerta: evaluar el contador y registrar el fallo eran dos pasos separados,
 * así que N requests en paralelo con una sesión robada leían todos el mismo
 * contador viejo, pasaban todos al bcrypt, y el umbral de 5 no frenaba nada.
 *
 * El caso central es ése: `Promise.all` de N intentos con la contraseña
 * equivocada, y la cuenta de veces que se llegó a comparar tiene que ser el
 * umbral, no N.
 *
 * `eventos_auditoria` NO está en vaciarTablas (los demás tests no la
 * escriben), así que este archivo limpia lo suyo en beforeEach.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { UMBRAL_INTENTOS } from "@/lib/login-intentos";
import {
  ACCION_PASSWORD_FALLIDO,
  ENTIDAD_CUENTA,
  evaluarCambioPassword,
  procesarCambioPassword,
} from "@/lib/password-eventos";

import { conectarBaseDeTest, vaciarTablas } from "./db-test";

let prismaRaw!: PrismaClient;

/** Instante UTC explícito: todos los intentos comparten la misma hora, así la
 *  ventana de 15 minutos no depende de cuánto tarde la corrida. */
const AHORA = new Date("2026-09-05T15:00:00.000Z");

const HUELLA = { ip: "203.0.113.7", userAgent: "vitest" };

/** Más que el umbral, a propósito. */
const EN_PARALELO = 12;

const HASH_GUARDADO = "hash-que-no-se-compara-de-verdad";

interface Cuenta {
  organizationId: string;
  userId: string;
}

async function crearCuenta(): Promise<Cuenta> {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  const user = await prismaRaw.user.create({
    data: {
      email: `${randomUUID()}@test.uy`,
      hashedPassword: HASH_GUARDADO,
      nombre: "Mariana",
      organizationId: org.id,
    },
  });
  return { organizationId: org.id, userId: user.id };
}

/** Cuántos intentos fallidos quedaron registrados para esta cuenta. */
function fallosDe(userId: string): Promise<number> {
  return prismaRaw.eventoAuditoria.count({
    where: {
      entidad: ENTIDAD_CUENTA,
      entidadId: userId,
      accion: ACCION_PASSWORD_FALLIDO,
    },
  });
}

/** Un intento con la contraseña equivocada. `verificar` cuenta las veces que
 *  se lo llamó: es el bcrypt que el atacante quiere alcanzar. */
function intentar(
  cuenta: Cuenta,
  verificar: () => Promise<boolean>,
) {
  return procesarCambioPassword({
    prisma: prismaRaw as unknown as Parameters<
      typeof procesarCambioPassword
    >[0]["prisma"],
    organizationId: cuenta.organizationId,
    userId: cuenta.userId,
    ahora: AHORA,
    huella: HUELLA,
    verificar,
  });
}

beforeAll(() => {
  ({ prisma: prismaRaw } = conectarBaseDeTest());
});

beforeEach(async () => {
  await vaciarTablas(prismaRaw);
  await prismaRaw.eventoAuditoria.deleteMany({
    where: { accion: ACCION_PASSWORD_FALLIDO },
  });
});

afterAll(async () => {
  await prismaRaw.eventoAuditoria.deleteMany({
    where: { accion: ACCION_PASSWORD_FALLIDO },
  });
  await prismaRaw.$disconnect();
});

describe("procesarCambioPassword", () => {
  it("N intentos equivocados en paralelo no pasan del umbral", async () => {
    const cuenta = await crearCuenta();
    let comparaciones = 0;

    const resultados = await Promise.all(
      Array.from({ length: EN_PARALELO }, () =>
        intentar(cuenta, async () => {
          comparaciones += 1;
          return false;
        }),
      ),
    );

    // Ninguno cambia nada: todas las contraseñas eran incorrectas.
    expect(resultados.every((r) => r.estado !== "ok")).toBe(true);

    // Lo que importa: se llegó a comparar exactamente UMBRAL veces. Sin el
    // lock, los 12 leían "0 fallos" y comparaban los 12.
    expect(comparaciones).toBe(UMBRAL_INTENTOS);

    // Y quedó escrito un fallo por comparación. Ni de más (un intento
    // bloqueado no registra nada) ni de menos.
    expect(await fallosDe(cuenta.userId)).toBe(UMBRAL_INTENTOS);

    // Los que sobraron contestaron "bloqueado", no "credencial-incorrecta":
    // la ruta los traduce a 429 y no a 400.
    const bloqueados = resultados.filter((r) => r.estado === "bloqueado");
    expect(bloqueados).toHaveLength(EN_PARALELO - UMBRAL_INTENTOS);
  });

  it("después de la tanda la cuenta queda bloqueada", async () => {
    const cuenta = await crearCuenta();

    await Promise.all(
      Array.from({ length: EN_PARALELO }, () =>
        intentar(cuenta, async () => false),
      ),
    );

    const estado = await evaluarCambioPassword({
      prisma: prismaRaw,
      userId: cuenta.userId,
      ahora: AHORA,
    });
    expect(estado.bloqueado).toBe(true);
    expect(estado.nivel).toBe(1);
  });

  it("un intento bloqueado no compara ni escribe nada", async () => {
    // Si cada bloqueo contara como fallo, quien tiene la sesión robada
    // dejaría a la dueña sin poder cambiar su propia contraseña para siempre.
    const cuenta = await crearCuenta();

    await Promise.all(
      Array.from({ length: EN_PARALELO }, () =>
        intentar(cuenta, async () => false),
      ),
    );
    const despuesDeLaTanda = await fallosDe(cuenta.userId);

    let comparaciones = 0;
    const resultado = await intentar(cuenta, async () => {
      comparaciones += 1;
      return false;
    });

    expect(resultado.estado).toBe("bloqueado");
    expect(comparaciones).toBe(0);
    expect(await fallosDe(cuenta.userId)).toBe(despuesDeLaTanda);
  });

  it("con la contraseña actual correcta contesta ok y no registra fallo", async () => {
    const cuenta = await crearCuenta();

    const resultado = await intentar(cuenta, async (hashGuardado) => {
      expect(hashGuardado).toBe(HASH_GUARDADO);
      return true;
    });

    expect(resultado.estado).toBe("ok");
    expect(await fallosDe(cuenta.userId)).toBe(0);
  });

  it("cuatro fallos no impiden cambiarla al quinto intento", async () => {
    const cuenta = await crearCuenta();

    for (let i = 0; i < UMBRAL_INTENTOS - 1; i++) {
      await intentar(cuenta, async () => false);
    }

    const resultado = await intentar(cuenta, async () => true);
    expect(resultado.estado).toBe("ok");
  });

  it("con un usuario de otra organización contesta sin-usuario", async () => {
    const cuenta = await crearCuenta();
    const otra = await crearCuenta();

    const resultado = await procesarCambioPassword({
      prisma: prismaRaw as unknown as Parameters<
        typeof procesarCambioPassword
      >[0]["prisma"],
      organizationId: otra.organizationId,
      userId: cuenta.userId,
      ahora: AHORA,
      huella: HUELLA,
      verificar: async () => true,
    });

    expect(resultado.estado).toBe("sin-usuario");
  });
});
