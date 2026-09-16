// Integración directa: consultas reales en Postgres y campos clínicos cifrados.
import { randomUUID } from "node:crypto";
import type { AlcanceHotWord, EstadoTurno, EstadoPago } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { terminosAsr } from "@/app/api/_lib/casos-uso/terminos-asr";
import { textoDeCobro } from "@/app/api/_lib/casos-uso/texto-de-cobro";
import { leerProgreso } from "@/app/api/_lib/casos-uso/hilo/progreso";
import { hashTermino } from "@/lib/hot-words";
import { cifrarHotWord } from "@/lib/prisma-encryption";
import { vaciarTablas } from "./db-test";
import { conectarArea2, crearOrg, crearSesion, type BaseArea2, type Org } from "./estados-fixtures";

let base: BaseArea2;
let org: Org;
const AHORA = new Date("2026-09-03T15:00:00.000Z");
const identidad = (o = org) => ({ organizationId: o.orgId, pacienteId: o.pacienteId });

beforeAll(() => { base = conectarArea2(); });
beforeEach(async () => {
  await vaciarTablas(base.prisma);
  org = await crearOrg(base.prisma);
});
afterAll(async () => {
  await vaciarTablas(base.prisma);
  await base.prisma.$disconnect();
});

async function otraPaciente() {
  const paciente = await base.prisma.paciente.create({
    data: { organizationId: org.orgId, nombre: "Beatriz", apellido: "López", telefono: "+59899111111", tarifa: 1000 },
  });
  return { ...org, pacienteId: paciente.id };
}

async function termino(termino: string, alcance: AlcanceHotWord, o = org, activo = true) {
  await base.prisma.hotWord.create({
    data: {
      ...cifrarHotWord(randomUUID(), { termino }),
      organizationId: o.orgId,
      pacienteId: alcance === "paciente" ? o.pacienteId : null,
      alcance, activo, terminoHash: await hashTermino(termino),
    },
  });
}

async function turno(monto: number, o = org, estado: EstadoTurno = "realizado", pagoEstado: EstadoPago = "pendiente") {
  return base.prisma.turno.create({
    data: { ...identidad(o), fecha: new Date("2026-08-01T15:00:00Z"), tarifaCobrada: monto, estado, pagoEstado },
  });
}

const cobrar = (o = org) => textoDeCobro(base.db, { ...identidad(o), ahora: AHORA });

describe("terminosAsr", () => {
  it("descifra los tres alcances activos y excluye otra cuenta, otra paciente e inactivos", async () => {
    await termino("Winnicott", "global");
    await termino("Rorschach", "profesional");
    await termino("Ana María", "paciente");
    await termino("Nombre ajeno", "paciente", await otraPaciente());
    await termino("Nombre desactivado", "paciente", org, false);
    const ajena = await crearOrg(base.prisma);
    await termino("Global ajeno", "global", ajena);
    await termino("Profesional ajeno", "profesional", ajena);
    await termino("Paciente ajena", "paciente", ajena);

    expect(await terminosAsr({ prisma: base.db, ...identidad() })).toEqual(["Ana María", "Rorschach", "Winnicott"]);
  });

  it("ordena y elimina duplicados entre alcances", async () => {
    await termino("Zulema", "paciente");
    await termino("Ana", "profesional");
    await termino("Ana", "global");
    await termino("Ana", "paciente");

    expect(await terminosAsr({ prisma: base.db, ...identidad() })).toEqual(["Ana", "Zulema"]);
  });

  it("devuelve una lista vacía si no hay términos elegibles", async () => {
    await termino("Inactivo", "global", org, false);
    expect(await terminosAsr({ prisma: base.db, ...identidad() })).toEqual([]);
  });
});

describe("textoDeCobro", () => {
  it("envía nombre, profesional y suma exacta de las sesiones realizadas pendientes de esa paciente", async () => {
    await turno(1200);
    await turno(2300);
    await turno(9000, org, "realizado", "pagado");
    await turno(9000, org, "programado");
    await turno(9000, org, "cancelado");
    await turno(9000, org, "ausente");
    await turno(9000, await otraPaciente());
    await turno(9000, await crearOrg(base.prisma));

    expect(await cobrar()).toBe("Hola Ana, ¿cómo estás? Te escribo para recordarte que tenés 2 sesiones pendientes de pago por un total de $ 3.500. Cualquier duda estoy a disposición. Lic. Prueba");
  });

  it("recalcula la deuda al pagar y devuelve null cuando ya no queda deuda", async () => {
    const primero = await turno(1200);
    const segundo = await turno(2300);
    expect(await cobrar()).toContain("2 sesiones pendientes de pago por un total de $ 3.500");
    await base.prisma.turno.update({ where: { id: primero.id }, data: { pagoEstado: "pagado" } });
    expect(await cobrar()).toContain("1 sesión pendiente de pago por un total de $ 2.300");
    await base.prisma.turno.update({ where: { id: segundo.id }, data: { pagoEstado: "pagado" } });
    expect(await cobrar()).toBeNull();
  });

  it.each(["ajena", "inexistente"] as const)("no produce un mensaje para una paciente %s", async (caso) => {
    const ajena = await crearOrg(base.prisma);
    await turno(5000, ajena);
    await turno(1000);
    const pacienteId = caso === "ajena" ? ajena.pacienteId : randomUUID();
    expect(await cobrar({ ...org, pacienteId })).toBeNull();
  });

  it("sin configuración conserva el singular y el nombre literal, sin agregar undefined ni espacios finales", async () => {
    await base.prisma.configuracion.delete({ where: { organizationId: org.orgId } });
    await base.prisma.paciente.update({ where: { id: org.pacienteId }, data: { nombre: "Ana $&" } });
    await turno(1250);
    expect(await cobrar()).toBe("Hola Ana $&, ¿cómo estás? Te escribo para recordarte que tenés 1 sesión pendiente de pago por un total de $ 1.250. Cualquier duda estoy a disposición.");
  });
});

describe("leerProgreso", () => {
  it("lee y descifra solo revisión y aprobadas de la paciente, en orden de fecha del turno", async () => {
    const reciente = await crearSesion(base.prisma, org, { estado: "revision", audio: false, datos: { intensidadEmocional: 7, temas: ["duelo"] } });
    const antigua = await crearSesion(base.prisma, org, { estado: "aprobada", audio: false, datos: { intensidadEmocional: 3, temas: ["trabajo"] } });
    await base.prisma.turno.update({ where: { id: antigua.turnoId }, data: { fecha: new Date("2026-08-01T15:00:00Z") } });
    for (const estado of ["grabando", "subiendo", "procesando", "fallida"] as const) {
      await crearSesion(base.prisma, org, { estado, audio: false, datos: { temas: ["no mostrar"] } });
    }
    await crearSesion(base.prisma, await otraPaciente(), { estado: "aprobada", audio: false, datos: { temas: ["otra paciente"] } });
    await crearSesion(base.prisma, await crearOrg(base.prisma), { estado: "revision", audio: false, datos: { temas: ["otra cuenta"] } });

    const resultado = await leerProgreso(base.db, identidad(), "todo", AHORA);
    expect(resultado.pacienteId).toBe(org.pacienteId);
    expect(resultado.totalSesiones).toBe(2);
    expect(resultado.sesiones.map(({ sesionId, fecha, numero, intensidadEmocional, temas }) => ({ sesionId, fecha, numero, intensidadEmocional, temas }))).toEqual([
      { sesionId: antigua.sesionId, fecha: "2026-08-01T15:00:00.000Z", numero: 1, intensidadEmocional: 3, temas: ["trabajo"] },
      { sesionId: reciente.sesionId, fecha: "2026-09-01T14:00:00.000Z", numero: 2, intensidadEmocional: 7, temas: ["duelo"] },
    ]);
    expect(resultado.temas.map(t => t.tema).sort()).toEqual(["duelo", "trabajo"]);
  });

  it.each(["ajena", "inexistente"] as const)("rechaza con 404 una paciente %s", async (caso) => {
    const ajena = await crearOrg(base.prisma);
    await crearSesion(base.prisma, ajena, { estado: "aprobada", audio: false, datos: { temas: ["privado"] } });
    const pacienteId = caso === "ajena" ? ajena.pacienteId : randomUUID();
    await expect(leerProgreso(base.db, { ...identidad(), pacienteId }, "todo", AHORA)).rejects.toMatchObject({ status: 404, message: "Paciente no encontrado" });
  });

  it("pasa rango y reloj: corta por fecha y hora de Montevideo y conserva numeración y temas históricos", async () => {
    const antigua = await crearSesion(base.prisma, org, { estado: "aprobada", audio: false, datos: { temas: ["histórico"] } });
    const limite = await crearSesion(base.prisma, org, { estado: "revision", audio: false, datos: { temas: ["actual"] } });
    // El corte conserva la hora: 03/06 a las 12:00 de Montevideo (15:00 UTC).
    await base.prisma.turno.update({ where: { id: antigua.turnoId }, data: { fecha: new Date("2026-06-03T14:59:59.999Z") } });
    await base.prisma.turno.update({ where: { id: limite.turnoId }, data: { fecha: new Date("2026-06-03T15:00:00.000Z") } });

    const resultado = await leerProgreso(base.db, identidad(), "3m", AHORA);
    expect(resultado.rango).toBe("3m");
    expect(resultado.totalSesiones).toBe(2);
    expect(resultado.sesiones.map(s => [s.sesionId, s.numero])).toEqual([[limite.sesionId, 2]]);
    expect(resultado.temas.map(t => t.tema).sort()).toEqual(["actual", "histórico"]);
  });

  it("no grafica métricas inválidas ni inventa valores cuando faltan datos", async () => {
    const invalida = await crearSesion(base.prisma, org, { estado: "revision", audio: false, datos: { intensidadEmocional: 99, temas: ["inválido"] } });
    const vacia = await crearSesion(base.prisma, org, { estado: "aprobada", audio: false });
    const resultado = await leerProgreso(base.db, identidad(), "todo", AHORA);
    expect(resultado.totalSesiones).toBe(2);
    expect(resultado.sesiones.map(s => s.sesionId).sort()).toEqual([invalida.sesionId, vacia.sesionId].sort());
    for (const sesion of resultado.sesiones) {
      expect(sesion).toMatchObject({ intensidadEmocional: null, alianzaTerapeutica: null, temas: [], nivelRiesgo: null, flagsRiesgo: null, intervenciones: {}, observacionIA: null, progresoPercibido: null });
    }
    expect(resultado.temas).toEqual([]);
    expect(resultado.riesgos).toEqual([]);
  });

  it("una paciente propia sin sesiones tiene un progreso vacío", async () => {
    expect(await leerProgreso(base.db, identidad(), "todo", AHORA)).toEqual({
      pacienteId: org.pacienteId, totalSesiones: 0, rango: "todo", sesiones: [], temas: [], riesgos: [],
    });
  });
});
