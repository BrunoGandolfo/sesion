// Integración — la memoria de Lux contra Postgres: la tabla
// conversaciones_lux, lo que se guarda (cifrado de verdad), lo que se carga
// (los últimos N, en orden), el borrado en cascada con la paciente y el
// aislamiento entre organizaciones y entre pacientes.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { actualizarPaciente } from "@/app/api/_lib/casos-uso/pacientes";
import { abrirConversacion, PEDIDO_APERTURA, pedidoApertura } from "@/app/api/_lib/casos-uso/lux/conversar";
import {
  borrarConversacion, cargarConversacion, guardarTurnos, type ClienteMemoriaLux,
} from "@/app/api/_lib/casos-uso/lux/memoria";
import { ACCIONES } from "@/lib/auditoria-acciones";
import type { crearConversacionConHerramientas, ResultadoConversacion } from "@/lib/anthropic-mensajes";
import { aadDe, descifrar } from "@/lib/encryption";
import { avisoMirandoTranscripcion, MAX_TURNOS_HISTORIAL_LUX } from "@/lib/lux/contrato";

import { conectarArea2, crearOrg, eventosAuditoriaDe, type BaseArea2, type Org } from "./estados-fixtures";
import { vaciarTablas } from "./db-test";

let base: BaseArea2;
const db = () => base.db as unknown as ClienteMemoriaLux;

/** crearOrg no crea la usuaria (su userId es inventado): la tabla la exige. */
async function consultorio(): Promise<Org> {
  const org = await crearOrg(base.prisma);
  const user = await base.prisma.user.create({
    data: { email: `${randomUUID()}@test.uy`, hashedPassword: "x", nombre: "Mariana", organizationId: org.orgId },
  });
  return { ...org, userId: user.id };
}

async function otraPaciente(org: Org): Promise<string> {
  const p = await base.prisma.paciente.create({
    data: { nombre: "Beto", apellido: "Gómez", telefono: "+59899000001", tarifa: 1000, organizationId: org.orgId },
  });
  return p.id;
}

const RESULTADO: ResultadoConversacion = {
  texto: "Hola.", tokensEntrada: 1, tokensSalida: 1, cacheLeido: 0, cacheEscrito: 0, motivoDeCorte: "end_turn", rondas: 1, llamadas: [],
};

const identidad = (org: Org, pacienteId = org.pacienteId) => ({ organizationId: org.orgId, pacienteId });

/** Un intercambio: pregunta y respuesta, la respuesta un minuto después. */
function intercambio(org: Org, n: number, pacienteId = org.pacienteId, interrumpida = false) {
  const en = new Date(Date.UTC(2026, 9, 1 + n, 14));
  return guardarTurnos(db(), {
    ...identidad(org, pacienteId), userId: org.userId,
    pregunta: { texto: `PREGUNTA_${n}`, en },
    respuesta: { texto: `RESPUESTA_${n}`, en: new Date(en.getTime() + 60_000), interrumpida },
  });
}

beforeAll(async () => { base = conectarArea2(); });
beforeEach(async () => { await vaciarTablas(base.prisma); });
afterAll(async () => {
  await vaciarTablas(base.prisma);
  await base.prisma.$disconnect();
});

describe("guardar y cargar", () => {
  it("guarda pregunta y respuesta y las carga en orden, con su fecha y su rol", async () => {
    const org = await consultorio();
    await intercambio(org, 0);
    await intercambio(org, 1, org.pacienteId, true);
    const turnos = await cargarConversacion(db(), identidad(org));
    expect(turnos.map((t) => [t.rol, t.texto, t.interrumpida])).toEqual([
      ["profesional", "PREGUNTA_0", false],
      ["lux", "RESPUESTA_0", false],
      ["profesional", "PREGUNTA_1", false],
      ["lux", "RESPUESTA_1", true],
    ]);
    expect(turnos[0].creadoEn).toEqual(new Date(Date.UTC(2026, 9, 1, 14)));
  });

  it("si no llegó nada de Lux, no se guarda nada (ni la pregunta)", async () => {
    const org = await consultorio();
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId,
      pregunta: { texto: "¿Y?", en: new Date() },
      respuesta: { texto: "  ", en: new Date(), interrumpida: true },
    });
    expect(await base.prisma.conversacionLux.count()).toBe(0);
  });

  it("una apertura es sólo el turno de Lux", async () => {
    const org = await consultorio();
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId,
      respuesta: { texto: "APERTURA", en: new Date(), interrumpida: false },
    });
    expect((await cargarConversacion(db(), identidad(org))).map((t) => t.rol)).toEqual(["lux"]);
  });

  it(`carga los últimos ${MAX_TURNOS_HISTORIAL_LUX}, del más viejo al más nuevo`, async () => {
    const org = await consultorio();
    for (let n = 0; n < MAX_TURNOS_HISTORIAL_LUX; n++) await intercambio(org, n);
    const turnos = await cargarConversacion(db(), identidad(org));
    expect(turnos).toHaveLength(MAX_TURNOS_HISTORIAL_LUX);
    const desde = MAX_TURNOS_HISTORIAL_LUX / 2;
    expect(turnos[0].texto).toBe(`PREGUNTA_${desde}`);
    expect(turnos.at(-1)!.texto).toBe(`RESPUESTA_${MAX_TURNOS_HISTORIAL_LUX - 1}`);
  });

  it("la línea de estado vuelve con la marca del servidor; la que trae la pregunta, sin marca", async () => {
    const org = await consultorio();
    const conAviso = `Voy a mirar.\n${avisoMirandoTranscripcion("04/08")}\nDijo eso.`;
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId,
      pregunta: { texto: avisoMirandoTranscripcion("01/08"), en: new Date(Date.UTC(2026, 9, 1)) },
      respuesta: { texto: conAviso, en: new Date(Date.UTC(2026, 9, 2)), interrumpida: false },
    });
    const [pregunta, respuesta] = await cargarConversacion(db(), identidad(org));
    expect(pregunta.texto).toBe("_(mirando la transcripción del 01/08)_");
    expect(respuesta.texto).toBe(conAviso);
  });
});

describe("cifrado", () => {
  it("en la base no hay texto en claro: el blob es ENC2 y descifra sólo con el AAD de su fila", async () => {
    const org = await consultorio();
    await intercambio(org, 0);
    const filas = await base.prisma.$queryRaw<{ id: string; contenido_encrypted: Buffer }[]>`
      SELECT id, contenido_encrypted FROM conversaciones_lux ORDER BY creado_en`;
    expect(filas).toHaveLength(2);
    for (const fila of filas) {
      expect(fila.contenido_encrypted.subarray(0, 4).toString()).toBe("ENC2");
      expect(fila.contenido_encrypted.toString("latin1")).not.toMatch(/PREGUNTA_0|RESPUESTA_0/);
    }
    expect(descifrar(filas[0].contenido_encrypted, aadDe("conversaciones_lux", "contenido_encrypted", filas[0].id))).toBe("PREGUNTA_0");
    expect(() => descifrar(filas[0].contenido_encrypted, aadDe("conversaciones_lux", "contenido_encrypted", filas[1].id))).toThrow();
  });
});

describe("aislamiento", () => {
  it("otra organización con el id de la paciente no carga nada", async () => {
    const a = await consultorio();
    const b = await consultorio();
    await intercambio(a, 0);
    expect(await cargarConversacion(db(), { organizationId: b.orgId, pacienteId: a.pacienteId })).toEqual([]);
  });

  it("cada paciente tiene su conversación", async () => {
    const org = await consultorio();
    const beto = await otraPaciente(org);
    await intercambio(org, 0);
    await intercambio(org, 1, beto);
    expect((await cargarConversacion(db(), identidad(org))).map((t) => t.texto)).toEqual(["PREGUNTA_0", "RESPUESTA_0"]);
    expect((await cargarConversacion(db(), identidad(org, beto))).map((t) => t.texto)).toEqual(["PREGUNTA_1", "RESPUESTA_1"]);
  });

  it("no se guarda la conversación de una paciente de otra organización", async () => {
    const a = await consultorio();
    const b = await consultorio();
    await expect(guardarTurnos(db(), {
      organizationId: b.orgId, pacienteId: a.pacienteId, userId: b.userId,
      respuesta: { texto: "INTRUSA", en: new Date(), interrumpida: false },
    })).rejects.toThrow();
    expect(await base.prisma.conversacionLux.count()).toBe(0);
  });
});

describe("la vida de la paciente", () => {
  it("al archivarla, su conversación se conserva", async () => {
    const org = await consultorio();
    await intercambio(org, 0);
    await actualizarPaciente({
      prisma: base.db as never, organizationId: org.orgId, pacienteId: org.pacienteId,
      cambios: { activo: false }, usuarioId: org.userId,
    });
    expect((await base.prisma.paciente.findUnique({ where: { id: org.pacienteId } }))?.activo).toBe(false);
    expect((await cargarConversacion(db(), identidad(org))).map((t) => t.texto)).toEqual(["PREGUNTA_0", "RESPUESTA_0"]);
  });

  it("al eliminarla, su conversación se borra en cascada; la de otra queda", async () => {
    const org = await consultorio();
    const beto = await otraPaciente(org);
    await intercambio(org, 0, beto);
    await intercambio(org, 1);
    await base.prisma.paciente.delete({ where: { id: beto } });
    expect(await base.prisma.conversacionLux.count({ where: { pacienteId: beto } })).toBe(0);
    expect(await base.prisma.conversacionLux.count({ where: { pacienteId: org.pacienteId } })).toBe(2);
  });
});

describe("al abrir, lo guardado viaja al modelo", () => {
  function doble() {
    const pedidos: Parameters<typeof crearConversacionConHerramientas>[0][] = [];
    const crearConversacion: typeof crearConversacionConHerramientas = async (pedido) => {
      pedidos.push(pedido);
      return { fragmentos: (async function* () { yield "Hola."; })(), resultado: Promise.resolve(RESULTADO), cancelar: () => {}, progreso: () => RESULTADO };
    };
    return { pedidos, crearConversacion };
  }
  const abrir = (org: Org, crearConversacion: typeof crearConversacionConHerramientas) => abrirConversacion({
    prisma: db(), organizationId: org.orgId, usuarioId: org.userId, pacienteId: org.pacienteId,
    apiKey: "k", systemPrompt: "p", crearConversacion,
  });

  it("sin conversación previa, sólo el pedido de apertura", async () => {
    const org = await consultorio();
    const { pedidos, crearConversacion } = doble();
    const conversacion = await abrir(org, crearConversacion);
    expect(pedidos[0].messages).toEqual([{ role: "user", content: PEDIDO_APERTURA }]);
    expect(conversacion.turnosHistorial).toBe(0);
  });

  it("con conversación previa, los turnos guardados van antes, sin la marca y sin los cortados", async () => {
    const org = await consultorio();
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId,
      respuesta: { texto: "APERTURA_VIEJA", en: new Date(Date.UTC(2026, 9, 1, 14)), interrumpida: false },
    });
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId,
      pregunta: { texto: "PREGUNTA_VIEJA", en: new Date(Date.UTC(2026, 9, 1, 15)) },
      respuesta: { texto: `Miro.\n${avisoMirandoTranscripcion("04/08")}\nRESPUESTA_VIEJA`, en: new Date(Date.UTC(2026, 9, 1, 15, 1)), interrumpida: false },
    });
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId,
      pregunta: { texto: "PREGUNTA_CORTADA", en: new Date(Date.UTC(2026, 9, 2, 15)) },
      respuesta: { texto: "RESPUESTA_CORTADA", en: new Date(Date.UTC(2026, 9, 2, 15, 1)), interrumpida: true },
    });
    const { pedidos, crearConversacion } = doble();
    const conversacion = await abrir(org, crearConversacion);
    const mensajes = pedidos[0].messages;
    expect(mensajes.slice(0, -1)).toEqual([
      { role: "user", content: PEDIDO_APERTURA },
      { role: "assistant", content: "APERTURA_VIEJA" },
      { role: "user", content: "PREGUNTA_VIEJA" },
      { role: "assistant", content: "Miro.\n_(mirando la transcripción del 04/08)_\nRESPUESTA_VIEJA" },
      { role: "user", content: "PREGUNTA_CORTADA" },
    ]);
    // El saludo arranca por dónde quedaron, y cuándo: la fecha del último turno.
    expect(mensajes.at(-1)).toEqual({ role: "user", content: pedidoApertura(new Date(Date.UTC(2026, 9, 2, 15, 1))) });
    expect(mensajes.at(-1)!.content).toContain("02/10/2026");
    expect(JSON.stringify(mensajes)).not.toContain("RESPUESTA_CORTADA");
    expect(conversacion.turnosHistorial).toBe(4);
  });

  it("lo de otra paciente no viaja", async () => {
    const org = await consultorio();
    const beto = await otraPaciente(org);
    await intercambio(org, 0, beto);
    const { pedidos, crearConversacion } = doble();
    await abrir(org, crearConversacion);
    expect(JSON.stringify(pedidos[0].messages)).not.toContain("PREGUNTA_0");
  });
});

describe("empezar de cero", () => {
  it("borra la conversación de esa paciente, deja lux.borrar_conversacion sin texto y no toca la de otra", async () => {
    const org = await consultorio();
    const beto = await otraPaciente(org);
    await intercambio(org, 0);
    await intercambio(org, 1);
    await intercambio(org, 2, beto);
    const borrados = await borrarConversacion(db(), { ...identidad(org), userId: org.userId });
    expect(borrados).toBe(4);
    expect(await cargarConversacion(db(), identidad(org))).toEqual([]);
    expect(await cargarConversacion(db(), identidad(org, beto))).toHaveLength(2);
    const eventos = await eventosAuditoriaDe(base.prisma, org.orgId, org.pacienteId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      accion: ACCIONES.lux.borrarConversacion, entidad: "paciente", actorTipo: "usuario", actorId: org.userId,
      detalle: { turnos: 4 },
    });
    expect(JSON.stringify(eventos)).not.toMatch(/PREGUNTA_|RESPUESTA_/);
  });

  it("si el evento no se puede escribir, no borra nada y falla: sin marca no hay borrado", async () => {
    const org = await consultorio();
    await intercambio(org, 0);
    const real = db();
    // La transacción de verdad, con el INSERT del evento caído.
    const sinAuditoria = new Proxy(real, {
      get(t, p) {
        if (p !== "$transaction") return Reflect.get(t, p, t);
        return (fn: (tx: unknown) => Promise<unknown>) =>
          t.$transaction((tx) =>
            fn(new Proxy(tx, {
              get(txReal, q) {
                if (q === "eventoAuditoria") return { create: () => Promise.reject(new Error("auditoría caída")) };
                const v = Reflect.get(txReal, q, txReal);
                return typeof v === "function" ? v.bind(txReal) : v;
              },
            })) as never,
          );
      },
    });
    await expect(borrarConversacion(sinAuditoria, { ...identidad(org), userId: org.userId })).rejects.toThrow("auditoría caída");
    expect(await cargarConversacion(db(), identidad(org))).toHaveLength(2);
    expect(await eventosAuditoriaDe(base.prisma, org.orgId, org.pacienteId)).toEqual([]);
  });

  it("desde otra organización: 404, no borra nada ni deja rastro", async () => {
    const a = await consultorio();
    const b = await consultorio();
    await intercambio(a, 0);
    await expect(borrarConversacion(db(), { organizationId: b.orgId, pacienteId: a.pacienteId, userId: b.userId }))
      .rejects.toMatchObject({ status: 404 });
    expect(await cargarConversacion(db(), identidad(a))).toHaveLength(2);
    expect(await eventosAuditoriaDe(base.prisma, b.orgId)).toEqual([]);
  });
});

describe("revisión: carreras y aperturas", () => {
  const apertura = (org: Org, texto: string, en: Date) => guardarTurnos(db(), {
    ...identidad(org), userId: org.userId, respuesta: { texto, en, interrumpida: false },
  });

  it("muchas visitas sin preguntar no tapan la charla: se lee hacia atrás hasta encontrarla", async () => {
    const org = await consultorio();
    await intercambio(org, 0);
    // Con límite 3 la página es de 12 filas: 20 aperturas ocupan más de una.
    for (let i = 0; i < 20; i++) await apertura(org, `SALUDO_${i}`, new Date(Date.UTC(2026, 9, 10, 9, i)));
    const turnos = await cargarConversacion(db(), identidad(org), 3);
    expect(turnos.map((t) => t.texto)).toEqual(["PREGUNTA_0", "RESPUESTA_0", "SALUDO_19"]);
  });

  it("una respuesta pedida antes de 'Empezar de cero' que cierra después no revive la conversación", async () => {
    const org = await consultorio();
    const pedidoEn = new Date(Date.now() - 5000);
    await borrarConversacion(db(), { ...identidad(org), userId: org.userId });
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId, pedidoEn,
      pregunta: { texto: "EN_VUELO", en: pedidoEn },
      respuesta: { texto: "CORTADA", en: new Date(), interrumpida: true },
    });
    expect(await cargarConversacion(db(), identidad(org))).toEqual([]);
    // Lo que se pide después del borrado sí se guarda.
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId, pedidoEn: new Date(),
      respuesta: { texto: "NUEVA", en: new Date(), interrumpida: false },
    });
    expect((await cargarConversacion(db(), identidad(org))).map((t) => t.texto)).toEqual(["NUEVA"]);
  });

  it("las aperturas que nadie contestó no ocupan el historial; la última, sí", async () => {
    const org = await consultorio();
    const t = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
    await apertura(org, "APERTURA_CONTESTADA", t(1));
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId,
      pregunta: { texto: "PREGUNTA", en: t(2) }, respuesta: { texto: "RESPUESTA", en: t(3), interrumpida: false },
    });
    for (let h = 4; h < 4 + MAX_TURNOS_HISTORIAL_LUX; h++) await apertura(org, `SALUDO_${h}`, t(h));
    const ultima = `SALUDO_${3 + MAX_TURNOS_HISTORIAL_LUX}`;
    expect((await cargarConversacion(db(), identidad(org))).map((x) => x.texto))
      .toEqual(["APERTURA_CONTESTADA", "PREGUNTA", "RESPUESTA", ultima]);
  });

  it("'cuándo hablaron' es la última pregunta de ella, no el último saludo", async () => {
    const org = await consultorio();
    await guardarTurnos(db(), {
      ...identidad(org), userId: org.userId,
      pregunta: { texto: "PREGUNTA", en: new Date(Date.UTC(2026, 8, 20, 15)) },
      respuesta: { texto: "RESPUESTA", en: new Date(Date.UTC(2026, 8, 20, 15, 1)), interrumpida: false },
    });
    await apertura(org, "SALUDO", new Date(Date.UTC(2026, 9, 1, 15)));
    const pedidos: Parameters<typeof crearConversacionConHerramientas>[0][] = [];
    await abrirConversacion({
      prisma: db(), organizationId: org.orgId, usuarioId: org.userId, pacienteId: org.pacienteId, apiKey: "k", systemPrompt: "p",
      crearConversacion: async (pedido) => {
        pedidos.push(pedido);
        return { fragmentos: (async function* () { yield "x"; })(), resultado: Promise.resolve(RESULTADO), cancelar: () => {}, progreso: () => RESULTADO };
      },
    });
    expect(pedidos[0].messages.at(-1)!.content).toContain("20/09/2026");
  });

  it("sólo saludos, sin ninguna pregunta: no hubo conversación", async () => {
    const org = await consultorio();
    await apertura(org, "SALUDO", new Date(Date.UTC(2026, 9, 1, 15)));
    const pedidos: Parameters<typeof crearConversacionConHerramientas>[0][] = [];
    await abrirConversacion({
      prisma: db(), organizationId: org.orgId, usuarioId: org.userId, pacienteId: org.pacienteId, apiKey: "k", systemPrompt: "p",
      crearConversacion: async (pedido) => {
        pedidos.push(pedido);
        return { fragmentos: (async function* () { yield "x"; })(), resultado: Promise.resolve(RESULTADO), cancelar: () => {}, progreso: () => RESULTADO };
      },
    });
    expect(pedidos[0].messages.at(-1)!.content).toBe(PEDIDO_APERTURA);
  });
});
