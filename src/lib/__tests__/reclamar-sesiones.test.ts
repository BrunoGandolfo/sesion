/**
 * Integración — el reclamo del worker: claim atómico con intento monotónico,
 * ticket, lease corto, checkpoint (nunca se vuelve a pagar el ASR), agotar.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reclamarSesiones } from "@/app/api/_lib/casos-uso/sesion/reclamar";
import { hashDeTicket } from "@/app/api/_lib/tickets";
import { LEASE_SESION_MS, MAX_FALLOS_SEGUIDOS } from "@/lib/sesion-clinica/estados";

import {
  CLAVE_AUDIO,
  conectarArea2,
  crearOrg,
  crearSesion,
  filaDe,
  limpiarOrg,
  TRANSCRIPCION,
  type BaseArea2,
  type Org,
} from "./estados-fixtures";

let base!: BaseArea2;
let org!: Org;
const AHORA = new Date("2026-09-14T12:00:00Z");
const terminos = async () => ["GTFS", "MITI"];

beforeAll(async () => {
  base = conectarArea2();
  org = await crearOrg(base.prisma, "gestalt");
});

afterAll(async () => {
  await limpiarOrg(base.prisma, org.orgId);
  await base.prisma.$disconnect();
});

function reclamar(ahora = AHORA, extra: Partial<Parameters<typeof reclamarSesiones>[0]> = {}) {
  return reclamarSesiones({ prisma: base.db, ahora, limite: 10, terminosAsr: terminos, ...extra });
}

describe("reclamar sesiones", () => {
  it("dos reclamos simultáneos entregan la sesión una sola vez, con intento 1 y ticket", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "procesando" });
    const [a, b] = await Promise.all([reclamar(), reclamar()]);
    const entregas = [...a, ...b].filter((s) => s.sesionClinicaId === sesionId);
    expect(entregas).toHaveLength(1);
    const [s] = entregas;
    expect(s.intento).toBe(1);
    expect(s.ticket).toMatch(/^[0-9a-f]{64}$/);

    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.intento).toBe(1);
    expect(fila?.ticketHash).toBe(hashDeTicket(s.ticket));
    expect(fila?.leaseVenceEn?.getTime()).toBe(AHORA.getTime() + LEASE_SESION_MS);
    expect(fila?.estado).toBe("procesando");
  });

  it("entrega la clave descifrada, el IV y la key calculada del archivo; ningún payload trae una key persistida", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "procesando" });
    const [s] = (await reclamar()).filter((x) => x.sesionClinicaId === sesionId);
    expect(s.audio?.clave).toBe(CLAVE_AUDIO);
    expect(s.audio?.key).toBe(`${org.orgId}/${sesionId}/0`);
    expect(s.audio?.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(s.audio!.iv, "base64")).toHaveLength(12);
    expect(s.checkpoint).toBeNull();
    expect(s.pacienteId).toBe(org.pacienteId);
    expect(s.orientacionTeorica).toBe("gestalt");
    expect(s.terminosAsr).toEqual(["GTFS", "MITI"]);
    expect(s.duracionAudioSeg).toBe(120);
  });

  it("con lease vigente no se vuelve a entregar; vencido, sale con intento 2 y ticket nuevo", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "procesando" });
    const [primera] = (await reclamar()).filter((x) => x.sesionClinicaId === sesionId);
    expect((await reclamar(new Date(AHORA.getTime() + 60_000))).some((x) => x.sesionClinicaId === sesionId)).toBe(false);

    const despues = new Date(AHORA.getTime() + LEASE_SESION_MS + 1);
    const [segunda] = (await reclamar(despues)).filter((x) => x.sesionClinicaId === sesionId);
    expect(segunda.intento).toBe(2);
    expect(segunda.ticket).not.toBe(primera.ticket);
    expect((await filaDe(base.prisma, sesionId))?.ticketHash).toBe(hashDeTicket(segunda.ticket));
  });

  it("con transcripción guardada entrega el checkpoint y no el audio: ningún reintento vuelve a transcribir", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, {
      estado: "procesando",
      transcripcion: TRANSCRIPCION,
    });
    await base.prisma.sesionClinica.update({
      where: { id: sesionId },
      data: { speechAnalytics: { ratioHablaTerapeuta: 0.4 } },
    });
    const [s] = (await reclamar()).filter((x) => x.sesionClinicaId === sesionId);
    expect(s.audio).toBeNull();
    expect(s.checkpoint).toEqual({
      transcripcion: TRANSCRIPCION,
      speechAnalytics: { ratioHablaTerapeuta: 0.4 },
      modeloAsr: "assemblyai:universal-2",
    });
  });

  it("con el próximo intento en el futuro no se entrega", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, {
      estado: "procesando",
      proximoIntentoEn: new Date(AHORA.getTime() + 5 * 60_000),
    });
    expect((await reclamar()).some((x) => x.sesionClinicaId === sesionId)).toBe(false);
    expect((await reclamar(new Date(AHORA.getTime() + 6 * 60_000))).some((x) => x.sesionClinicaId === sesionId)).toBe(true);
  });

  it("con fallos seguidos al máximo pasa a fallida (intentos_agotados) y no se entrega", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, {
      estado: "procesando",
      fallosSeguidos: MAX_FALLOS_SEGUIDOS,
      intento: 7,
    });
    expect((await reclamar()).some((x) => x.sesionClinicaId === sesionId)).toBe(false);
    const fila = await filaDe(base.prisma, sesionId);
    expect(fila?.estado).toBe("fallida");
    expect(fila?.falloCodigo).toBe("intentos_agotados");
    expect(fila?.intento).toBe(7);
    expect(fila?.ticketHash).toBeNull();
  });

  it("si el vocabulario falla, la sesión se entrega igual sin términos", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "procesando" });
    const [s] = (
      await reclamar(AHORA, {
        terminosAsr: async () => {
          throw new Error("hot words rotas");
        },
      })
    ).filter((x) => x.sesionClinicaId === sesionId);
    expect(s.terminosAsr).toEqual([]);
    expect(s.intento).toBe(1);
  });

  it("si el worker anterior renueva el lease entre la lectura y el claim, no se le roba la sesión", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "procesando", intento: 3 });
    // Cliente que, apenas el findMany devuelve las candidatas, renueva el
    // lease de esta sesión (mismo intento, como hace renovar_lease).
    const conRenovacion = new Proxy(base.db, {
      get(objetivo, prop, receptor) {
        if (prop !== "sesionClinica") return Reflect.get(objetivo, prop, receptor);
        return new Proxy(objetivo.sesionClinica, {
          get(modelo, p, r) {
            if (p !== "findMany") return Reflect.get(modelo, p, r);
            return async (...args: unknown[]) => {
              const filas = await (modelo.findMany as (...a: unknown[]) => Promise<unknown[]>)(...args);
              await base.prisma.sesionClinica.update({
                where: { id: sesionId },
                data: { leaseVenceEn: new Date(AHORA.getTime() + LEASE_SESION_MS) },
              });
              return filas;
            };
          },
        });
      },
    }) as typeof base.db;

    const entregadas = await reclamarSesiones({ prisma: conRenovacion, ahora: AHORA, limite: 10, terminosAsr: terminos });
    expect(entregadas.some((x) => x.sesionClinicaId === sesionId)).toBe(false);
    expect((await filaDe(base.prisma, sesionId))?.intento).toBe(3);
  });

  it("si llega un fallo transitorio entre la lectura y el claim, se respeta el backoff nuevo", async () => {
    const { sesionId } = await crearSesion(base.prisma, org, { estado: "procesando", intento: 3 });
    const conFallo = new Proxy(base.db, {
      get(objetivo, prop, receptor) {
        if (prop !== "sesionClinica") return Reflect.get(objetivo, prop, receptor);
        return new Proxy(objetivo.sesionClinica, {
          get(modelo, p, r) {
            if (p !== "findMany") return Reflect.get(modelo, p, r);
            return async (...args: unknown[]) => {
              const filas = await (modelo.findMany as (...a: unknown[]) => Promise<unknown[]>)(...args);
              await base.prisma.sesionClinica.update({
                where: { id: sesionId },
                data: { fallosSeguidos: 1, proximoIntentoEn: new Date(AHORA.getTime() + 60_000) },
              });
              return filas;
            };
          },
        });
      },
    }) as typeof base.db;

    const entregadas = await reclamarSesiones({ prisma: conFallo, ahora: AHORA, limite: 10, terminosAsr: terminos });
    expect(entregadas.some((x) => x.sesionClinicaId === sesionId)).toBe(false);
    expect((await filaDe(base.prisma, sesionId))?.intento).toBe(3);
  });

  it("no entrega sesiones que no están en procesando", async () => {
    const ids = await Promise.all(
      (["grabando", "subiendo", "revision", "aprobada", "fallida"] as const).map((estado) =>
        crearSesion(base.prisma, org, { estado }),
      ),
    );
    const entregadas = new Set((await reclamar()).map((x) => x.sesionClinicaId));
    for (const { sesionId } of ids) expect(entregadas.has(sesionId)).toBe(false);
  });
});
