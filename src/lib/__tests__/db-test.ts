// Único punto de contacto de los tests de integración con la base de test.
//
// Por qué existe: siete archivos de test repetían el mismo bloque —cargar
// .env.test, chequear DATABASE_URL_TEST, construir PrismaClient y escribir un
// TRUNCATE ... CASCADE a mano—. Nueve tablas por copia, siete copias, ninguna
// idéntica a la otra. Un TRUNCATE es la sentencia más destructiva del
// repositorio y estaba escrita en siete lugares, cada uno leyendo una variable
// de entorno que en una laptop mal configurada puede apuntar a producción.
//
// Ahora hay un solo TRUNCATE en todo el repositorio (`vaciarTablas`) y un solo
// lugar donde se decide a qué base se conecta un test (`conectarBaseDeTest`),
// con tres guardas antes de abrir la conexión:
//
//   1. DATABASE_URL_TEST tiene que existir.
//   2. Tiene que contener el identificador de la rama de test de Neon.
//   3. NO puede contener el de la rama de producción.
//
// La 3 es redundante con la 2 mientras los identificadores no cambien, y es a
// propósito: si mañana alguien renombra la rama de test y afloja la guarda 2,
// la 3 sigue tapando el caso que importa.
//
// Este archivo NO es un test (no matchea *.test.ts): vitest no lo colecta.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { withEncryption } from "@/lib/prisma-encryption";

// ────────────────────────────────────────────────────────────────────────────
// Identificadores de rama (Neon los pone en el host de la connection string).
// ────────────────────────────────────────────────────────────────────────────

/** Rama de Neon dedicada a los tests. Es la única que se puede vaciar. */
const RAMA_TEST = "ep-floral-sound";

/** Rama de producción. Si aparece en la URL, se aborta sin conectar. */
const RAMA_PRODUCCION = "ep-odd-night";

// ────────────────────────────────────────────────────────────────────────────
// .env.test
// ────────────────────────────────────────────────────────────────────────────

/**
 * Carga .env.test sin agregar dependencias: parser mínimo, y solo para las
 * variables que no vengan ya del ambiente (en CI vienen del secret, y ahí
 * este archivo no existe). Idempotente.
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
 * fallar (contexto-clinico.test.ts, que además tiene tests puros).
 *
 * No valida la URL: eso lo hace conectarBaseDeTest antes de conectar.
 */
export function hayBaseDeTest(): boolean {
  cargarEnvTest();
  return Boolean(process.env.DATABASE_URL_TEST);
}

// ────────────────────────────────────────────────────────────────────────────
// Guardas
// ────────────────────────────────────────────────────────────────────────────

/** Host de la URL, para poder decir qué se recibió sin filtrar la contraseña
 *  que viaja en el userinfo de la connection string. */
function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(no es una URL válida)";
  }
}

const AYUDA = [
  "Cómo arreglarlo:",
  "  - Local: poné DATABASE_URL_TEST en .env.test con la connection string de",
  "    la rama de test de Neon (Neon → Branches → test → Connection string).",
  "  - CI: el job `test` la recibe de secrets.DATABASE_URL_TEST.",
].join("\n");

/**
 * Valida DATABASE_URL_TEST y la devuelve. Lanza —con un mensaje que dice qué
 * pasó y cómo arreglarlo— si falta, si no es la rama de test o si es la de
 * producción. Exportada aparte de la conexión para poder testearla.
 */
export function urlDeBaseDeTest(): string {
  cargarEnvTest();
  const url = process.env.DATABASE_URL_TEST?.trim();

  if (!url) {
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

  if (url.includes(RAMA_PRODUCCION)) {
    throw new Error(
      [
        `DATABASE_URL_TEST apunta a PRODUCCIÓN (contiene "${RAMA_PRODUCCION}").`,
        "",
        "Los tests de integración vacían TODAS las tablas con TRUNCATE ...",
        "CASCADE. Abortado antes de abrir la conexión: no se ejecutó nada.",
        "",
        `Host recibido: ${hostDe(url)}`,
        "",
        AYUDA,
      ].join("\n"),
    );
  }

  if (!url.includes(RAMA_TEST)) {
    throw new Error(
      [
        "DATABASE_URL_TEST no apunta a la rama de test.",
        "",
        "Los tests de integración vacían TODAS las tablas con TRUNCATE ...",
        `CASCADE, así que la URL tiene que contener "${RAMA_TEST}", el`,
        "identificador de la rama de Neon dedicada a tests. Abortado antes de",
        "abrir la conexión: no se ejecutó nada.",
        "",
        `Host recibido: ${hostDe(url)}`,
        "",
        AYUDA,
      ].join("\n"),
    );
  }

  return url;
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
// mano en un test, salteando las guardas de arriba.
const autorizados = new WeakSet<object>();

/**
 * Cliente Prisma contra la base de test, ya validada.
 *
 * Llamar desde `beforeAll`, no en el top-level del módulo: la extensión de
 * cifrado valida NOTES_ENCRYPTION_KEY al construirse, y los tests la setean
 * en ese mismo hook.
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
 * Tablas que se vacían entre casos, en una sola sentencia. CASCADE limpia el
 * grafo entero, así que el orden no importa; la lista es la unión de las que
 * truncaba cada test por su cuenta.
 *
 * `eventos_auditoria` NO está: los casos de uso reciben la auditoría como
 * stub y ningún test escribe esa tabla.
 */
const TABLAS = [
  "sesiones_clinicas",
  "paciente_contexto_clinico",
  "consentimientos_grabacion",
  "recordatorios",
  "turnos",
  "hot_words",
  "pacientes",
  "configuraciones",
  "usuarios",
  "organizaciones",
] as const;

/**
 * Vacía la base de test. Es la única función del repositorio que escribe un
 * TRUNCATE, y solo acepta un cliente devuelto por conectarBaseDeTest.
 */
export async function vaciarTablas(prisma: PrismaClient): Promise<void> {
  if (!autorizados.has(prisma)) {
    throw new Error(
      [
        "vaciarTablas() recibió un PrismaClient que no salió de",
        "conectarBaseDeTest(): no se puede saber a qué base apunta.",
        "",
        "Obtené el cliente con `const { prisma, db } = conectarBaseDeTest()`.",
      ].join("\n"),
    );
  }

  const lista = TABLAS.map((t) => `"${t}"`).join(",\n       ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       ${lista}
     RESTART IDENTITY CASCADE`,
  );
}
