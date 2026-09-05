// Unitario — el contador de intentos fallidos del cambio de contraseña.
//
// Sin base: el módulo recibe el cliente Prisma como parámetro, así que acá
// entra un doble que devuelve las filas que se quieran. Lo que se prueba es
// que la política aplicada sea LA MISMA que la del login (no una copia con
// otros números) y que la consulta filtre por lo que tiene que filtrar.

import { describe, expect, it } from "vitest";

import { UMBRAL_INTENTOS, VENTANA_MIN } from "@/lib/login-intentos";
import {
  ACCION_PASSWORD_FALLIDO,
  ENTIDAD_CUENTA,
  evaluarCambioPassword,
  type EvaluarCambioPasswordParams,
} from "@/lib/password-eventos";

const AHORA = new Date("2026-09-05T12:00:00.000Z");
const USER_ID = "usr_1";
const MS_POR_MINUTO = 60_000;

type Consulta = { where: Record<string, unknown> };

/** Doble del cliente: devuelve las fechas dadas y guarda el where recibido. */
function prismaFalso(fechas: Date[], consultas: Consulta[] = []) {
  return {
    prisma: {
      eventoAuditoria: {
        findMany: async (args: Consulta) => {
          consultas.push(args);
          return fechas.map((createdAt) => ({ createdAt }));
        },
      },
    } as unknown as EvaluarCambioPasswordParams["prisma"],
    consultas,
  };
}

/** `cuantos` fallos, uno por minuto, terminando hace un minuto. */
function fallosRecientes(cuantos: number): Date[] {
  return Array.from(
    { length: cuantos },
    (_, i) => new Date(AHORA.getTime() - (cuantos - i) * MS_POR_MINUTO),
  );
}

function correr(fechas: Date[], consultas: Consulta[] = []) {
  const { prisma } = prismaFalso(fechas, consultas);
  return evaluarCambioPassword({ prisma, userId: USER_ID, ahora: AHORA });
}

describe("evaluarCambioPassword", () => {
  it("sin fallos previos deja pasar", async () => {
    const estado = await correr([]);

    expect(estado.bloqueado).toBe(false);
    expect(estado.fallos).toBe(0);
  });

  it("con un fallo menos que el umbral todavía deja pasar", async () => {
    const estado = await correr(fallosRecientes(UMBRAL_INTENTOS - 1));

    expect(estado.bloqueado).toBe(false);
  });

  it("al llegar al umbral del login bloquea, con el mismo umbral", async () => {
    const estado = await correr(fallosRecientes(UMBRAL_INTENTOS));

    expect(estado.bloqueado).toBe(true);
    expect(estado.nivel).toBe(1);
    expect(estado.fallos).toBe(UMBRAL_INTENTOS);
  });

  it("los mismos fallos repartidos fuera de la ventana no bloquean", async () => {
    // Uno por hora: cinco errores a lo largo del día no son un ataque. Es la
    // misma regla del login, y se comprueba acá para que nadie la duplique
    // con otros números.
    const fechas = Array.from(
      { length: UMBRAL_INTENTOS },
      (_, i) =>
        new Date(AHORA.getTime() - (i + 1) * (VENTANA_MIN + 5) * MS_POR_MINUTO),
    );

    const estado = await correr(fechas);

    expect(estado.bloqueado).toBe(false);
    expect(estado.fallos).toBe(UMBRAL_INTENTOS);
  });

  it("cuenta por userId, por la acción propia y dentro de la memoria", async () => {
    const consultas: Consulta[] = [];
    await correr([], consultas);

    expect(consultas).toHaveLength(1);
    expect(consultas[0].where).toMatchObject({
      entidad: ENTIDAD_CUENTA,
      entidadId: USER_ID,
      accion: ACCION_PASSWORD_FALLIDO,
    });
    // Sin `createdAt` la tabla append-only haría crecer la cuenta para
    // siempre y un error de hace un mes seguiría pesando.
    expect(consultas[0].where.createdAt).toBeDefined();
  });

  it("si la consulta falla deja pasar en vez de dejar afuera a la dueña", async () => {
    const prisma = {
      eventoAuditoria: {
        findMany: async () => {
          throw new Error("la base tosió");
        },
      },
    } as unknown as EvaluarCambioPasswordParams["prisma"];

    const estado = await evaluarCambioPassword({
      prisma,
      userId: USER_ID,
      ahora: AHORA,
    });

    expect(estado.bloqueado).toBe(false);
  });
});
