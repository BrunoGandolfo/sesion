// El ensayo de restauración, probado con respaldos generados acá contra el
// Postgres local de test: uno bueno, uno vacío, uno corrupto, uno truncado, y
// el bueno leído con un llavero al que se le retiró la clave de su época.
//
// Corre los mismos archivos que el workflow: scripts/ensayo/restaurar.sh y
// scripts/ensayo/verificar-restauracion.mjs. Lo único simulado es `aws`, en
// el test del paso que elige las copias. Necesita pg_dump/pg_restore/psql 17
// (PG_BIN o el PATH) y gpg, además de DATABASE_URL_TEST (superusuario: crea
// y borra bases ensayo_*).

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hiloVacio } from "@/lib/hilo/contenido";
import { __resetLlaveroForTests, VARIABLE_LLAVERO } from "@/lib/llavero";
import { cifrarHiloVersion, cifrarSesion } from "@/lib/prisma-encryption";

import { conectarBaseDeTest, urlDeBaseDeTest, vaciarTablas, type BaseDeTest } from "./db-test";
import { crearOrg, crearSesion, NOTA } from "./estados-fixtures";

const RESTAURAR = resolve("scripts/ensayo/restaurar.sh");
const VERIFICAR = resolve("scripts/ensayo/verificar-restauracion.mjs");
const WORKFLOW = resolve(".github/workflows/ensayo-restauracion.yml");
const PASSPHRASE = "passphrase-de-prueba";
const bin = (nombre: string) => (process.env.PG_BIN ? join(process.env.PG_BIN, nombre) : nombre);

const K1 = randomBytes(32).toString("base64"); // la clave con que se cifra el respaldo
const K2 = randomBytes(32).toString("base64"); // la que queda cuando se retira la 1
const K3 = randomBytes(32).toString("base64"); // una clave equivocada con el id 1

let base: BaseDeTest;
let carpeta: string;
let sesionId: string;
let versionId: string;
const basesCreadas: string[] = [];

const gpg = (entrada: string, salida: string) =>
  execFileSync("gpg", ["--batch", "--yes", "--quiet", "--symmetric", "--cipher-algo", "AES256", "--passphrase-fd", "0", "--output", salida, entrada], {
    input: PASSPHRASE, env: { ...process.env, GNUPGHOME: join(carpeta, "gnupg") },
  });
const respaldar = (nombre: string) => {
  const dump = join(carpeta, `${nombre}.dump`);
  execFileSync(bin("pg_dump"), ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, urlDeBaseDeTest()]);
  gpg(dump, `${dump}.gpg`);
  return dump;
};
const urlDe = (nombreBase: string) => {
  const url = new URL(urlDeBaseDeTest());
  url.pathname = `/${nombreBase}`;
  return url.toString();
};
const psql = (url: string, ...sentencias: string[]) =>
  execFileSync(bin("psql"), ["-X", "-v", "ON_ERROR_STOP=1", ...sentencias.flatMap((s) => ["-c", s]), url], { stdio: "pipe" });

function restaurar(archivo: string, nombreBase: string) {
  psql(urlDeBaseDeTest(), `DROP DATABASE IF EXISTS ${nombreBase}`, `CREATE DATABASE ${nombreBase}`);
  basesCreadas.push(nombreBase);
  const r = spawnSync("bash", [RESTAURAR, join(carpeta, archivo), urlDe(nombreBase)], {
    encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, PG_BIN: process.env.PG_BIN ?? "", BACKUP_ENCRYPTION_KEY: PASSPHRASE, GNUPGHOME: join(carpeta, "gnupg") },
  });
  return { ...r, url: urlDe(nombreBase) };
}
function verificar(url: string, llavero: string | undefined, etiqueta: string) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH, DATABASE_URL: url, BACKUP_ARCHIVO: `${etiqueta}.dump.gpg` };
  if (process.env.PG_BIN) env.PG_BIN = process.env.PG_BIN;
  if (llavero !== undefined) env[VARIABLE_LLAVERO] = llavero;
  const r = spawnSync(process.execPath, [VERIFICAR, "--etiqueta", etiqueta, "--salida", carpeta], { encoding: "utf8", env });
  const ruta = join(carpeta, `resultado-${etiqueta}.json`);
  return { ...r, resultado: existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : null };
}

beforeAll(async () => {
  process.env[VARIABLE_LLAVERO] = `1=${K1}`;
  __resetLlaveroForTests();
  base = conectarBaseDeTest();
  await vaciarTablas(base.prisma);
  carpeta = mkdtempSync(join(tmpdir(), "sesion-ensayo-"));
  mkdirSync(join(carpeta, "gnupg"), { mode: 0o700 });

  // Datos reales del esquema, cifrados con el módulo de la app (clave 1).
  const org = await crearOrg(base.prisma);
  await base.prisma.user.create({ data: { email: `ensayo-${org.orgId.slice(0, 8)}@example.invalid`, hashedPassword: "x", nombre: "Prueba", organizationId: org.orgId } });
  sesionId = (await crearSesion(base.prisma, org, { estado: "aprobada", audio: false, notaIa: NOTA })).sesionId;
  const { notaFinalEncrypted } = cifrarSesion(sesionId, { notaFinal: NOTA });
  await base.prisma.sesionClinica.update({ where: { id: sesionId }, data: { notaFinalEncrypted, aprobadaEn: new Date() } });
  versionId = randomUUID();
  const { contenidoEncrypted } = cifrarHiloVersion(versionId, { contenido: { ...hiloVacio(), resumenAcumulativo: "Solo debe existir cifrado" } });
  await base.prisma.hilo.create({ data: { pacienteId: org.pacienteId, organizationId: org.orgId, ultimaVersion: 1 } });
  await base.prisma.hiloVersion.create({ data: { id: versionId, pacienteId: org.pacienteId, organizationId: org.orgId, version: 1, actor: "profesional", estado: "aplicada", contenidoEncrypted } });
  await base.prisma.hilo.update({ where: { pacienteId: org.pacienteId }, data: { vigenteId: versionId } });

  const bueno = respaldar("bueno");
  // Corrupto: 2 KB en cero dentro del dump, antes de cifrar (gpg no lo nota).
  const bytes = readFileSync(bueno);
  bytes.fill(0, Math.floor(bytes.length * 0.8), Math.floor(bytes.length * 0.8) + 2048);
  writeFileSync(join(carpeta, "corrupto.dump"), bytes);
  gpg(join(carpeta, "corrupto.dump"), join(carpeta, "corrupto.dump.gpg"));
  // Truncado: la mitad del archivo cifrado, como una subida cortada.
  const cifrado = readFileSync(`${bueno}.gpg`);
  writeFileSync(join(carpeta, "truncado.dump.gpg"), cifrado.subarray(0, Math.floor(cifrado.length / 2)));
  // Vacío: el esquema entero, sin una sola fila.
  await vaciarTablas(base.prisma);
  respaldar("vacio");
}, 120_000);

afterAll(async () => {
  for (const b of basesCreadas) psql(urlDeBaseDeTest(), `DROP DATABASE IF EXISTS ${b}`);
  await base?.prisma.$disconnect();
  if (carpeta) rmSync(carpeta, { recursive: true, force: true });
});

it("un respaldo restaurado con tablas vacías hace fallar el ensayo", () => {
  const r = restaurar("vacio.dump.gpg", "ensayo_vacio");
  expect(r.status, r.stderr).toBe(0);
  const v = verificar(r.url, `1=${K1}`, "vacio");
  expect(v.status).toBe(1);
  expect(v.stderr).toContain("tabla pacientes vacía: 0 filas");
  expect(v.stderr).toContain("tabla sesiones_clinicas vacía: 0 filas");
  expect(v.stderr).toContain("no hay ninguna nota clínica en la copia");
  expect(v.resultado.ok).toBe(false);
});

describe("el respaldo bueno", () => {
  let url: string;
  beforeAll(() => {
    const r = restaurar("bueno.dump.gpg", "ensayo_bueno");
    expect(r.status, r.stderr).toBe(0);
    url = r.url;
  });

  it("descifra al menos una nota clínica y una versión del Recorrido con la clave de su época", () => {
    const v = verificar(url, `1=${K1}`, "diario");
    expect(v.status, v.stderr).toBe(0);
    expect(v.resultado.ok).toBe(true);
    const muestras = v.resultado.descifrado.muestras as { rotulo: string; tabla: string; id: string; claveId: number; ok: boolean }[];
    expect(muestras.filter((m) => m.rotulo === "nota clínica" && m.ok && m.tabla === "sesiones_clinicas" && m.id === sesionId && m.claveId === 1).length).toBeGreaterThan(0);
    expect(muestras.filter((m) => m.rotulo === "versión del Recorrido" && m.ok && m.tabla === "hilo_versiones" && m.id === versionId).length).toBeGreaterThan(0);
    expect(v.resultado.cifrado.clavesAusentes).toEqual([]);
    expect(v.resultado.tablas.problemas).toEqual([]);
    // Nada clínico sale del script: ni en el log ni en el resultado.
    expect(v.stdout + v.stderr + JSON.stringify(v.resultado)).not.toContain("Solo debe existir cifrado");
    expect(JSON.stringify(v.resultado)).not.toContain('"subjetivo"');
  });

  it("falla si no puede descifrar: sin llavero no hay ensayo", () => {
    const v = verificar(url, undefined, "sin-llavero");
    expect(v.status).toBe(1);
    expect(v.stderr).toContain("falta CLAVES_CIFRADO");
    expect(v.resultado).toBeNull();
  });

  it("si falta la clave de esa época lo dice así, y no como corrupción", () => {
    const v = verificar(url, `2=${K2}`, "mensual");
    expect(v.status).toBe(1);
    expect(v.stderr).toContain("falta la clave 1 en el llavero del ensayo");
    expect(v.stderr).toContain("agregar la clave 1 a CLAVES_CIFRADO_ENSAYO");
    expect(v.stderr).not.toContain("dato corrupto");
    expect(v.resultado.cifrado.clavesAusentes).toEqual([1]);
    expect(v.resultado.descifrado.muestras.every((m: { codigo: string }) => m.codigo === "clave_ausente")).toBe(true);
  });

  it("con la clave equivocada bajo el mismo id no habla de clave ausente", () => {
    const v = verificar(url, `1=${K3}`, "equivocada");
    expect(v.status).toBe(1);
    expect(v.stderr).toContain("no descifra con la clave 1");
    expect(v.stderr).not.toContain("falta la clave");
    expect(v.resultado.descifrado.muestras.every((m: { codigo: string }) => m.codigo === "autenticacion")).toBe(true);
  });
});

it("una nota alterada en la copia hace fallar el ensayo como corrupción", () => {
  const r = restaurar("bueno.dump.gpg", "ensayo_alterado");
  expect(r.status, r.stderr).toBe(0);
  // Se cambia el último byte del ciphertext: el prefijo y el id de clave quedan intactos.
  psql(r.url, `UPDATE sesiones_clinicas SET nota_final_encrypted = overlay(nota_final_encrypted PLACING '\\x00'::bytea FROM length(nota_final_encrypted)) WHERE id = '${sesionId}'`);
  const v = verificar(r.url, `1=${K1}`, "alterado");
  expect(v.status).toBe(1);
  expect(v.stderr).toContain(`(sesiones_clinicas.nota_final_encrypted ${sesionId}): no descifra con la clave 1: dato corrupto`);
  expect(v.stderr).not.toContain("falta la clave");
});

describe("un archivo corrupto o truncado hace fallar el ensayo", () => {
  it("truncado: gpg no lo descifra", () => {
    const r = restaurar("truncado.dump.gpg", "ensayo_truncado");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no se pudo descifrar: passphrase equivocada o archivo dañado/truncado");
  });
  it("corrupto: pg_restore se corta y no se verifica nada", () => {
    const r = restaurar("corrupto.dump.gpg", "ensayo_corrupto");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no tiene un índice legible|pg_restore se cortó/);
    expect(existsSync(join(carpeta, "resultado-corrupto.json"))).toBe(false);
  });
});

describe("el workflow prueba también una copia mensual", () => {
  type Paso = { name?: string; run?: string; if?: string; env?: Record<string, string> };
  const { load } = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => { jobs: { ensayo: { steps: Paso[] } } } };
  const pasos = load(readFileSync(WORKFLOW, "utf8")).jobs.ensayo.steps;
  const paso = (nombre: string) => {
    const p = pasos.find((p) => p.name === nombre);
    if (!p) throw new Error(`Falta el paso "${nombre}"`);
    return p;
  };
  const elegir = (diarios: string, mensuales: string) => {
    const dir = mkdtempSync(join(tmpdir(), "sesion-elegir-"));
    mkdirSync(join(dir, "bin"));
    // `aws` simulado: lista canned por prefijo y respeta el índice del --query.
    writeFileSync(join(dir, "bin/aws"), [
      "#!/bin/bash", 'cmd="$2"; prefix=""; query=""',
      'while [ $# -gt 0 ]; do case "$1" in --prefix) prefix="$2"; shift;; --query) query="$2"; shift;; esac; shift; done',
      '[ "$cmd" = head-object ] && { echo "2026-09-01T06:00:00+00:00"; exit 0; }',
      'case "$prefix" in backups/mensuales/) lista=($FAKE_MENSUALES);; backups/sesion-backup-) lista=($FAKE_DIARIOS);; *) lista=();; esac',
      '[ ${#lista[@]} -eq 0 ] && { echo None; exit 0; }',
      'case "$query" in *"[-1]"*) echo "${lista[-1]}";; *"[0]"*) echo "${lista[0]}";; *) echo None;; esac',
    ].join("\n"), { mode: 0o755 });
    const r = spawnSync("bash", ["-c", paso("Elegir las copias: la diaria más reciente y la mensual más vieja").run!], {
      cwd: dir, encoding: "utf8",
      env: { NODE_ENV: "test", PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_ENV: join(dir, "env"), R2_BUCKET: "b", R2_ENDPOINT: "https://r2.invalid", FAKE_DIARIOS: diarios, FAKE_MENSUALES: mensuales },
    });
    const env = existsSync(join(dir, "env")) ? readFileSync(join(dir, "env"), "utf8") : "";
    rmSync(dir, { recursive: true, force: true });
    return { ...r, env };
  };

  it("elige la diaria más reciente y la mensual más vieja", () => {
    const r = elegir("backups/sesion-backup-a.dump.gpg backups/sesion-backup-b.dump.gpg", "backups/mensuales/enero.dump.gpg backups/mensuales/agosto.dump.gpg");
    expect(r.status, r.stderr).toBe(0);
    expect(r.env).toContain("BACKUP_DIARIO=backups/sesion-backup-b.dump.gpg");
    expect(r.env).toContain("BACKUP_MENSUAL=backups/mensuales/enero.dump.gpg");
  });
  it("sin copia mensual el ensayo falla en vez de probar solo la diaria", () => {
    const r = elegir("backups/sesion-backup-a.dump.gpg", "");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no hay ninguna copia mensual");
  });
  it("restaura y verifica las dos copias, y la mensual corre aunque la diaria haya fallado", () => {
    expect(paso("Restaurar y verificar la copia diaria").run).toContain("--etiqueta diario");
    const mensual = paso("Restaurar y verificar la copia mensual");
    expect(mensual.run).toContain("--etiqueta mensual");
    expect(mensual.if).toContain("!cancelled()");
    expect(paso("Verificar secrets").run).toContain("CLAVES_CIFRADO_ENSAYO");
  });
});
