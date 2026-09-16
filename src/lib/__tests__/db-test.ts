// Único punto de contacto de los tests de integración con la base de test.
//
// Por qué existe: siete archivos de test repetían el mismo bloque —cargar
// .env.test, chequear DATABASE_URL_TEST, construir PrismaClient y escribir un
// TRUNCATE ... CASCADE a mano—. Un TRUNCATE es la sentencia más destructiva
// del repositorio y estaba escrita en siete lugares, cada uno leyendo una
// variable de entorno que en una laptop mal configurada puede apuntar a
// producción.
//
// Ahora hay un solo TRUNCATE en todo el repositorio (`vaciarTablas`) y un solo
// lugar donde se decide a qué base se conecta un test (`conectarBaseDeTest`),
// con una guarda antes de abrir la conexión. Dos condiciones, las dos:
//
//   1. La base se llama exactamente `sesion_test`. Es lo único que distingue
//      la base de pruebas de este proyecto de cualquier otra del mismo
//      servidor o de otro servidor local: la base de desarrollo, la de otro
//      proyecto que escucha en un puerto parecido, una restauración.
//   2. El host es LOCAL (localhost, 127.0.0.1 o ::1). Cualquier otro host
//      aborta, salvo que exista PERMITIR_BASE_REMOTA_DE_TEST=1, y en ese caso
//      el log dice qué host se aceptó y que el TRUNCATE va en serio. El
//      permiso remoto no afloja la condición 1.
//
// POR QUÉ EL NOMBRE Y NO EL PUERTO
//
// El 16 de septiembre de 2026 el .env.test.example apuntaba a localhost:5433,
// y en la máquina del dueño ese puerto era la base de otro proyecto. La suite
// no la vació porque las credenciales no coincidieron, no por diseño: la
// guarda de localhost la aceptaba. Ningún número de puerto garantiza estar
// libre; el nombre de la base sí es de este proyecto. Lo fijan
// docker-compose.yml (POSTGRES_DB) y el job `test` de ci.yml.
//
// LA GUARDA ANTERIOR Y POR QUÉ CAMBIÓ
//
// Antes la guarda comparaba la URL con dos identificadores de ramas de Neon
// escritos acá (el de la rama de test tenía que estar; el de producción no
// podía estar). Dos problemas: eran identificadores de infraestructura en un
// repositorio público, y ataban el repositorio a un proveedor. En CI ya no
// hay Neon: cada corrida levanta un Postgres 17 propio (ver ci.yml), y en
// local la opción por defecto es el contenedor de docker-compose.yml. La
// rama `test` de Neon sigue sirviendo para quien no tenga Docker, pero hay
// que pedirla explícitamente.
//
// Este archivo NO es un test (no matchea *.test.ts): vitest no lo colecta.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient, type Prisma } from "@prisma/client";

import { withEncryption } from "@/lib/prisma-encryption";

/** Variable que habilita un host remoto. El valor tiene que ser exactamente "1". */
export const VARIABLE_PERMISO_REMOTO = "PERMITIR_BASE_REMOTA_DE_TEST";

/** El único nombre de base contra el que corre la suite de integración. */
export const NOMBRE_BASE_DE_TEST = "sesion_test";

const HOSTS_LOCALES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// ────────────────────────────────────────────────────────────────────────────
// .env.test
// ────────────────────────────────────────────────────────────────────────────

/**
 * Carga .env.test sin agregar dependencias: parser mínimo, y solo para las
 * variables que no vengan ya del ambiente (en CI vienen del job, y ahí este
 * archivo no existe). Idempotente.
 */
function cargarEnvTest(): void {
  if (process.env.DATABASE_URL_TEST) return;
  try {
    const contenido = readFileSync(resolve(process.cwd(), ".env.test"), "utf8");
    for (const lineaCruda of contenido.split("\n")) {
      const linea = lineaCruda.trim();
      if (!linea || linea.startsWith("#")) continue;
      const m = linea.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* archivo opcional */
  }
}

/**
 * True si hay una DATABASE_URL_TEST disponible (del ambiente o de .env.test).
 * Para los archivos que prefieren saltear el bloque de integración en vez de
 * fallar. No valida la URL: eso lo hace conectarBaseDeTest antes de conectar.
 */
export function hayBaseDeTest(): boolean {
  cargarEnvTest();
  return Boolean(process.env.DATABASE_URL_TEST);
}

// ────────────────────────────────────────────────────────────────────────────
// Guarda
// ────────────────────────────────────────────────────────────────────────────

/** Host, puerto y base de la URL, para poder decir qué se recibió sin filtrar
 *  la contraseña que viaja en el userinfo de la connection string. */
function partesDe(url: string): { host: string; puerto: string; base: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname, puerto: u.port || "5432", base: decodeURIComponent(u.pathname.replace(/^\//, "")) };
  } catch {
    return null;
  }
}

const AYUDA = [
  "Cómo arreglarlo:",
  `  - Con Docker: \`npm run db:test:up\` y DATABASE_URL_TEST del .env.test.example,`,
  `    o un contenedor propio con POSTGRES_DB=${NOMBRE_BASE_DE_TEST} y el puerto que te asigne.`,
  `  - Sin Docker: una base llamada ${NOMBRE_BASE_DE_TEST} en la rama \`test\` de Neon, con`,
  `    conexión directa, y ${VARIABLE_PERMISO_REMOTO}=1 para declarar que es remota.`,
  "  - CI: el job `test` levanta un Postgres propio y define la variable.",
  "  - Nunca renombres ni crees esa base dentro de un servidor que no sea tuyo:",
  "    la guarda confía en el nombre.",
].join("\n");

/**
 * La guarda, pura: recibe la URL y las variables y devuelve la URL validada
 * o lanza con un mensaje que dice qué pasó y cómo arreglarlo. Separada de
 * process.env para poder probarla sin tocar el ambiente del proceso.
 */
export function validarUrlDeBaseDeTest(
  url: string | undefined,
  permisoRemoto: string | undefined,
): string {
  const limpia = url?.trim();

  if (!limpia) {
    throw new Error(
      [
        "DATABASE_URL_TEST no está definida.",
        "",
        "Los tests de integración corren contra una base real y la vacían con",
        "TRUNCATE antes de cada caso. Sin esa variable no hay a qué conectarse",
        "y no se adivina: se aborta.",
        "",
        AYUDA,
      ].join("\n"),
    );
  }

  const partes = partesDe(limpia);
  if (partes === null) {
    throw new Error(
      ["DATABASE_URL_TEST no es una URL válida.", "", AYUDA].join("\n"),
    );
  }
  const { host, puerto, base } = partes;

  if (base !== NOMBRE_BASE_DE_TEST) {
    throw new Error(
      [
        `DATABASE_URL_TEST apunta a la base "${base || "(sin nombre)"}" en ${host}:${puerto}, y la de pruebas de Sesión se llama "${NOMBRE_BASE_DE_TEST}".`,
        "",
        "Los tests de integración vacían TODAS las tablas con TRUNCATE ...",
        "CASCADE. Una base con otro nombre no es la de pruebas de este proyecto:",
        "puede ser la de desarrollo, una restauración o la de otro sistema que",
        "escucha en ese puerto. Abortado antes de abrir la conexión: no se",
        "ejecutó nada.",
        "",
        AYUDA,
      ].join("\n"),
    );
  }

  if (HOSTS_LOCALES.has(host)) return limpia;

  if (permisoRemoto === "1") {
    // Se acepta, y se deja dicho en el log de la corrida: si el TRUNCATE
    // cae donde no debía, que al menos quede escrito contra qué host fue.
    console.warn(
      `[db-test] ${VARIABLE_PERMISO_REMOTO}=1: se acepta la base REMOTA "${host}". ` +
        "Los tests la vacían con TRUNCATE ... CASCADE entre casos; va en serio.",
    );
    return limpia;
  }

  throw new Error(
    [
      `DATABASE_URL_TEST apunta a un host que no es local: "${host}".`,
      "",
      "Los tests de integración vacían TODAS las tablas con TRUNCATE ...",
      "CASCADE. Por defecto sólo se acepta localhost / 127.0.0.1 / ::1.",
      `Si es a propósito (la rama test de Neon), poné ${VARIABLE_PERMISO_REMOTO}=1.`,
      "Abortado antes de abrir la conexión: no se ejecutó nada.",
      "",
      AYUDA,
    ].join("\n"),
  );
}

/** Valida DATABASE_URL_TEST (del ambiente o de .env.test) y la devuelve. */
export function urlDeBaseDeTest(): string {
  cargarEnvTest();
  return validarUrlDeBaseDeTest(
    process.env.DATABASE_URL_TEST,
    process.env[VARIABLE_PERMISO_REMOTO],
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Conexión
// ────────────────────────────────────────────────────────────────────────────

export type ClienteCifrado = ReturnType<typeof withEncryption<PrismaClient>>;

export interface BaseDeTest {
  /** Cliente crudo: columnas físicas, $executeRawUnsafe, fixtures. */
  prisma: PrismaClient;
  /** El mismo cliente con la extensión de cifrado: campos lógicos. */
  db: ClienteCifrado;
}

// Solo los clientes que salieron de conectarBaseDeTest pueden vaciarse. Es lo
// que impide que un TRUNCATE futuro se ejecute sobre un PrismaClient armado a
// mano en un test, salteando la guarda de arriba.
const autorizados = new WeakSet<object>();

/**
 * Cliente Prisma contra la base de test, ya validada.
 *
 * Llamar desde `beforeAll`, no en el top-level del módulo: la extensión de
 * cifrado valida la clave al construirse, y los tests la setean en ese mismo
 * hook.
 */
export function conectarBaseDeTest(): BaseDeTest {
  const url = urlDeBaseDeTest();
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  autorizados.add(prisma);
  return { prisma, db: withEncryption(prisma) };
}

// ────────────────────────────────────────────────────────────────────────────
// El único TRUNCATE del repositorio
// ────────────────────────────────────────────────────────────────────────────

/**
 * Todas las tablas del esquema (prisma/schema.prisma), en una sola
 * sentencia. CASCADE limpia el grafo entero, así que el orden no importa.
 *
 * Es la lista completa a propósito, `eventos_auditoria` y `worker_estado`
 * incluidas: la base de test nace vacía y vuelve a estar vacía antes de cada
 * caso, sin excepciones que haya que recordar. Si aparece una tabla nueva en
 * el schema y no está acá, el test de db-test.test.ts lo dice.
 */
export const TABLAS = [
  "organizaciones",
  "usuarios",
  "sesiones_acceso",
  "intentos_acceso",
  "password_resets",
  "invitaciones",
  "cupos_ayuda",
  "configuraciones",
  "pacientes",
  "series_turno",
  "turnos",
  "envios_sms",
  "bajas_sms",
  "consentimientos_grabacion",
  "sesiones_clinicas",
  "audio_segmentos",
  "trabajos",
  "worker_estado",
  "hot_words",
  "hilos",
  "hilo_versiones",
  "eventos_auditoria",
] as const;

/**
 * Vacía la base de test. Es la única función del repositorio que escribe un
 * TRUNCATE, y solo acepta un cliente devuelto por conectarBaseDeTest.
 */
export async function vaciarTablas(prisma: PrismaClient): Promise<void> {
  const lista = TABLAS.map((t) => `"${t}"`).join(",\n       ");
  await limpiarDatosDeTest(prisma, async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
  });
}

/** Limpieza administrativa de fixtures. DDL transaccional: los triggers se
 * reactivan antes del commit, o el rollback revierte también su desactivación.
 * No hay una bandera ni una excepción de inmutabilidad accesible por la app. */
export async function limpiarDatosDeTest(
  prisma: PrismaClient,
  limpiar: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  if (!autorizados.has(prisma)) {
    throw new Error(
      [
        "La limpieza recibió un PrismaClient que no salió de",
        "conectarBaseDeTest(): no se puede saber a qué base apunta.",
        "",
        "Obtené el cliente con `const { prisma, db } = conectarBaseDeTest()`.",
      ].join("\n"),
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("ALTER TABLE eventos_auditoria DISABLE TRIGGER eventos_auditoria_inmutable");
    await tx.$executeRawUnsafe("ALTER TABLE hilo_versiones DISABLE TRIGGER hilo_versiones_sin_borrado");
    await limpiar(tx);
    await tx.$executeRawUnsafe("ALTER TABLE hilo_versiones ENABLE TRIGGER hilo_versiones_sin_borrado");
    await tx.$executeRawUnsafe("ALTER TABLE eventos_auditoria ENABLE TRIGGER eventos_auditoria_inmutable");
  });
}
