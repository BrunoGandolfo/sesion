/**
 * Integración — recordarCobro y ultimoAvisoPorPaciente contra la base real
 * de test. El aviso de cobro va sólo por WhatsApp (CANAL_RECORDATORIO_VIGENTE):
 * acá no se programa ningún SMS; se arma el enlace y se anota la apertura.
 *
 * Lo que se prueba: que con cualquier canal guardado salga por WhatsApp, que
 * no se le avise a quien no debe (ni a quien pidió la baja), y que la
 * pantalla pueda saber cuándo fue el último aviso.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/recordar-cobro.test.ts
 */
import { ACCIONES } from "@/lib/auditoria-acciones";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { recordarCobro, ultimoAvisoPorPaciente } from "@/app/api/_lib/casos-uso/recordar-cobro";
import { listarDeudores } from "@/app/api/_lib/casos-uso/deudores";
import { textoDeCobro } from "@/app/api/_lib/casos-uso/texto-de-cobro";
import { deudaDePaciente } from "@/app/api/_lib/domain";
import { TEMPLATE_COBRO_DEFAULT } from "@/lib/deudas";
import { enlaceWhatsapp } from "@/lib/whatsapp";
import { ApiError } from "@/app/api/_lib/responses";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";
import { COBRO_CANAL_CAMBIO, MOTIVO_PACIENTE_DADA_DE_BAJA } from "@/lib/glosario";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const TEST_KEY_B64 = randomBytes(32).toString("base64");

const AHORA = new Date("2026-09-03T15:00:00.000Z");
const TARIFA = 1200;
const TELEFONO = "+59899123456";

type Base = { orgId: string; pacienteId: string };

async function crearBase(): Promise<Base> {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  await prismaRaw.configuracion.create({
    data: { organizationId: org.id, nombreProfesional: "Mariana Roldán", tarifaDefault: TARIFA },
  });
  const paciente = await prismaRaw.paciente.create({
    data: { nombre: "Lucía", apellido: "Fernández", telefono: TELEFONO, tarifa: TARIFA, organizationId: org.id },
  });
  return { orgId: org.id, pacienteId: paciente.id };
}

/** Turno realizado e impago: lo que cuenta como deuda. */
async function crearImpago(base: Base, diasAtras: number): Promise<void> {
  await prismaRaw.turno.create({
    data: {
      fecha: new Date(AHORA.getTime() - diasAtras * 86_400_000),
      duracion: 50,
      estado: "realizado",
      pagoEstado: "pendiente",
      tarifaCobrada: TARIFA,
      pacienteId: base.pacienteId,
      organizationId: base.orgId,
    },
  });
}

/** El rastro que quedó EN LA BASE. El caso de uso ya no recibe la función de
 *  auditoría: escribe con el mismo cliente que el acto. */
const eventosDe = (organizationId: string) =>
  prismaRaw.eventoAuditoria.findMany({
    where: { organizationId },
    orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
  });

const enviosDe = (pacienteId: string) =>
  prismaRaw.envioSms.findMany({ where: { pacienteId }, orderBy: { creadoEn: "asc" } });

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

describe("recordarCobro", () => {
  // Sólo WhatsApp (CANAL_RECORDATORIO_VIGENTE): lo guardado en la columna
  // no cuenta, y el SMS de cobro ya no tiene camino de entrada.
  it.each(["sms", "ambos", "whatsapp"] as const)(
    "con %s guardado no programa ningún SMS: abre WhatsApp y lo anota",
    async (guardado) => {
      const base = await crearBase();
      await prismaRaw.configuracion.update({ where: { organizationId: base.orgId }, data: { canalRecordatorio: guardado } });
      await crearImpago(base, 40);
      await crearImpago(base, 12);

      const resultado = await recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: base.pacienteId,
        usuarioId: "user-1",
        ahora: AHORA,
      });

      expect(resultado).toMatchObject({ canal: "whatsapp", avisadoEn: AHORA.toISOString(), sesiones: 2, monto: 2 * TARIFA });
      expect(await enviosDe(base.pacienteId)).toHaveLength(0);
      expect(await prismaRaw.avisoWhatsapp.count({ where: { organizationId: base.orgId, tipo: "cobro" } })).toBe(1);
      const eventos = await eventosDe(base.orgId);
      expect(eventos.map((e) => e.accion)).toEqual([ACCIONES.cobro.whatsappAbierto]);
      // Ni el teléfono ni el nombre entran al registro.
      const serializado = JSON.stringify(eventos[0]);
      expect(serializado).not.toContain(TELEFONO);
      expect(serializado).not.toContain("Lucía");
    },
  );

  it("a quien no debe nada no se le avisa: 409 y no se crea nada", async () => {
    const base = await crearBase();
    await prismaRaw.turno.create({
      data: {
        fecha: new Date(AHORA.getTime() - 86_400_000),
        duracion: 50,
        estado: "realizado",
        pagoEstado: "pagado",
        pagoFecha: new Date(AHORA.getTime() - 86_400_000),
        pagoMetodo: "efectivo",
        tarifaCobrada: TARIFA,
        pacienteId: base.pacienteId,
        organizationId: base.orgId,
      },
    });

    await expect(
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: base.pacienteId,
        ahora: AHORA,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await enviosDe(base.pacienteId)).toHaveLength(0);
    expect(await eventosDe(base.orgId)).toHaveLength(0);
  });

  it("una paciente de otra organización no existe para esta", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await crearImpago(otra, 10);

    await expect(
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: otra.pacienteId,
        ahora: AHORA,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await enviosDe(otra.pacienteId)).toHaveLength(0);
  });

  it("sin teléfono cargado no hay a dónde mandarlo: 409", async () => {
    const base = await crearBase();
    await crearImpago(base, 3);
    await prismaRaw.paciente.update({ where: { id: base.pacienteId }, data: { telefono: "   " } });

    await expect(
      recordarCobro({
        prisma: db,
        organizationId: base.orgId,
        pacienteId: base.pacienteId,
        ahora: AHORA,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await enviosDe(base.pacienteId)).toHaveLength(0);
  });

  it("un teléfono dado de baja: 409 con el motivo y no se crea nada", async () => {
    const base = await crearBase();
    await crearImpago(base, 3);
    await prismaRaw.bajaSms.create({ data: { telefono: TELEFONO, motivo: "respuesta_baja" } });

    const error = await recordarCobro({
      prisma: db,
      organizationId: base.orgId,
      pacienteId: base.pacienteId,
      ahora: AHORA,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toBe(MOTIVO_PACIENTE_DADA_DE_BAJA);
    expect(await enviosDe(base.pacienteId)).toHaveLength(0);
  });
});

describe("ultimoAvisoPorPaciente", () => {
  type Estado = "pendiente" | "aceptado" | "entregado" | "no_entregado" | "fallido";

  async function crearEnvio(
    base: Base,
    opciones: { estado: Estado; aceptadoEn: Date | null; pacienteId?: string; motivo?: "recordatorio_cobro" | "recordatorio_turno" },
  ): Promise<void> {
    await prismaRaw.envioSms.create({
      data: {
        organizationId: base.orgId,
        claveIdempotencia: `k:${randomUUID()}`,
        motivo: opciones.motivo ?? "recordatorio_cobro",
        estado: opciones.estado,
        pacienteId: opciones.pacienteId ?? base.pacienteId,
        destino: TELEFONO,
        programadoEn: AHORA,
        aceptadoEn: opciones.aceptadoEn,
        sid: opciones.aceptadoEn ? `SM${randomUUID().replaceAll("-", "")}` : null,
      },
    });
  }

  it("devuelve el aviso más reciente que SALIÓ de cada paciente", async () => {
    const base = await crearBase();
    const otra = await prismaRaw.paciente.create({
      data: { nombre: "Ana", apellido: "Pérez", telefono: "+59899000002", tarifa: TARIFA, organizationId: base.orgId },
    });
    const viejo = new Date("2026-08-01T12:00:00.000Z");
    const nuevo = new Date("2026-09-01T12:00:00.000Z");
    await crearEnvio(base, { estado: "entregado", aceptadoEn: viejo });
    await crearEnvio(base, { estado: "aceptado", aceptadoEn: nuevo });
    await crearEnvio(base, { estado: "aceptado", aceptadoEn: viejo, pacienteId: otra.id });

    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [base.pacienteId, otra.id]);

    expect(mapa.get(base.pacienteId)).toBe(nuevo.toISOString());
    expect(mapa.get(otra.id)).toBe(viejo.toISOString());
  });

  it("uno en cola, fallido o no entregado no cuenta como aviso; un recordatorio de turno tampoco", async () => {
    const base = await crearBase();
    await crearEnvio(base, { estado: "pendiente", aceptadoEn: null });
    await crearEnvio(base, { estado: "fallido", aceptadoEn: null });
    await crearEnvio(base, { estado: "no_entregado", aceptadoEn: new Date("2026-09-01T12:00:00.000Z") });
    await crearEnvio(base, { estado: "entregado", aceptadoEn: new Date("2026-09-02T12:00:00.000Z"), motivo: "recordatorio_turno" });

    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [base.pacienteId]);

    expect(mapa.has(base.pacienteId)).toBe(false);
  });

  it("no cruza organizaciones ni inventa avisos", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await crearEnvio(otra, { estado: "aceptado", aceptadoEn: new Date("2026-09-01T12:00:00.000Z") });

    // El id existe, pero el aviso es de otra organización.
    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, [otra.pacienteId, base.pacienteId]);

    expect(mapa.size).toBe(0);
  });

  it("sin pacientes no consulta nada", async () => {
    const base = await crearBase();
    const mapa = await ultimoAvisoPorPaciente(db, base.orgId, []);
    expect(mapa.size).toBe(0);
  });
});

describe("deudaDePaciente (la cuenta que usan recordarCobro y el texto del SMS)", () => {
  it("suma sus impagos y trae el más viejo; sin deuda, null", async () => {
    const base = await crearBase();
    expect(await deudaDePaciente(db, base.orgId, base.pacienteId, AHORA)).toBeNull();

    await crearImpago(base, 40);
    await crearImpago(base, 12);
    const deuda = await deudaDePaciente(db, base.orgId, base.pacienteId, AHORA);
    expect(deuda).toMatchObject({ pacienteId: base.pacienteId, sesionesImpagas: 2, montoTotal: 2 * TARIFA, diasAtraso: 40 });
    expect(deuda?.impagoMasAntiguo).toEqual(new Date(AHORA.getTime() - 40 * 86_400_000));
  });

  it("desde otra organización la paciente no debe nada", async () => {
    const base = await crearBase();
    const ajena = await crearBase();
    await crearImpago(base, 5);
    expect(await deudaDePaciente(db, ajena.orgId, base.pacienteId, AHORA)).toBeNull();
  });
});

describe("textoDeCobro (el texto del SMS de cobro)", () => {
  it("una configuración nueva trae la plantilla de siempre y sale el texto de siempre", async () => {
    const base = await crearBase();
    await crearImpago(base, 10);
    const config = await prismaRaw.configuracion.findUniqueOrThrow({ where: { organizationId: base.orgId } });
    expect(config.templateCobro).toBe(TEMPLATE_COBRO_DEFAULT);
    expect(await textoDeCobro(db, { organizationId: base.orgId, pacienteId: base.pacienteId, ahora: AHORA })).toBe(
      "Consultorio Mariana Roldán\nLucía, tenés 1 sesión pendiente de pago: $ 1.200.",
    );
  });

  it("usa la plantilla que ella guardó", async () => {
    const base = await crearBase();
    await crearImpago(base, 10);
    await prismaRaw.configuracion.update({
      where: { organizationId: base.orgId },
      data: { templateCobro: "{{nombre}} {{apellido}}: {{monto}}" },
    });
    expect(await textoDeCobro(db, { organizationId: base.orgId, pacienteId: base.pacienteId, ahora: AHORA })).toBe(
      "Lucía Fernández: $ 1.200",
    );
  });
});

describe("con WhatsApp desde mi teléfono", () => {
  async function conCanal(base: Base, canal: "sms" | "whatsapp" | "ambos") {
    await prismaRaw.configuracion.update({ where: { organizationId: base.orgId }, data: { canalRecordatorio: canal } });
  }
  const avisosDe = (organizationId: string) =>
    prismaRaw.avisoWhatsapp.findMany({ where: { organizationId }, orderBy: { abiertoEn: "asc" } });
  const pedir = (base: Base, ahora = AHORA) =>
    recordarCobro({ prisma: db, organizationId: base.orgId, pacienteId: base.pacienteId, usuarioId: "user-1", ahora });

  it("no programa SMS: devuelve el enlace con el texto de la plantilla y anota el aviso de cobro", async () => {
    const base = await crearBase();
    await conCanal(base, "whatsapp");
    await crearImpago(base, 40);
    await crearImpago(base, 12);
    const masViejo = await prismaRaw.turno.findFirstOrThrow({ where: { pacienteId: base.pacienteId }, orderBy: { fecha: "asc" } });

    const resultado = await pedir(base);

    const texto = await textoDeCobro(db, { organizationId: base.orgId, pacienteId: base.pacienteId, ahora: AHORA });
    expect(resultado).toEqual({
      canal: "whatsapp",
      enlace: enlaceWhatsapp(TELEFONO, texto!),
      avisadoEn: AHORA.toISOString(),
      sesiones: 2,
      monto: 2 * TARIFA,
    });
    expect(await enviosDe(base.pacienteId)).toHaveLength(0);
    const avisos = await avisosDe(base.orgId);
    expect(avisos).toHaveLength(1);
    // El aviso cuelga del turno impago más viejo: la deuda que se avisó.
    expect(avisos[0]).toMatchObject({ tipo: "cobro", turnoId: masViejo.id, fechaTurno: masViejo.fecha, abiertoEn: AHORA, usuarioId: "user-1" });

    const eventos = await eventosDe(base.orgId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      accion: ACCIONES.cobro.whatsappAbierto,
      actorId: "user-1",
      entidad: "paciente",
      entidadId: base.pacienteId,
      detalle: { canal: "whatsapp", avisoId: avisos[0].id, sesiones: 2, monto: 2 * TARIFA },
    });
    expect(JSON.stringify(eventos[0])).not.toContain(TELEFONO);
    expect(JSON.stringify(eventos[0])).not.toContain("Lucía");
  });

  it("cada apertura es una fila más (abrió dos veces) y no rompe nada", async () => {
    const base = await crearBase();
    await conCanal(base, "whatsapp");
    await crearImpago(base, 5);
    await pedir(base);
    await pedir(base, new Date(AHORA.getTime() + 60_000));
    expect(await avisosDe(base.orgId)).toHaveLength(2);
  });

  it("los mismos cortes que el SMS: sin deuda, sin teléfono o dado de baja, 409 y nada anotado", async () => {
    const sinDeuda = await crearBase();
    await conCanal(sinDeuda, "whatsapp");
    await expect(pedir(sinDeuda)).rejects.toMatchObject({ status: 409 });

    const sinTelefono = await crearBase();
    await conCanal(sinTelefono, "whatsapp");
    await crearImpago(sinTelefono, 5);
    await prismaRaw.paciente.update({ where: { id: sinTelefono.pacienteId }, data: { telefono: "" } });
    await expect(pedir(sinTelefono)).rejects.toMatchObject({ status: 409 });

    const deBaja = await crearBase();
    await conCanal(deBaja, "whatsapp");
    await crearImpago(deBaja, 5);
    await prismaRaw.bajaSms.create({ data: { telefono: TELEFONO, motivo: "respuesta_baja" } });
    await expect(pedir(deBaja)).rejects.toMatchObject({ status: 409, message: MOTIVO_PACIENTE_DADA_DE_BAJA });

    expect(await prismaRaw.avisoWhatsapp.count()).toBe(0);
    expect(await prismaRaw.eventoAuditoria.count()).toBe(0);
  });

  it("una paciente de otra organización no existe: 404 y nada anotado", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await conCanal(base, "whatsapp");
    await crearImpago(otra, 5);
    await expect(
      recordarCobro({ prisma: db, organizationId: base.orgId, pacienteId: otra.pacienteId, usuarioId: "u", ahora: AHORA }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(await prismaRaw.avisoWhatsapp.count()).toBe(0);
  });

  it("Avisado hace N días: cuenta la última apertura de WhatsApp igual que un SMS que salió", async () => {
    const base = await crearBase();
    const otra = await crearBase();
    await conCanal(base, "whatsapp");
    await conCanal(otra, "whatsapp");
    await crearImpago(base, 5);
    await crearImpago(otra, 5);
    const haceTres = new Date(AHORA.getTime() - 3 * 86_400_000);
    await pedir(base, haceTres);
    await pedir(otra, AHORA);
    // Un SMS de cobro más viejo no tapa la apertura más nueva…
    await prismaRaw.envioSms.create({
      data: {
        organizationId: base.orgId, claveIdempotencia: `k:${randomUUID()}`, motivo: "recordatorio_cobro", estado: "entregado",
        pacienteId: base.pacienteId, destino: TELEFONO, programadoEn: AHORA, aceptadoEn: new Date(haceTres.getTime() - 86_400_000), sid: "SMx",
      },
    });
    let mapa = await ultimoAvisoPorPaciente(db, base.orgId, [base.pacienteId, otra.pacienteId]);
    expect(mapa.get(base.pacienteId)).toBe(haceTres.toISOString());
    // …ni una apertura de otra organización cuenta.
    expect(mapa.has(otra.pacienteId)).toBe(false);

    // …y uno más nuevo sí manda.
    const ayer = new Date(AHORA.getTime() - 86_400_000);
    await prismaRaw.envioSms.create({
      data: {
        organizationId: base.orgId, claveIdempotencia: `k:${randomUUID()}`, motivo: "recordatorio_cobro", estado: "aceptado",
        pacienteId: base.pacienteId, destino: TELEFONO, programadoEn: AHORA, aceptadoEn: ayer, sid: "SMy",
      },
    });
    mapa = await ultimoAvisoPorPaciente(db, base.orgId, [base.pacienteId]);
    expect(mapa.get(base.pacienteId)).toBe(ayer.toISOString());
  });

  it("el WhatsApp del recordatorio de turno no es un aviso de cobro", async () => {
    const base = await crearBase();
    await crearImpago(base, 5);
    const turno = await prismaRaw.turno.findFirstOrThrow({ where: { pacienteId: base.pacienteId } });
    await prismaRaw.avisoWhatsapp.create({
      data: { organizationId: base.orgId, turnoId: turno.id, tipo: "recordatorio", fechaTurno: turno.fecha, abiertoEn: AHORA, usuarioId: "u" },
    });
    expect((await ultimoAvisoPorPaciente(db, base.orgId, [base.pacienteId])).size).toBe(0);
  });
});

describe("listarDeudores dice quién pidió la baja", () => {
  it("la pantalla lo sabe antes de abrir WhatsApp", async () => {
    const base = await crearBase();
    await crearImpago(base, 5);
    const otra = await prismaRaw.paciente.create({
      data: { nombre: "Ana", apellido: "Pérez", telefono: "+59899000002", tarifa: TARIFA, organizationId: base.orgId },
    });
    await prismaRaw.turno.create({
      data: { fecha: AHORA, duracion: 50, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: TARIFA, pacienteId: otra.id, organizationId: base.orgId },
    });
    await prismaRaw.bajaSms.create({ data: { telefono: TELEFONO, motivo: "respuesta_baja" } });
    const deudores = await listarDeudores({ prisma: db, organizationId: base.orgId, ahora: AHORA });
    expect(Object.fromEntries(deudores.map((d) => [d.pacienteId, d.dadaDeBaja]))).toEqual({
      [base.pacienteId]: true,
      [otra.id]: false,
    });
  });
});

describe("la pantalla y el servidor no pueden elegir canales distintos", () => {
  // Una pestaña abierta de antes de que el cobro fuera sólo por WhatsApp
  // todavía pide SMS: sea cual sea el guardado, 409 y nada.
  it.each(["whatsapp", "sms", "ambos"] as const)("con %s en la base y SMS en la pantalla: 409 y no se anota ni se programa nada", async (enLaBase) => {
    const base = await crearBase();
    await prismaRaw.configuracion.update({ where: { organizationId: base.orgId }, data: { canalRecordatorio: enLaBase } });
    await crearImpago(base, 5);
    await expect(
      recordarCobro({ prisma: db, organizationId: base.orgId, pacienteId: base.pacienteId, usuarioId: "u", ahora: AHORA, canal: "sms" }),
    ).rejects.toMatchObject({ status: 409, message: COBRO_CANAL_CAMBIO });
    expect(await prismaRaw.envioSms.count()).toBe(0);
    expect(await prismaRaw.avisoWhatsapp.count()).toBe(0);
    expect(await prismaRaw.eventoAuditoria.count()).toBe(0);
  });

  it.each(["sms", "ambos"] as const)("con %s en la base, la pantalla que pide WhatsApp sigue adelante", async (enLaBase) => {
    const base = await crearBase();
    await prismaRaw.configuracion.update({ where: { organizationId: base.orgId }, data: { canalRecordatorio: enLaBase } });
    await crearImpago(base, 5);
    const r = await recordarCobro({ prisma: db, organizationId: base.orgId, pacienteId: base.pacienteId, usuarioId: "u", ahora: AHORA, canal: "whatsapp" });
    expect(r.canal).toBe("whatsapp");
    expect(await prismaRaw.envioSms.count()).toBe(0);
  });
});

