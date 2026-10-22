/**
 * Integración — el código del PASO 1 (todo borrar-sms menos la migración)
 * contra una base que ya no tiene configuraciones.canal_recordatorio.
 *
 * Publicar aplica la migración ANTES de avanzar release, así que durante
 * unos segundos (o para siempre, si el despliegue falla) el código del
 * PASO 1 corre contra la base del PASO 2. Prisma lee todas las columnas de
 * un modelo cuando la consulta no trae `select`: sin `@ignore` en
 * canalRecordatorio, leer o guardar la configuración y crear la cuenta
 * pedían la columna borrada (P1 de Codex en integracion).
 *
 * Sólo se borra la columna: envios_sms y bajas_sms no las lee ninguna
 * consulta y vaciarTablas las sigue nombrando. La suite de integración
 * corre de a un archivo, y afterAll devuelve la columna como la creó
 * 20261008120000_whatsapp_asistido.
 *
 * Este archivo se va con la migración (PASO 2), que borra la columna de
 * verdad.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { actualizarConfiguracion, obtenerConfiguracion } from "@/app/api/_lib/casos-uso/configuracion";
import { __resetLlaveroForTests } from "@/lib/llavero";

import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;
const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;

beforeAll(async () => {
  process.env.CLAVES_CIFRADO = `1=${randomBytes(32).toString("base64")}`;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
  await prismaRaw.$executeRawUnsafe(`ALTER TABLE "configuraciones" DROP COLUMN "canal_recordatorio"`);
});

afterAll(async () => {
  await vaciarTablas(prismaRaw);
  await prismaRaw.$executeRawUnsafe(
    `ALTER TABLE "configuraciones" ADD COLUMN "canal_recordatorio" "canal_recordatorio" NOT NULL DEFAULT 'sms'`,
  );
  await prismaRaw.$disconnect();
  process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

beforeEach(() => vaciarTablas(prismaRaw));

it("sin la columna, la cuenta nueva crea su configuración y se lee y se guarda", async () => {
  const org = await prismaRaw.organization.create({ data: { nombre: `Org ${randomUUID()}` } });
  const user = await prismaRaw.user.create({
    data: { email: `${randomUUID()}@test.uy`, hashedPassword: "x", nombre: "Mariana", organizationId: org.id },
  });
  // Lo mismo que el registro (cuenta-registro-db.ts).
  await prismaRaw.configuracion.create({ data: { organizationId: org.id, nombreProfesional: "", tarifaDefault: 0 } });

  const leida = await obtenerConfiguracion({ prisma: db, organizationId: org.id });
  expect(leida.tarifaDefault).toBe(0);

  const guardada = await actualizarConfiguracion({
    prisma: db,
    organizationId: org.id,
    usuarioId: user.id,
    cambios: { tarifaDefault: 1500, recordatorioModo: "dos_dias_antes" },
  });
  expect(guardada).toMatchObject({ tarifaDefault: 1500, recordatorioModo: "dos_dias_antes" });
});
