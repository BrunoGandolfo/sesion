/**
 * Integración — la ficha trae, con cada turno, el estado de su sesión clínica.
 *
 * La ficha guarda en el teléfono los turnos de hoy y mañana para grabar sin
 * señal (src/lib/agenda-local.ts). Un turno cuya sesión ya se cerró (se subió,
 * se está escribiendo, se aprobó) no admite otro audio: si se guardara, sin
 * señal se podría grabar una sesión entera que después el servidor rechaza
 * (revisión de Codex del 13-oct-2026). Para excluirlo, la ficha necesita el
 * estado de la sesión; obtenerPaciente lo trae, y nada más de la sesión.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/ficha-sesion-del-turno.test.ts
 */

import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { obtenerPaciente } from "@/app/api/_lib/casos-uso/pacientes";
import { turnosParaAgendaLocal } from "@/app/(dashboard)/pacientes/[id]/_components/paciente-detail-view";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;
const KEY = `1=${randomBytes(32).toString("base64")}`;

beforeAll(() => {
  process.env.CLAVES_CIFRADO = KEY;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = KEY;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("obtenerPaciente — el estado de la sesión de cada turno", () => {
  it("lo trae, y la ficha deja afuera de la agenda local los turnos con sesión cerrada", async () => {
    const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
    const paciente = await prismaRaw.paciente.create({
      data: { nombre: "Ana", apellido: "Pérez", telefono: "+59899000000", tarifa: 2600, organizationId: org.id },
    });
    const ahora = Date.now();
    const turno = async (minutos: number, estado: "programado" | "realizado") =>
      (await prismaRaw.turno.create({
        data: {
          organizationId: org.id, pacienteId: paciente.id, estado, pagoEstado: "pendiente", tarifaCobrada: 2600,
          fecha: new Date(ahora + minutos * 60_000),
        },
      })).id;
    const sinSesion = await turno(60, "programado");
    const grabando = await turno(120, "programado");
    const cerrada = await turno(-60, "realizado");
    await prismaRaw.sesionClinica.create({ data: { turnoId: grabando, organizationId: org.id, estado: "grabando" } });
    await prismaRaw.sesionClinica.create({ data: { turnoId: cerrada, organizationId: org.id, estado: "procesando" } });

    const ficha = await obtenerPaciente({ prisma: db, organizationId: org.id, pacienteId: paciente.id });
    const estados = Object.fromEntries(ficha.turnos.map((t) => [t.id, t.sesionClinica]));
    expect(estados).toEqual({
      [sinSesion]: null,
      [grabando]: { estado: "grabando" },
      [cerrada]: { estado: "procesando" },
    });

    const guardables = turnosParaAgendaLocal(ficha.paciente, ficha.turnos).map((t) => t.id);
    expect(guardables.sort()).toEqual([sinSesion, grabando].sort());
  });
});
