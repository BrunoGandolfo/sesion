import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { consultarAgenda, type PeriodoAgenda } from "@/app/api/_lib/casos-uso/ayuda/agenda";
import { resolverHerramienta } from "@/app/api/_lib/casos-uso/ayuda/herramientas";
import { AYUDA_FUERA_DE_ALCANCE } from "@/lib/glosario";
import { LUPITA_CAMPOS_AGENDA } from "@/lib/consentimiento-hechos";
import { conectarArea2, crearOrg, limpiarOrg, type BaseArea2, type Org } from "./estados-fixtures";

let base: BaseArea2;
let propia: Org;
let ajena: Org;
const ahora = new Date("2026-09-18T01:30:00Z"); // jueves 17, 22:30 en Montevideo
const herramientas = (nombre: string, entrada: unknown) => ({
  texto: "", tokensEntrada: 1, tokensSalida: 1, cacheLeido: 0, cacheEscrito: 0,
  motivoDeCorte: "tool_use", herramientas: [{ nombre, entrada }],
});
const consulta = (periodo: PeriodoAgenda) => consultarAgenda({ prisma: base.db, organizationId: propia.orgId, periodo, ahora });

beforeAll(async () => {
  base = conectarArea2();
  propia = await crearOrg(base.prisma);
  ajena = await crearOrg(base.prisma);
  await base.prisma.paciente.update({ where: { id: propia.pacienteId }, data: {
    nombre: "Ana", apellido: "APELLIDO_PROHIBIDO", telefono: "+59899123456", tarifa: 9876,
    // Una consulta que intente descifrar la ficha fallaría: no es un ENC2 válido.
    notasEncrypted: Buffer.from("FICHA_PROHIBIDA"),
  } });
  await base.prisma.paciente.update({ where: { id: ajena.pacienteId }, data: { nombre: "OTRO_CONSULTORIO" } });
  const turno = (fecha: string, extra: Partial<Prisma.TurnoUncheckedCreateInput> = {}) => base.prisma.turno.create({ data: {
    fecha: new Date(fecha), organizationId: propia.orgId, pacienteId: propia.pacienteId,
    duracion: 50, modalidad: "presencial", tarifaCobrada: 8765,
    notasEncrypted: Buffer.from("NOTA_PROHIBIDA"), ...extra,
  } });
  await turno("2026-09-14T02:59:59Z"); // domingo anterior
  await turno("2026-09-14T03:00:00Z"); // primer instante de esta semana
  await turno("2026-09-17T02:59:59Z"); // ayer, todavía esta semana
  await turno("2026-09-17T03:00:00Z"); // comienzo de hoy
  await turno("2026-09-17T13:15:00Z", { estado: "realizado" });
  await turno("2026-09-18T02:59:59Z"); // fin de hoy
  await turno("2026-09-18T03:00:00Z", { duracion: 90, modalidad: "online" });
  await turno("2026-09-21T02:59:59Z"); // fin de esta semana
  await turno("2026-09-21T03:00:00Z"); // próxima semana
  await turno("2027-01-01T03:00:00Z"); // mañana desde el 31/12
  await turno("2026-09-17T14:00:00Z", { estado: "cancelado" });
  await turno("2026-09-17T15:00:00Z", { organizationId: ajena.orgId, pacienteId: ajena.pacienteId });
  // Un enlace inconsistente de datos también debe quedar fuera.
  await turno("2026-09-17T16:00:00Z", { pacienteId: ajena.pacienteId });
});
afterAll(async () => {
  await limpiarOrg(base.prisma, propia.orgId);
  await limpiarOrg(base.prisma, ajena.orgId);
  await base.prisma.$disconnect();
});

describe("agenda mínima real en Postgres", () => {
  it("hoy incluye ambos bordes de Montevideo y ordena por hora, sin cancelados", async () => {
    expect(await consulta("hoy")).toEqual(["00:00", "10:15", "23:59"].map(hora => ({
      nombre: "Ana", dia: "2026-09-17", hora, duracion: 50, modalidad: "presencial",
    })));
  });
  it("mañana conserva la duración y la modalidad", async () => {
    expect(await consulta("manana")).toEqual([{ nombre: "Ana", dia: "2026-09-18", hora: "00:00", duracion: 90, modalidad: "online" }]);
  });
  it("esta semana significa lunes a domingo, no los siete días siguientes", async () => {
    const turnos = await consulta("esta_semana");
    expect(turnos.map(t => `${t.dia} ${t.hora}`)).toEqual([
      "2026-09-14 00:00", "2026-09-16 23:59", "2026-09-17 00:00", "2026-09-17 10:15",
      "2026-09-17 23:59", "2026-09-18 00:00", "2026-09-20 23:59",
    ]);
  });
  it("resuelve mañana al cruzar mes/año y la semana desde un domingo", async () => {
    const siguienteAnio = await consultarAgenda({ prisma: base.db, organizationId: propia.orgId, periodo: "manana", ahora: new Date("2026-12-31T18:00:00Z") });
    expect(siguienteAnio).toEqual([{ nombre: "Ana", dia: "2027-01-01", hora: "00:00", duracion: 50, modalidad: "presencial" }]);
    const domingo = await consultarAgenda({ prisma: base.db, organizationId: propia.orgId, periodo: "esta_semana", ahora: new Date("2026-09-21T02:00:00Z") });
    expect(domingo).toEqual(await consulta("esta_semana"));
  });
  it("cada consultorio solo ve su agenda; ni siquiera una relación inconsistente cruza pacientes", async () => {
    const propiaLeida = await consulta("hoy");
    const ajenaLeida = await consultarAgenda({ prisma: base.db, organizationId: ajena.orgId, periodo: "hoy", ahora });
    expect(propiaLeida.every(t => t.nombre === "Ana")).toBe(true);
    expect(ajenaLeida).toEqual([{ nombre: "OTRO_CONSULTORIO", dia: "2026-09-17", hora: "12:00", duracion: 50, modalidad: "presencial" }]);
  });
  it("la consulta real funciona en una transacción READ ONLY y selecciona exclusivamente los campos autorizados", async () => {
    const antes = await base.prisma.turno.findMany({ orderBy: { id: "asc" } });
    const leidos = await base.db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return consultarAgenda({ prisma: tx, organizationId: propia.orgId, periodo: "hoy", ahora });
    });
    expect(leidos).toHaveLength(3);
    for (const turno of leidos) expect(Object.keys(turno)).toEqual([...LUPITA_CAMPOS_AGENDA]);
    expect(JSON.stringify(leidos)).not.toMatch(/PROHIBID|9876|8765|59899123456|OTRO_CONSULTORIO/);
    expect(await base.prisma.turno.findMany({ orderBy: { id: "asc" } })).toEqual(antes);
  });
  it.each(["telefono", "tarifa", "deudas", "cobros", "notaFinal", "transcripcion", "hilo", "consentimiento", "ficha", "organizationId", "where", "sql"])(
    "pedir %s como argumento extra se rechaza antes de leer", async campo => {
      let lecturas = 0;
      const respuesta = await resolverHerramienta(herramientas("consultar_agenda", { periodo: "hoy", [campo]: ajena.orgId }), async periodo => { lecturas++; return consulta(periodo); });
      expect(respuesta).toBe(AYUDA_FUERA_DE_ALCANCE);
      expect(lecturas).toBe(0);
    },
  );
  it.each(["leer_ficha", "leer_notas", "leer_recorrido", "cobrar_turno", "cancelar_turno", "crear_turno", "actualizar_turno", "$queryRaw"])(
    "no existe la capacidad %s, incluso ante una llamada del modelo", async nombre => {
      const antes = await base.prisma.turno.findMany({ orderBy: { id: "asc" } });
      let lecturas = 0;
      expect(await resolverHerramienta(herramientas(nombre, { organizationId: ajena.orgId }), async periodo => { lecturas++; return consulta(periodo); })).toBe(AYUDA_FUERA_DE_ALCANCE);
      expect(lecturas).toBe(0);
      expect(await base.prisma.turno.findMany({ orderBy: { id: "asc" } })).toEqual(antes);
    },
  );
  it("una sesión de 120 minutos se cuenta como de 120, sin redondear", async () => {
    // Otro día, fuera de los períodos de los demás casos, y se borra al final.
    const largo = await base.prisma.turno.create({ data: {
      fecha: new Date("2026-10-02T13:00:00Z"), organizationId: propia.orgId, pacienteId: propia.pacienteId,
      duracion: 120, modalidad: "presencial", tarifaCobrada: 8765,
    } });
    try {
      const antesDelDia = new Date("2026-10-01T15:00:00Z"); // jueves 1, mediodía en Montevideo
      const deManana = (periodo: PeriodoAgenda) => consultarAgenda({ prisma: base.db, organizationId: propia.orgId, periodo, ahora: antesDelDia });
      expect(await deManana("manana")).toEqual([{ nombre: "Ana", dia: "2026-10-02", hora: "10:00", duracion: 120, modalidad: "presencial" }]);
      expect(await resolverHerramienta(herramientas("consultar_agenda", { periodo: "manana" }), deManana)).toContain("2026-10-02 · 10:00 · Ana · 120 min · presencial");
    } finally {
      await base.prisma.turno.delete({ where: { id: largo.id } });
    }
  });
  it("lista la agenda real sin que el proveedor vuelva a redactar los horarios", async () => {
    expect(await resolverHerramienta(herramientas("consultar_agenda", { periodo: "manana" }), consulta)).toContain("2026-09-18 · 00:00 · Ana · 90 min · online");
  });
});
