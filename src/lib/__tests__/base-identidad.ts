// Conexión a la base de test para los tests de integración del área de
// identidad y cifrado (prisma-encryption, login-atomico, password-atomico,
// registro-atomico, recuperacion-atomica).
//
// Existe aparte de ./db-test.ts porque ese helper todavía vacía tablas del
// esquema viejo (paciente_contexto_clinico, recordatorios) y su lista de
// tablas es del área de CI. Cuando el área 5 lo actualice al esquema nuevo,
// estos tests pueden volver a usarlo y este archivo se borra.
//
// Guardas, iguales en espíritu a las de db-test.ts: DATABASE_URL_TEST tiene
// que existir, y su host tiene que ser la rama de test de Neon o una base
// local. Si contiene el identificador de la rama de producción, se aborta
// sin conectar.
//
// No es un test (no matchea *.test.ts): vitest no lo colecta.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { withEncryption, type ClienteCifrado } from "@/lib/prisma-encryption";

const RAMA_TEST = "ep-floral-sound";
const RAMA_PRODUCCION = "ep-odd-night";
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1"]);

/** Clave de cifrado de los tests: 32 bytes en cero, id 1. */
export const CLAVES_CIFRADO_TEST = "1=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function cargarEnv(archivo: string): void {
  try {
    const contenido = readFileSync(resolve(process.cwd(), archivo), "utf8");
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

export function urlDeBaseDeTest(): string {
  if (!process.env.DATABASE_URL_TEST) {
    cargarEnv(".env.test");
    cargarEnv(".env");
  }
  const url = process.env.DATABASE_URL_TEST?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL_TEST no está definida: los tests de integración vacían la base y no adivinan a cuál.",
    );
  }
  if (url.includes(RAMA_PRODUCCION)) {
    throw new Error("DATABASE_URL_TEST apunta a PRODUCCIÓN. Abortado sin conectar.");
  }
  const host = new URL(url).hostname;
  if (!url.includes(RAMA_TEST) && !HOSTS_LOCALES.has(host)) {
    throw new Error(
      `DATABASE_URL_TEST tiene que ser la rama de test de Neon (${RAMA_TEST}) o una base local; host recibido: ${host}`,
    );
  }
  return url;
}

export function hayBaseDeTest(): boolean {
  try {
    urlDeBaseDeTest();
    return true;
  } catch {
    return false;
  }
}

export interface BaseIdentidad {
  /** Cliente crudo: columnas físicas, SQL directo. */
  prisma: PrismaClient;
  /** El mismo cliente con la extensión de cifrado. */
  db: ClienteCifrado;
}

const autorizados = new WeakSet<object>();

/** Llamar desde beforeAll, con CLAVES_CIFRADO ya puesta. */
export function conectarBaseIdentidad(): BaseIdentidad {
  const url = urlDeBaseDeTest();
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  autorizados.add(prisma);
  return { prisma, db: withEncryption(prisma) };
}

/** Todas las tablas del esquema nuevo, en una sola sentencia. */
const TABLAS = [
  "eventos_auditoria",
  "trabajos",
  "worker_estado",
  "audio_segmentos",
  "hilo_versiones",
  "hilos",
  "sesiones_clinicas",
  "consentimientos_grabacion",
  "hot_words",
  "envios_sms",
  "bajas_sms",
  "turnos",
  "series_turno",
  "pacientes",
  "configuraciones",
  "cupos_ayuda",
  "invitaciones",
  "password_resets",
  "intentos_acceso",
  "sesiones_acceso",
  "usuarios",
  "organizaciones",
] as const;

export async function vaciarBaseIdentidad(prisma: PrismaClient): Promise<void> {
  if (!autorizados.has(prisma)) {
    throw new Error("vaciarBaseIdentidad() solo acepta el cliente de conectarBaseIdentidad().");
  }
  const lista = TABLAS.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}
