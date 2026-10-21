// Integración — la memoria de Lux contra Postgres: la tabla
// conversaciones_lux, lo que se guarda (cifrado de verdad), lo que se carga
// (los últimos N, en orden), el borrado en cascada con la paciente y el
// aislamiento entre organizaciones y entre pacientes.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { abrirConversacion, PEDIDO_APERTURA, pedidoApertura } from "@/app/api/_lib/casos-uso/lux/conversar";
import {
  cargarConversacion, guardarTurnos, type ClienteMemoriaLux,
} from "@/app/api/_lib/casos-uso/lux/memoria";
import type { crearConversacionConHerramientas, ResultadoConversacion } from "@/lib/anthropic-mensajes";
import { aadDe, descifrar } from "@/lib/encryption";
import { avisoMirandoTranscripcion, MAX_TURNOS_HISTORIAL_LUX } from "@/lib/lux/contrato";

import { conectarArea2, crearOrg, type BaseArea2, type Org } from "./estados-fixtures";
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
