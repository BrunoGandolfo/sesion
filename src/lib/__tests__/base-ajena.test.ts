// Integración — la suite apuntada a una base que no es la suya.
//
// El 16 de septiembre de 2026 el ejemplo de .env.test apuntaba a un puerto
// que en la máquina del dueño era la base de otro proyecto, y la suite no la
// vació solo porque las credenciales no coincidieron. Esta prueba reproduce
// el peor caso de ese error: una base ajena en el MISMO servidor local, con
// el esquema completo de Sesión y datos adentro (como la base de desarrollo
// o una restauración). Contra ella nada falla por "tabla inexistente": si la
// guarda no la frenara, el archivo que se corre la vaciaría con TRUNCATE.
//
// Se corre un archivo de integración real, en un proceso aparte y con
// DATABASE_URL_TEST apuntando a la base ajena. Tiene que abortar con el
// mensaje de la guarda, y la fila de la base ajena tiene que seguir ahí.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";

import { __resetLlaveroForTests } from "@/lib/llavero";

import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { conectarBaseDeTest, urlDeBaseDeTest, type BaseDeTest } from "./db-test";

const AJENA = "sesion_ajena_de_prueba";
/** Un archivo que vacía todas las tablas en su beforeEach. */
const ARCHIVO_QUE_TRUNCA = "src/lib/__tests__/endurecer-integracion.test.ts";

let base: BaseDeTest;
let ajena: PrismaClient;
let urlAjena: string;
const organizacionAjena = randomUUID();

/** Ambiente mínimo para los procesos hijos: nada del vitest que los lanza. */
const ambiente = (extra: Record<string, string>) => ({
  NODE_ENV: "test" as const, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TZ: "UTC",
  CLAVES_CIFRADO: CLAVES_CIFRADO_TEST, ...extra,
});

beforeAll(async () => {
  process.env.CLAVES_CIFRADO ??= CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  base = conectarBaseDeTest();

  await base.prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${AJENA} WITH (FORCE)`);
  await base.prisma.$executeRawUnsafe(`CREATE DATABASE ${AJENA}`);
  const url = new URL(urlDeBaseDeTest());
  url.pathname = `/${AJENA}`;
  urlAjena = url.toString();

  const migrar = spawnSync(resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    encoding: "utf8", env: ambiente({ DATABASE_URL: urlAjena }),
  });
  expect(migrar.status, `${migrar.stdout}\n${migrar.stderr}`).toBe(0);

  ajena = new PrismaClient({ datasources: { db: { url: urlAjena } } });
  await ajena.organization.create({ data: { id: organizacionAjena, nombre: "Datos que no son de la suite" } });
}, 120_000);

afterAll(async () => {
  await ajena?.$disconnect();
  await base?.prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${AJENA} WITH (FORCE)`);
  await base?.prisma.$disconnect();
});

it("la suite apuntada a una base ajena con el esquema de Sesión aborta antes de escribir y lo explica", async () => {
  const corrida = spawnSync(resolve("node_modules/.bin/vitest"), ["run", ARCHIVO_QUE_TRUNCA], {
    encoding: "utf8", timeout: 110_000,
    env: ambiente({ DATABASE_URL_TEST: urlAjena }),
  });
  const salida = `${corrida.stdout}\n${corrida.stderr}`;

  expect(corrida.status, salida).not.toBe(0);
  expect(salida).toContain(`DATABASE_URL_TEST apunta a la base "${AJENA}"`);
  expect(salida).toContain('la de pruebas de Sesión se llama "sesion_test"');
  expect(salida).toContain("Abortado antes de abrir la conexión");
  expect(salida).not.toContain("postgres:postgres");

  // La base ajena quedó exactamente como estaba.
  expect(await ajena.organization.findMany({ select: { id: true, nombre: true } })).toEqual([
    { id: organizacionAjena, nombre: "Datos que no son de la suite" },
  ]);
}, 120_000);
