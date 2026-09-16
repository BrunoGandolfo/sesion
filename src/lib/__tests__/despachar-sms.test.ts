/**
 * Integración — despacharEnvios contra la base real de test
 * (DATABASE_URL_TEST). Twilio no interviene: el enviador es un doble.
 *
 * Lo que este archivo protege, en orden de importancia:
 *   - Twilio aceptó y la base falló al cerrar → NO se reenvía (desconocido).
 *   - Un timeout → desconocido, y la corrida siguiente no lo toca.
 *   - Reservar no es intentar: un corte antes de la llamada no gasta nada;
 *     un corte después la deja en desconocido.
 *   - Backoff sin tope hasta la ventana útil; dentro de las 2 h finales,
 *     fallido; turno pasado, cancelado.
 *   - Teléfono inválido y baja: definitivo en el primer intento.
 *   - Los cierres no pisan una cancelación escrita en el medio.
 *   - Deadline y concurrencia.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5433/sesion_test" \
 *   npx vitest run src/lib/__tests__/despachar-sms.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  despacharEnvios,
  MENSAJE_ENVIADO_TRAS_CANCELACION,
  MOTIVO_BAJA,
  MOTIVO_RESERVA_HUERFANA,
  MOTIVO_TURNO_PASADO,
  type DespacharParams,
} from "@/app/api/_lib/casos-uso/despachar-sms";
import { MOTIVO_TURNO_CERRADO } from "@/app/api/_lib/casos-uso/envios-del-turno";
import { textoDeCobro } from "@/app/api/_lib/casos-uso/texto-de-cobro";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { MOTIVO_VENTANA_AGOTADA } from "@/lib/sms/backoff";
import { URL_CALLBACK } from "@/lib/sms/firma";
import type { EnviadorSms, ResultadoTwilio } from "@/lib/sms/twilio";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const MIN = 60_000;
const HORA = 60 * MIN;
// 12:00 de Montevideo del 3/9/2026, en UTC explícito.
const AHORA = new Date("2026-09-03T15:00:00.000Z");
const TEMPLATE = "Hola {{nombre}}, te recordamos tu sesión el {{fecha}} a las {{hora}}.";
const TELEFONO = "+59899123456";

interface Opciones {
  fechaTurno?: Date;
  estadoTurno?: "programado" | "realizado" | "cancelado" | "ausente";
  estado?: "pendiente" | "enviando";
  intentos?: number;
  proximoIntentoEn?: Date | null;
  motivo?: "recordatorio_turno" | "cambio_de_horario" | "recordatorio_cobro";
  destino?: string;
  sinConfiguracion?: boolean;
}

/** Org con configuración, paciente, turno (mañana) y un envío cuya hora ya llegó. */
async function crearEnvio(o: Opciones = {}) {
  const fechaTurno = o.fechaTurno ?? new Date(AHORA.getTime() + 24 * HORA);
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  if (!o.sinConfiguracion) {
    await prismaRaw.configuracion.create({
      data: {
        organizationId: org.id,
        nombreProfesional: "Mariana Roldán",
        direccion: "Rivera 2540",
        whatsappOrigen: "+598 99 876 543",
        tarifaDefault: 1000,
        templateRecordatorio: TEMPLATE,
      },
    });
  }
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "Lucía", apellido: "Gómez", telefono: TELEFONO, tarifa: 1000, organizationId: org.id },
  });
  const motivo = o.motivo ?? "recordatorio_turno";
  const turno =
    motivo === "recordatorio_cobro"
      ? null
      : await prismaRaw.turno.create({
          data: { fecha: fechaTurno, estado: o.estadoTurno ?? "programado", tarifaCobrada: 1000, pacienteId: paciente.id, organizationId: org.id },
        });
  const programadoEn = new Date(AHORA.getTime() - MIN);
  const envio = await prismaRaw.envioSms.create({
    data: {
      organizationId: org.id,
      claveIdempotencia: turno ? `turno:${turno.id}:${fechaTurno.toISOString()}` : `cobro:${paciente.id}:${randomUUID()}`,
      motivo,
      estado: o.estado ?? "pendiente",
      pacienteId: paciente.id,
      turnoId: turno?.id ?? null,
      destino: o.destino ?? TELEFONO,
      programadoEn,
      proximoIntentoEn: o.proximoIntentoEn === undefined ? programadoEn : o.proximoIntentoEn,
      intentos: o.intentos ?? 0,
    },
  });
  return { envioId: envio.id, turnoId: turno?.id ?? null, orgId: org.id, pacienteId: paciente.id, fechaTurno };
}

const leer = (id: string) => prismaRaw.envioSms.findUniqueOrThrow({ where: { id } });

/** Retrasa `actualizado_en` para simular una reserva huérfana (@updatedAt: por SQL). */
async function envejecer(id: string, cuando: Date) {
  await prismaRaw.$executeRaw`UPDATE envios_sms SET actualizado_en = ${cuando} WHERE id = ${id}`;
}

const aceptaOk: EnviadorSms = async () => ({ tipo: "aceptado", sid: `SM${randomUUID().slice(0, 8)}`, segmentos: 2, estadoTwilio: "queued" });
const transitorio = (codigo: number | null = null, alerta?: "critico" | "aviso"): ResultadoTwilio => ({
  tipo: "transitorio", codigo, httpStatus: 503, mensaje: "Service Unavailable",
  clasificacion: { clase: "transitorio", referencia: "test", ...(alerta ? { alerta } : {}) },
});
const definitivo = (codigo: number, extra: Partial<ResultadoTwilio & { clasificacion: Record<string, unknown> }> = {}): ResultadoTwilio => ({
  tipo: "definitivo", codigo, httpStatus: 400, mensaje: `Twilio ${codigo}`,
  clasificacion: { clase: "definitivo", motivoNoEnvio: "el teléfono no es válido", referencia: "test", ...(extra.clasificacion ?? {}) },
});
const desconocido: ResultadoTwilio = { tipo: "desconocido", motivo: "Twilio no respondió en 10 s" };

function correr(enviar: EnviadorSms, extra: Partial<DespacharParams> = {}) {
  return despacharEnvios({ prisma: db, ahora: AHORA, enviar, aleatorio: () => 0.5, ...extra });
}

beforeAll(() => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = `1=${TEST_KEY_B64}`;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("aceptado", () => {
  it("pasa a aceptado con sid y segmentos de Twilio; el texto NO se guarda", async () => {
    const { envioId } = await crearEnvio();
    const stub = vi.fn(aceptaOk);

    const r = await correr(stub);

    expect(r).toMatchObject({ procesados: 1, aceptados: 1, fallidos: 0, desconocidos: 0, saltados: 0, hayMas: false, fallosPersistencia: [], alertas: [] });
    expect(stub).toHaveBeenCalledTimes(1);
    const pedido = stub.mock.calls[0][0];
    expect(pedido.destino).toBe(TELEFONO);
    expect(pedido.texto).toContain("Hola Lucía");
    expect(pedido.texto.split("\n")[0]).toBe("Consultorio Mariana Roldán");
    expect(pedido.texto).toContain("Cambios: llamar al +598 99 876 543");
    expect(pedido.statusCallback).toBe(URL_CALLBACK);

    const fila = await leer(envioId);
    expect(fila.estado).toBe("aceptado");
    expect(fila.sid).toMatch(/^SM/);
    expect(fila.segmentos).toBe(2);
    expect(fila.aceptadoEn?.getTime()).toBe(AHORA.getTime());
    expect(fila.intentos).toBe(1);
    expect(fila.proximoIntentoEn).toBeNull();
    expect(Object.keys(fila)).not.toContain("texto");
  });

  it("dos corridas con el mismo ahora no mandan dos veces", async () => {
    await crearEnvio();
    const stub = vi.fn(aceptaOk);
    await correr(stub);
    const segunda = await correr(stub);
    expect(segunda.procesados).toBe(0);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("cuando Twilio recibe la llamada la fila ya está reservada, con el intento contado y la marca puesta", async () => {
    const { envioId } = await crearEnvio();
    const vistas: Array<{ estado: string; intentos: number; proximo: Date | null }> = [];
    await correr(async () => {
      const f = await leer(envioId);
      vistas.push({ estado: f.estado, intentos: f.intentos, proximo: f.proximoIntentoEn });
      return aceptaOk({ destino: "", texto: "", statusCallback: "" });
    });
    expect(vistas).toEqual([{ estado: "enviando", intentos: 1, proximo: null }]);
  });

  it("un envío programado para más adelante no se toca", async () => {
    const { envioId } = await crearEnvio({ proximoIntentoEn: new Date(AHORA.getTime() + MIN) });
    const stub = vi.fn(aceptaOk);
    const r = await correr(stub);
    expect(r.procesados).toBe(0);
    expect(stub).not.toHaveBeenCalled();
    expect((await leer(envioId)).estado).toBe("pendiente");
  });
});

describe("Twilio aceptó pero la base falló al cerrar (U4 / E.15)", () => {
  it("queda en enviando con la marca; el rescate lo pasa a desconocido y NUNCA lo reenvía", async () => {
    const { envioId } = await crearEnvio();
    const stub = vi.fn(aceptaOk);

    // Un cliente que falla exactamente en el cierre feliz.
    const conFalloAlCerrar = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "envioSms") return Reflect.get(target, prop, receiver);
        const delegado = target.envioSms;
        return new Proxy(delegado, {
          get(t, p, r) {
            if (p !== "updateMany") return Reflect.get(t, p, r);
            return (args: { data?: { estado?: string } }) => {
              if (args.data?.estado === "aceptado") throw new Error("connection lost");
              return t.updateMany(args as never);
            };
          },
        });
      },
    }) as typeof db;

    const primera = await despacharEnvios({ prisma: conFalloAlCerrar, ahora: AHORA, enviar: stub });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(primera.fallosPersistencia).toHaveLength(1);
    let fila = await leer(envioId);
    expect(fila.estado).toBe("enviando");
    expect(fila.proximoIntentoEn).toBeNull();
    expect(fila.intentos).toBe(1);

    // Cinco minutos después, otra corrida rescata la reserva huérfana.
    await envejecer(envioId, new Date(AHORA.getTime() - 10 * MIN));
    const segunda = await correr(stub);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(segunda).toMatchObject({ rescatados: 1, desconocidos: 1, aceptados: 0 });
    fila = await leer(envioId);
    expect(fila.estado).toBe("desconocido");
    expect(fila.motivoNoEnvio).toBe(MOTIVO_RESERVA_HUERFANA);

    // Y ninguna corrida posterior lo levanta.
    const tercera = await correr(stub);
    expect(tercera.procesados).toBe(0);
    expect(stub).toHaveBeenCalledTimes(1);
  });
});

describe("desconocido", () => {
  it("un timeout deja desconocido, y la corrida siguiente no lo toca", async () => {
    const { envioId } = await crearEnvio();
    const stub = vi.fn(async () => desconocido);
    const r = await correr(stub);
    expect(r.desconocidos).toBe(1);
    const fila = await leer(envioId);
    expect(fila.estado).toBe("desconocido");
    expect(fila.motivoNoEnvio).toContain("no respondió");
    expect(fila.intentos).toBe(1);

    const segunda = await correr(stub);
    expect(segunda.procesados).toBe(0);
    expect(stub).toHaveBeenCalledTimes(1);
  });
});

describe("transitorio: backoff hasta la ventana útil", () => {
  it("vuelve a pendiente con proximoIntentoEn dos minutos después, sin tope de intentos", async () => {
    const { envioId } = await crearEnvio({ intentos: 7 });
    const r = await correr(async () => transitorio());
    expect(r.reintentos).toBe(1);
    const fila = await leer(envioId);
    expect(fila.estado).toBe("pendiente");
    expect(fila.intentos).toBe(8);
    // 2 min · 2^7 = 256 min, acotado a 30. Sin jitter (aleatorio 0.5).
    expect(fila.proximoIntentoEn?.getTime()).toBe(AHORA.getTime() + 30 * MIN);
  });

  it("guarda el código del proveedor del fallo transitorio", async () => {
    const { envioId } = await crearEnvio();
    await correr(async () => transitorio(30001));
    expect((await leer(envioId)).codigoProveedor).toBe("30001");
  });

  it("dentro de las 2 h finales: fallido con el motivo", async () => {
    const { envioId } = await crearEnvio({ fechaTurno: new Date(AHORA.getTime() + 90 * MIN) });
    const r = await correr(async () => transitorio());
    expect(r.fallidos).toBe(1);
    const fila = await leer(envioId);
    expect(fila.estado).toBe("fallido");
    expect(fila.motivoNoEnvio).toBe(MOTIVO_VENTANA_AGOTADA);
    expect(fila.cerradoEn?.getTime()).toBe(AHORA.getTime());
  });

  it("Twilio caído quince minutos ya no es fatal: tres corridas y sigue pendiente", async () => {
    const { envioId } = await crearEnvio();
    const caido = vi.fn(async () => transitorio());
    for (let i = 0; i < 3; i += 1) {
      const fila = await leer(envioId);
      await correr(caido, { ahora: fila.proximoIntentoEn ?? AHORA });
    }
    const fila = await leer(envioId);
    expect(fila.estado).toBe("pendiente");
    expect(fila.intentos).toBe(3);
    expect(caido).toHaveBeenCalledTimes(3);
  });

  it("una cuenta suspendida (30002) vuelve como alerta crítica", async () => {
    await crearEnvio();
    const r = await correr(async () => transitorio(30002, "critico"));
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].nivel).toBe("critico");
  });
});

describe("definitivo", () => {
  it("teléfono inválido (21211): fallido en el PRIMER intento, con el motivo en castellano", async () => {
    const { envioId } = await crearEnvio();
    const stub = vi.fn(async () => definitivo(21211));
    const r = await correr(stub);
    expect(r.fallidos).toBe(1);
    const fila = await leer(envioId);
    expect(fila.estado).toBe("fallido");
    expect(fila.intentos).toBe(1);
    expect(fila.codigoProveedor).toBe("21211");
    expect(fila.motivoNoEnvio).toBe("el teléfono no es válido");
    const segunda = await correr(stub);
    expect(segunda.procesados).toBe(0);
  });

  it("21610: fallido, crea la baja y apaga lo demás pendiente a ese teléfono", async () => {
    const { envioId } = await crearEnvio();
    const { envioId: otro } = await crearEnvio({ proximoIntentoEn: new Date(AHORA.getTime() + HORA) });
    await correr(async () => definitivo(21610, { clasificacion: { baja: "twilio_21610", motivoNoEnvio: "la paciente pidió no recibir más mensajes" } }));

    expect((await leer(envioId)).estado).toBe("fallido");
    expect(await prismaRaw.bajaSms.findUnique({ where: { telefono: TELEFONO } })).toMatchObject({ motivo: "twilio_21610" });
    const otraFila = await leer(otro);
    expect(otraFila.estado).toBe("cancelado");
    expect(otraFila.motivoNoEnvio).toBe(MOTIVO_BAJA);
  });
});

describe("antes de llamar a Twilio", () => {
  it("un teléfono dado de baja se cancela sin tocar Twilio", async () => {
    const { envioId } = await crearEnvio();
    await prismaRaw.bajaSms.create({ data: { telefono: TELEFONO, motivo: "respuesta_baja" } });
    const stub = vi.fn(aceptaOk);
    const r = await correr(stub);
    expect(stub).not.toHaveBeenCalled();
    expect(r.cancelados).toBe(1);
    const fila = await leer(envioId);
    expect(fila.estado).toBe("cancelado");
    expect(fila.motivoNoEnvio).toBe(MOTIVO_BAJA);
    expect(fila.intentos).toBe(0);
  });

  it("un turno que ya pasó se cancela, nunca falla", async () => {
    const { envioId } = await crearEnvio({ fechaTurno: new Date(AHORA.getTime() - HORA) });
    const stub = vi.fn(aceptaOk);
    await correr(stub);
    expect(stub).not.toHaveBeenCalled();
    expect(await leer(envioId)).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_TURNO_PASADO });
  });

  it("un turno cerrado (cancelado, realizado, ausente) se cancela sin enviar", async () => {
    for (const estadoTurno of ["cancelado", "realizado", "ausente"] as const) {
      const { envioId } = await crearEnvio({ estadoTurno });
      const stub = vi.fn(aceptaOk);
      await correr(stub);
      expect(stub).not.toHaveBeenCalled();
      expect(await leer(envioId)).toMatchObject({ estado: "cancelado", motivoNoEnvio: MOTIVO_TURNO_CERRADO });
    }
  });

  it("un error nuestro antes de la llamada (sin configuración) NO gasta el intento y reintenta", async () => {
    const { envioId } = await crearEnvio({ sinConfiguracion: true });
    const stub = vi.fn(aceptaOk);
    const r = await correr(stub);
    expect(stub).not.toHaveBeenCalled();
    expect(r.reintentos).toBe(1);
    const fila = await leer(envioId);
    expect(fila.estado).toBe("pendiente");
    expect(fila.intentos).toBe(0);
    expect(fila.motivoNoEnvio).toContain("sin configuración");
    expect(fila.proximoIntentoEn?.getTime()).toBe(AHORA.getTime() + 2 * MIN);
  });
});

describe("reservar no es intentar", () => {
  it("una reserva huérfana ANTES de la llamada (marca puesta) se rescata y envía sin gastar nada", async () => {
    const { envioId } = await crearEnvio({ estado: "enviando" });
    await envejecer(envioId, new Date(AHORA.getTime() - 10 * MIN));
    const stub = vi.fn(aceptaOk);
    const r = await correr(stub);
    expect(r).toMatchObject({ rescatados: 1, aceptados: 1 });
    expect(stub).toHaveBeenCalledTimes(1);
    const fila = await leer(envioId);
    expect(fila.estado).toBe("aceptado");
    expect(fila.intentos).toBe(1);
  });

  it("una reserva huérfana DESPUÉS de la llamada (marca en null) pasa a desconocido sin llamar", async () => {
    const { envioId } = await crearEnvio({ estado: "enviando", intentos: 1, proximoIntentoEn: null });
    await envejecer(envioId, new Date(AHORA.getTime() - 10 * MIN));
    const stub = vi.fn(aceptaOk);
    const r = await correr(stub);
    expect(stub).not.toHaveBeenCalled();
    expect(r).toMatchObject({ rescatados: 1, desconocidos: 1 });
    expect(await leer(envioId)).toMatchObject({ estado: "desconocido", intentos: 1, motivoNoEnvio: MOTIVO_RESERVA_HUERFANA });
  });

  it("una reserva reciente no se toca: la otra corrida sigue viva", async () => {
    const { envioId } = await crearEnvio({ estado: "enviando" });
    await envejecer(envioId, new Date(AHORA.getTime() - 30_000));
    const stub = vi.fn(aceptaOk);
    const r = await correr(stub);
    expect(r.procesados).toBe(0);
    expect(stub).not.toHaveBeenCalled();
    expect((await leer(envioId)).estado).toBe("enviando");
  });
});

describe("cancelación del turno durante el envío", () => {
  async function cancelarDesdeAfuera(id: string) {
    await prismaRaw.envioSms.updateMany({
      where: { id, estado: { in: ["pendiente", "enviando"] } },
      data: { estado: "cancelado", motivoNoEnvio: MOTIVO_TURNO_CERRADO, cerradoEn: AHORA },
    });
  }

  it("si el SMS salió, la fila queda cancelada pero guarda la evidencia y avisa", async () => {
    const { envioId } = await crearEnvio();
    const r = await correr(async () => {
      await cancelarDesdeAfuera(envioId);
      return aceptaOk({ destino: "", texto: "", statusCallback: "" });
    });
    expect(r.aceptados).toBe(1);
    expect(r.aceptadosTrasCancelacion).toBe(1);
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].titulo).toContain("hay que avisarle");
    const fila = await leer(envioId);
    expect(fila.estado).toBe("cancelado");
    expect(fila.sid).toMatch(/^SM/);
    expect(fila.aceptadoEn?.getTime()).toBe(AHORA.getTime());
    expect(fila.motivoNoEnvio).toBe(MENSAJE_ENVIADO_TRAS_CANCELACION);
  });

  it("si el envío falló, el envío NO revive, y una corrida posterior no lo levanta", async () => {
    const { envioId } = await crearEnvio();
    await correr(async () => {
      await cancelarDesdeAfuera(envioId);
      return transitorio();
    });
    expect((await leer(envioId)).estado).toBe("cancelado");
    const stub = vi.fn(aceptaOk);
    const segunda = await correr(stub);
    expect(segunda.procesados).toBe(0);
    expect(stub).not.toHaveBeenCalled();
  });
});

describe("presupuesto de la corrida", () => {
  it("el deadline corta la corrida y deja hayMas", async () => {
    await crearEnvio();
    await crearEnvio();
    await crearEnvio();
    let tick = 0;
    const reloj = () => (tick += 20_000); // cada lectura del reloj avanza 20 s
    const stub = vi.fn(aceptaOk);
    const r = await correr(stub, { deadlineMs: 45_000, concurrencia: 1, reloj });
    expect(r.hayMas).toBe(true);
    expect(stub.mock.calls.length).toBeLessThan(3);
    // Lo que quedó lo levanta la corrida siguiente.
    const segunda = await correr(stub);
    expect(stub).toHaveBeenCalledTimes(3);
    expect(segunda.hayMas).toBe(false);
  });

  it("con concurrencia procesa todos, cada uno una sola vez", async () => {
    const ids = await Promise.all(Array.from({ length: 7 }, () => crearEnvio()));
    const stub = vi.fn(aceptaOk);
    const r = await correr(stub, { concurrencia: 3 });
    expect(r.procesados).toBe(7);
    expect(r.aceptados).toBe(7);
    expect(stub).toHaveBeenCalledTimes(7);
    for (const { envioId } of ids) expect((await leer(envioId)).estado).toBe("aceptado");
  });

  it("el lote lleno deja hayMas", async () => {
    await crearEnvio();
    await crearEnvio();
    const r = await correr(aceptaOk, { lote: 1 });
    expect(r.procesados).toBe(1);
    expect(r.hayMas).toBe(true);
  });
});

describe("aviso de cobro", () => {
  it("envía el texto real con la suma de la deuda vigente", async () => {
    const { envioId, orgId, pacienteId } = await crearEnvio({ motivo: "recordatorio_cobro" });
    await prismaRaw.turno.createMany({
      data: [1200, 2300].map(tarifaCobrada => ({
        organizationId: orgId, pacienteId, tarifaCobrada,
        fecha: new Date("2026-08-01T15:00:00Z"), estado: "realizado", pagoEstado: "pendiente",
      })),
    });
    const stub = vi.fn(aceptaOk);
    await correr(stub, { textoDeCobro: parametros => textoDeCobro(db, parametros) });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(stub.mock.calls[0][0].texto).toBe("Consultorio Mariana Roldán\nLucía, tenés 2 sesiones pendientes de pago: $ 3.500.");
    expect((await leer(envioId)).estado).toBe("aceptado");
  });

  it("sin deuda vigente el módulo real cancela el aviso sin llamar", async () => {
    const { envioId } = await crearEnvio({ motivo: "recordatorio_cobro" });
    const stub = vi.fn(aceptaOk);
    await correr(stub, { textoDeCobro: parametros => textoDeCobro(db, parametros) });
    expect(stub).not.toHaveBeenCalled();
    expect((await leer(envioId)).estado).toBe("cancelado");
  });
});
