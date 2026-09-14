// Unitario: la política aplicada a intentos_acceso es LA MISMA del login
// (login-intentos.ts) y la consulta filtra por lo que tiene que filtrar.
import { describe, expect, it } from "vitest";

import {
  claveEmail,
  claveIp,
  claveRecuperarIp,
  claveUsuario,
  evaluarBloqueoDe,
  registrarIntentoFallido,
  type ClienteIntentos,
} from "@/lib/intentos-acceso";
import { UMBRAL_INTENTOS, VENTANA_MIN } from "@/lib/login-intentos";

const AHORA = new Date("2026-09-05T12:00:00.000Z");
const MS_POR_MINUTO = 60_000;

type Consulta = { where: Record<string, unknown> };

function prismaFalso(filas: { clave: string; creadoEn: Date }[], consultas: Consulta[] = [], creadas: unknown[] = []) {
  return {
    intentoAcceso: {
      findMany: async (args: Consulta) => {
        consultas.push(args);
        return filas;
      },
      createMany: async (args: { data: unknown[] }) => {
        creadas.push(...args.data);
        return { count: args.data.length };
      },
    },
  } as unknown as ClienteIntentos;
}

function recientes(clave: string, cuantos: number) {
  return Array.from({ length: cuantos }, (_, i) => ({
    clave,
    creadoEn: new Date(AHORA.getTime() - (cuantos - i) * MS_POR_MINUTO),
  }));
}

describe("claves", () => {
  it("el email va hasheado; la IP y la usuaria en claro con prefijo", async () => {
    const c = await claveEmail("mariana@example.test");
    expect(c).toMatch(/^email:[a-f0-9]{64}$/);
    expect(c).not.toContain("mariana");
    expect(claveIp("203.0.113.7")).toBe("ip:203.0.113.7");
    expect(claveUsuario("u1")).toBe("usuario:u1");
    expect(claveRecuperarIp("203.0.113.7")).toBe("recuperar-ip:203.0.113.7");
  });
});

describe("evaluarBloqueoDe", () => {
  it("sin fallos deja pasar", async () => {
    const estado = await evaluarBloqueoDe(prismaFalso([]), "login", ["ip:1"], AHORA);
    expect(estado.bloqueado).toBe(false);
  });

  it("al llegar al umbral bloquea con el mismo umbral del login", async () => {
    const estado = await evaluarBloqueoDe(prismaFalso(recientes("ip:1", UMBRAL_INTENTOS)), "login", ["ip:1"], AHORA);
    expect(estado.bloqueado).toBe(true);
    expect(estado.nivel).toBe(1);
  });

  it("toma el más restrictivo entre las claves: la IP bloquea aunque el email esté limpio", async () => {
    const filas = recientes("ip:1", UMBRAL_INTENTOS);
    const estado = await evaluarBloqueoDe(prismaFalso(filas), "login", ["email:x", "ip:1"], AHORA);
    expect(estado.bloqueado).toBe(true);
  });

  it("los mismos fallos repartidos fuera de la ventana no bloquean", async () => {
    const filas = Array.from({ length: UMBRAL_INTENTOS }, (_, i) => ({
      clave: "ip:1",
      creadoEn: new Date(AHORA.getTime() - (i + 1) * (VENTANA_MIN + 5) * MS_POR_MINUTO),
    }));
    expect((await evaluarBloqueoDe(prismaFalso(filas), "login", ["ip:1"], AHORA)).bloqueado).toBe(false);
  });

  it("consulta por tipo, por las claves y dentro de la memoria", async () => {
    const consultas: Consulta[] = [];
    await evaluarBloqueoDe(prismaFalso([], consultas), "password", ["usuario:u1"], AHORA);
    expect(consultas).toHaveLength(1);
    expect(consultas[0].where).toMatchObject({ tipo: "password", clave: { in: ["usuario:u1"] } });
    expect(consultas[0].where.creadoEn).toBeDefined();
  });

  it("si la consulta falla deja pasar en vez de dejar afuera a la dueña", async () => {
    const prisma = {
      intentoAcceso: { findMany: async () => { throw new Error("la base tosió"); } },
    } as unknown as ClienteIntentos;
    expect((await evaluarBloqueoDe(prisma, "login", ["ip:1"], AHORA)).bloqueado).toBe(false);
  });
});

describe("registrarIntentoFallido", () => {
  it("escribe una fila por clave, con tipo, IP y user-agent", async () => {
    const creadas: unknown[] = [];
    await registrarIntentoFallido(prismaFalso([], [], creadas), {
      tipo: "login",
      claves: ["email:h", "ip:1"],
      huella: { ip: "1", userAgent: "vitest" },
      ahora: AHORA,
    });
    expect(creadas).toEqual([
      { tipo: "login", clave: "email:h", ip: "1", userAgent: "vitest", creadoEn: AHORA },
      { tipo: "login", clave: "ip:1", ip: "1", userAgent: "vitest", creadoEn: AHORA },
    ]);
  });

  it("nunca lanza: un registro roto no vuelve un 401 en un 500", async () => {
    const prisma = {
      intentoAcceso: { createMany: async () => { throw new Error("no"); } },
    } as unknown as ClienteIntentos;
    await expect(
      registrarIntentoFallido(prisma, { tipo: "login", claves: ["ip:1"], huella: { ip: null, userAgent: null }, ahora: AHORA }),
    ).resolves.toBeUndefined();
  });
});
