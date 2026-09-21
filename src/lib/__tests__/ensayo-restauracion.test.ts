// El ensayo de restauración, probado con respaldos generados acá contra el
// Postgres local de test: uno bueno, uno vacío, uno corrupto, uno truncado, y
// el bueno leído con un llavero al que se le retiró la clave de su época.
// También restaura el esquema de producción d02ae0e con ENC1, comprueba sus
// columnas y fechas distintas, y rechaza estructuras desconocidas o mixtas.
//
// Corre los mismos archivos que el workflow y que el ensayo manual:
// scripts/ensayo/restaurar.sh, scripts/ensayo/verificar-restauracion.mjs y
// scripts/ensayo/ensayo-manual.sh. La selección de copias con aws simulado y
// JMESPath real se prueba en processor/tests/test_ensayo_listado.py.
// Necesita pg_dump/pg_restore/psql 17 (PG_BIN o el
// PATH) y gpg, además de DATABASE_URL_TEST (superusuario: crea y borra bases
// ensayo_*).

import { execFileSync, spawnSync } from "node:child_process";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const MANUAL = resolve("scripts/ensayo/ensayo-manual.sh");
const WORKFLOW = resolve(".github/workflows/ensayo-restauracion.yml");
const IDS = "CLAVES_CIFRADO_IDS";
const SCHEMA_PRODUCCION = resolve("scripts/ensayo/esquema-produccion.prisma");
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
const respaldar = (nombre: string, url = urlDeBaseDeTest()) => {
  const dump = join(carpeta, `${nombre}.dump`);
  execFileSync(bin("pg_dump"), ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, url]);
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
  if (!basesCreadas.includes(nombreBase)) basesCreadas.push(nombreBase);
  const r = spawnSync("bash", [RESTAURAR, join(carpeta, archivo), urlDe(nombreBase)], {
    encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, PG_BIN: process.env.PG_BIN ?? "", BACKUP_ENCRYPTION_KEY: PASSPHRASE, GNUPGHOME: join(carpeta, "gnupg") },
  });
  return { ...r, url: urlDe(nombreBase) };
}
/** `claves`: { CLAVES_CIFRADO_IDS } es el modo del workflow; { CLAVES_CIFRADO } el manual. */
function verificar(url: string, claves: Record<string, string>, etiqueta: string) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH, DATABASE_URL: url, BACKUP_ARCHIVO: `${etiqueta}.dump.gpg`, ...claves };
  if (process.env.PG_BIN) env.PG_BIN = process.env.PG_BIN;
  const r = spawnSync(process.execPath, [VERIFICAR, "--etiqueta", etiqueta, "--salida", carpeta], { encoding: "utf8", env });
  const ruta = join(carpeta, `resultado-${etiqueta}.json`);
  return { ...r, resultado: existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : null };
}

function acta(etiqueta: string) {
  const trabajo = mkdtempSync(join(carpeta, "acta-"));
  writeFileSync(join(trabajo, "resultado-diario.json"), readFileSync(join(carpeta, `resultado-${etiqueta}.json`)));
  return execFileSync(process.execPath, [VERIFICAR, "--acta", "--salida", trabajo], { encoding: "utf8" });
}

// Formato exacto de encrypt() en release d02ae0e: ENC1 + IV + tag + cuerpo.
// Sin id de clave ni AAD. Datos y clave generados por este test, nunca reales.
function cifrarProduccion(texto: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(K1, "base64"), iv);
  const cuerpo = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  return `decode('${Buffer.concat([Buffer.from("ENC1"), iv, cipher.getAuthTag(), cuerpo]).toString("hex")}', 'hex')`;
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

  // Prisma crea el esquema REAL de producción desde su instantánea exacta;
  // el verificador tiene un lector distinto, por lo que también se prueba
  // la detección de nombres físicos, camelCase, enums y tipos de columnas.
  const produccion = "ensayo_origen_produccion";
  psql(urlDeBaseDeTest(), `CREATE DATABASE ${produccion}`);
  basesCreadas.push(produccion);
  execFileSync(resolve("node_modules/.bin/prisma"), ["db", "push", "--schema", SCHEMA_PRODUCCION, "--skip-generate"], {
    env: { NODE_ENV: "test", PATH: process.env.PATH, DATABASE_URL: urlDe(produccion) }, stdio: "pipe",
  });
  respaldar("produccion-vacio", urlDe(produccion));
  psql(urlDe(produccion), `
    INSERT INTO organizaciones (id, nombre) VALUES ('org', 'Prueba');
    INSERT INTO usuarios (id, email, hashed_password, nombre, organization_id)
      VALUES ('usuario', 'prueba@example.invalid', 'ficticio', 'Prueba', 'org');
    INSERT INTO pacientes (id, nombre, apellido, telefono, tarifa, organization_id, actualizado_en)
      VALUES ('p1', 'Prueba', 'Uno', '', 1800, 'org', now()), ('p2', 'Prueba', 'Dos', '', 1800, 'org', now());
    INSERT INTO turnos (id, fecha, tarifa_cobrada, paciente_id, organization_id, actualizado_en)
      VALUES ('t1', '2024-01-01T12:00:00Z', 1800, 'p1', 'org', now()), ('t2', '2026-01-01T12:00:00Z', 1800, 'p2', 'org', now());
    INSERT INTO sesiones_clinicas (id, "turnoId", "organizationId", "createdAt", "updatedAt", nota_soap_encrypted, nota_soap_original_encrypted)
      VALUES ('z_nota_vieja', 't1', 'org', '2024-01-01T12:00:00Z', now(), ${cifrarProduccion(JSON.stringify(NOTA))}, ${cifrarProduccion(JSON.stringify(NOTA))}),
             ('a_nota_nueva', 't2', 'org', '2026-01-01T12:00:00Z', now(), ${cifrarProduccion(JSON.stringify(NOTA))}, ${cifrarProduccion(JSON.stringify(NOTA))});
    INSERT INTO paciente_contexto_clinico (id, paciente_id, organization_id, creado_en, actualizado_en,
      resumen_acumulativo_encrypted, hipotesis_diagnostica_encrypted, riesgos_historicos_encrypted)
      VALUES ('z_contexto_viejo', 'p1', 'org', '2024-01-01T12:00:00Z', now(), ${cifrarProduccion("Contexto ficticio privado")}, ${cifrarProduccion("Hipótesis ficticia")}, ${cifrarProduccion("[]")}),
             ('a_contexto_nuevo', 'p2', 'org', '2026-01-01T12:00:00Z', now(), ${cifrarProduccion("Contexto ficticio privado")}, ${cifrarProduccion("Hipótesis ficticia")}, ${cifrarProduccion("[]")});
  `);
  respaldar("produccion", urlDe(produccion));
}, 120_000);

afterAll(async () => {
  for (const b of basesCreadas) psql(urlDeBaseDeTest(), `DROP DATABASE IF EXISTS ${b}`);
  await base?.prisma.$disconnect();
  if (carpeta) rmSync(carpeta, { recursive: true, force: true });
});

it("un respaldo restaurado con tablas vacías hace fallar el ensayo", () => {
  const r = restaurar("vacio.dump.gpg", "ensayo_vacio");
  expect(r.status, r.stderr).toBe(0);
  const v = verificar(r.url, { [IDS]: "1" }, "vacio");
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

  it("modo workflow: pasa con solo los ids conocidos y no descifra nada", () => {
    const v = verificar(url, { [IDS]: "1" }, "diario");
    expect(v.status, v.stderr).toBe(0);
    expect(v.resultado.ok).toBe(true);
    expect(v.resultado.esquema).toBe("nuevo");
    expect(v.resultado.descifrado.modo).toBe("ids");
    const muestras = v.resultado.descifrado.muestras as { descifrada: boolean | null; ok: boolean; claveId: number }[];
    expect(muestras.length).toBe(4);
    expect(muestras.every((m) => m.descifrada === null && m.ok && m.claveId === 1)).toBe(true);
    expect(v.stdout).toContain("sin descifrar");
    expect(v.resultado.cifrado.clavesAusentes).toEqual([]);
    expect(v.resultado.tablas.problemas).toEqual([]);
    const informe = acta("diario");
    expect(informe).toContain("**Resultado de la verificación:** OK");
    expect(informe).toContain("**Esquema restaurado:** nuevo");
    expect(informe).toContain("| sesiones_clinicas | 1 |");
    expect(informe).toContain("formato ENC2");
  });

  it("modo manual: descifra al menos una nota clínica y una versión del Recorrido con la clave de su época", () => {
    const v = verificar(url, { [VARIABLE_LLAVERO]: `1=${K1}` }, "manual-ok");
    expect(v.status, v.stderr).toBe(0);
    expect(v.resultado.ok).toBe(true);
    const muestras = v.resultado.descifrado.muestras as { rotulo: string; tabla: string; id: string; claveId: number; descifrada: boolean | null }[];
    expect(muestras.filter((m) => m.rotulo === "nota clínica" && m.descifrada === true && m.tabla === "sesiones_clinicas" && m.id === sesionId && m.claveId === 1).length).toBeGreaterThan(0);
    expect(muestras.filter((m) => m.rotulo === "versión del Recorrido" && m.descifrada === true && m.tabla === "hilo_versiones" && m.id === versionId).length).toBeGreaterThan(0);
    // Nada clínico sale del script: ni en el log ni en el resultado.
    expect(v.stdout + v.stderr + JSON.stringify(v.resultado)).not.toContain("Solo debe existir cifrado");
    expect(JSON.stringify(v.resultado)).not.toContain('"subjetivo"');
  });

  it("sin ids conocidos ni llavero no hay ensayo", () => {
    const v = verificar(url, {}, "sin-nada");
    expect(v.status).toBe(1);
    expect(v.stderr).toContain(`falta ${IDS}`);
    expect(v.resultado).toBeNull();
  });

  it("modo workflow: un dato cifrado con una clave desconocida lo hace fallar, y no como corrupción", () => {
    const v = verificar(url, { [IDS]: "2" }, "mensual");
    expect(v.status).toBe(1);
    expect(v.stderr).toContain(`hay datos cifrados con la clave 1, que no figura en ${IDS}`);
    expect(v.stderr).toContain("clave retirada o desconocida");
    expect(v.stderr).not.toContain("dato corrupto");
    expect(v.resultado.cifrado.clavesAusentes).toEqual([1]);
    expect(v.resultado.descifrado.muestras.every((m: { ok: boolean; descifrada: null }) => !m.ok && m.descifrada === null)).toBe(true);
  });

  it("modo manual: si falta la clave de esa época lo dice así, y no como corrupción", () => {
    const v = verificar(url, { [VARIABLE_LLAVERO]: `2=${K2}` }, "sin-clave");
    expect(v.status).toBe(1);
    expect(v.stderr).toContain("falta la clave 1 en el llavero");
    expect(v.stderr).not.toContain("dato corrupto");
    expect(v.resultado.cifrado.clavesAusentes).toEqual([1]);
    expect(v.resultado.descifrado.muestras.every((m: { codigo: string }) => m.codigo === "clave_ausente")).toBe(true);
  });

  it("modo manual: con la clave equivocada bajo el mismo id no habla de clave ausente", () => {
    const v = verificar(url, { [VARIABLE_LLAVERO]: `1=${K3}` }, "equivocada");
    expect(v.status).toBe(1);
    expect(v.stderr).toContain("no descifra con la clave 1");
    expect(v.stderr).not.toContain("falta la clave");
    expect(v.resultado.descifrado.muestras.every((m: { codigo: string }) => m.codigo === "autenticacion")).toBe(true);
  });
});

describe("compatibilidad con el respaldo de producción d02ae0e", () => {
  let url: string;
  beforeAll(() => {
    const r = restaurar("produccion.dump.gpg", "ensayo_produccion");
    expect(r.status, r.stderr).toBe(0);
    url = r.url;
  });

  it("completa el automático con ENC1, tablas viejas y sus fechas; no inventa un id de clave", () => {
    const v = verificar(url, { [IDS]: "99" }, "produccion-auto");
    expect(v.status, v.stderr).toBe(0);
    expect(v.resultado.esquema).toBe("produccion-d02ae0e");
    expect(v.resultado.ok).toBe(true);
    expect(v.resultado.tablas.conteos.sesiones_clinicas).toBe(2);
    expect(v.resultado.tablas.conteos.paciente_contexto_clinico).toBe(2);
    expect(v.resultado.tablas.conteos).not.toHaveProperty("hilo_versiones");
    expect(v.resultado.tablas.conteos).not.toHaveProperty("hilos");
    expect(v.resultado.cifrado).toMatchObject({ formato: "ENC1", columnas: 8, sinId: 10, porClave: {}, otros: 0, clavesAusentes: [] });
    expect(v.resultado.descifrado.muestras.map((m: { id: string }) => m.id)).toEqual(["z_nota_vieja", "a_nota_nueva", "z_contexto_viejo", "a_contexto_nuevo"]);
    expect(v.resultado.descifrado.muestras.every((m: { claveId: null; ok: null; descifrada: null }) => m.claveId === null && m.ok === null && m.descifrada === null)).toBe(true);
    expect(v.resultado.fk.violaciones).toBe(0);
    expect(v.resultado.fk.constraints).toBeGreaterThan(0);
    const texto = acta("produccion-auto");
    expect(texto).toContain("**Resultado de la verificación:** OK");
    expect(texto).toContain("| paciente_contexto_clinico | 2 |");
    expect(texto).toContain("no puede identificar ni confirmar la clave");
    expect(texto).toContain("no conserva versiones históricas");
    expect(texto).not.toContain("clave conocida");
    expect(texto).not.toContain("falló antes de verificar");
  });

  it("el manual abre notas JSON y contextos de texto ENC1 con la clave que autentica, sin asumir id 1", () => {
    const v = verificar(url, { [VARIABLE_LLAVERO]: `2=${K2},7=${K1}` }, "produccion-manual");
    expect(v.status, v.stderr).toBe(0);
    expect(v.resultado.descifrado.muestras).toHaveLength(4);
    expect(v.resultado.descifrado.muestras.every((m: { claveId: number; descifrada: boolean; ok: boolean }) => m.claveId === 7 && m.descifrada && m.ok)).toBe(true);
    expect(v.stdout + v.stderr + JSON.stringify(v.resultado)).not.toContain("Contexto ficticio privado");
    expect(v.stdout + v.stderr + JSON.stringify(v.resultado)).not.toContain(K1);
  });

  it("sin la clave que abre ENC1 el manual falla sin adjudicarle una identidad inventada", () => {
    const v = verificar(url, { [VARIABLE_LLAVERO]: `2=${K2}` }, "produccion-sin-clave");
    expect(v.status).toBe(1);
    expect(v.resultado.ok).toBe(false);
    expect(v.stderr).toContain("ENC1 no descifra con ninguna clave del llavero");
    expect(v.resultado.descifrado.muestras.every((m: { claveId: null; codigo: string }) => m.claveId === null && m.codigo === "autenticacion")).toBe(true);
  });

  it("usa la nota original y el JSON de riesgos cuando son el contenido disponible", () => {
    const r = restaurar("produccion.dump.gpg", "ensayo_produccion_alternativas");
    expect(r.status, r.stderr).toBe(0);
    psql(r.url, "UPDATE sesiones_clinicas SET nota_soap_encrypted = NULL",
      "UPDATE paciente_contexto_clinico SET resumen_acumulativo_encrypted = NULL, hipotesis_diagnostica_encrypted = NULL");
    const v = verificar(r.url, { [VARIABLE_LLAVERO]: `7=${K1}` }, "produccion-alternativas");
    expect(v.status, v.stderr).toBe(0);
    expect(v.resultado.descifrado.muestras.map((m: { columna: string }) => m.columna)).toEqual([
      "nota_soap_original_encrypted", "nota_soap_original_encrypted", "riesgos_historicos_encrypted", "riesgos_historicos_encrypted",
    ]);
    expect(v.resultado.descifrado.muestras.every((m: { descifrada: boolean }) => m.descifrada)).toBe(true);
  });

  it("un esquema viejo vacío produce conteos y problemas reales en el acta", () => {
    const r = restaurar("produccion-vacio.dump.gpg", "ensayo_produccion_vacio");
    expect(r.status, r.stderr).toBe(0);
    const v = verificar(r.url, { [IDS]: "1" }, "produccion-vacio");
    expect(v.status).toBe(1);
    expect(v.resultado.esquema).toBe("produccion-d02ae0e");
    expect(v.resultado.tablas.conteos.paciente_contexto_clinico).toBe(0);
    expect(v.stderr).toContain("tabla sesiones_clinicas vacía: 0 filas");
    expect(v.stderr).toContain("no hay contexto longitudinal en la copia");
    const texto = acta("produccion-vacio");
    expect(texto).toContain("**Resultado de la verificación:** FALLÓ");
    expect(texto).toContain("| sesiones_clinicas | 0 |");
    expect(texto).toContain("tabla paciente_contexto_clinico vacía");
    expect(texto).not.toContain("sin generar un resultado detallado");
  });

  it("rechaza un blob alterado aunque el esquema viejo sea conocido", () => {
    const r = restaurar("produccion.dump.gpg", "ensayo_produccion_corrupto");
    expect(r.status, r.stderr).toBe(0);
    psql(r.url, "UPDATE sesiones_clinicas SET nota_soap_encrypted = decode('00000000', 'hex')");
    const v = verificar(r.url, { [IDS]: "1" }, "produccion-corrupto");
    expect(v.status).toBe(1);
    expect(v.resultado.esquema).toBe("produccion-d02ae0e");
    expect(v.resultado.cifrado.otros).toBe(2);
    expect(v.stderr).toContain("sin prefijo ENC1 o demasiado cortos");
  });
});

it.each([
  ["bueno.dump.gpg", "ALTER TABLE sesiones_clinicas RENAME COLUMN creada_en TO fecha_ajena"],
  ["bueno.dump.gpg", "ALTER TABLE pacientes DROP COLUMN telefono"],
  ["bueno.dump.gpg", "ALTER TABLE sesiones_clinicas ALTER COLUMN nota_final_encrypted TYPE text USING 'ajeno'"],
  ["produccion.dump.gpg", "ALTER TABLE sesiones_clinicas RENAME COLUMN \"createdAt\" TO creada_en"],
  ["produccion.dump.gpg", "CREATE TABLE hilos (id text)"],
  ["produccion.dump.gpg", "DROP TABLE recordatorios"],
])("rechaza una estructura desconocida y lo publica como resultado: %s / %s", (archivo, cambio) => {
  const r = restaurar(archivo, "ensayo_esquema_desconocido");
  expect(r.status, r.stderr).toBe(0);
  psql(r.url, cambio);
  const v = verificar(r.url, { [IDS]: "1" }, "desconocido");
  expect(v.status).toBe(1);
  expect(v.resultado).toMatchObject({ esquema: "desconocido", ok: false, tablas: null, cifrado: null, descifrado: null, fk: null });
  expect(v.stderr).toContain("esquema restaurado desconocido");
  const texto = acta("desconocido");
  expect(texto).toContain("**Resultado de la verificación:** FALLÓ");
  expect(texto).toContain("esquema restaurado desconocido");
  expect(texto).not.toContain("sin generar un resultado detallado");
  expect(texto).not.toContain("falló al abrirse");
});

it("el guion manual restaura, descifra y verifica en una base local", () => {
  basesCreadas.push("ensayo_manual");
  const r = spawnSync("bash", [MANUAL, join(carpeta, "bueno.dump.gpg")], {
    cwd: carpeta, encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH, PG_BIN: process.env.PG_BIN ?? "", DATABASE_URL: urlDeBaseDeTest(), BACKUP_ENCRYPTION_KEY: PASSPHRASE, [VARIABLE_LLAVERO]: `1=${K1}`, GNUPGHOME: join(carpeta, "gnupg") },
  });
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("descifrada y leída");
  expect(r.stdout).toContain("restauración verificada: OK");
  const resultado = JSON.parse(readFileSync(join(carpeta, "resultado-manual.json"), "utf8"));
  expect(resultado.ok).toBe(true);
  expect(resultado.descifrado.modo).toBe("llavero");
  expect(resultado.descifrado.muestras.every((m: { descifrada: boolean }) => m.descifrada === true)).toBe(true);
  // Se niega a restaurar sobre un servidor que no sea local.
  const remoto = spawnSync("bash", [MANUAL, join(carpeta, "bueno.dump.gpg")], {
    cwd: carpeta, encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH, DATABASE_URL: "postgresql://u:p@ep-algo.neon.tech/neondb", BACKUP_ENCRYPTION_KEY: PASSPHRASE, [VARIABLE_LLAVERO]: `1=${K1}` },
  });
  expect(remoto.status).toBe(1);
  expect(remoto.stderr).toContain("solo restaura en una base local");
});

it("una nota alterada en la copia hace fallar el ensayo como corrupción", () => {
  const r = restaurar("bueno.dump.gpg", "ensayo_alterado");
  expect(r.status, r.stderr).toBe(0);
  // Se altera el último byte del ciphertext: el prefijo y el id de clave quedan
  // intactos. Se INVIERTE un bit (`# 1`, el xor de Postgres) en vez de fijarlo
  // en cero: el ciphertext es aleatorio, así que una de cada 256 corridas ese
  // byte ya era cero, la "alteración" no alteraba nada, el verificador
  // respondía OK y el test fallaba con "expected +0 to be 1". Pasó en el CI de
  // main el 19/9. Invertido, el byte siempre queda distinto. Es lo mismo que
  // ya hacía encryption.test.ts:102 (`alterado[...] ^= 0x01`).
  psql(r.url, `UPDATE sesiones_clinicas SET nota_final_encrypted = set_byte(nota_final_encrypted, length(nota_final_encrypted) - 1, get_byte(nota_final_encrypted, length(nota_final_encrypted) - 1) # 1) WHERE id = '${sesionId}'`);
  const v = verificar(r.url, { [VARIABLE_LLAVERO]: `1=${K1}` }, "alterado");
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

describe("el workflow prueba también una copia mensual y no pide ninguna clave clínica", () => {
  type Paso = { name?: string; run?: string; if?: string; env?: Record<string, string> };
  const { load } = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => { jobs: { ensayo: { steps: Paso[] } } } };
  const pasos = load(readFileSync(WORKFLOW, "utf8")).jobs.ensayo.steps;
  const paso = (nombre: string) => {
    const p = pasos.find((p) => p.name === nombre);
    if (!p) throw new Error(`Falta el paso "${nombre}"`);
    return p;
  };
  it.each([
    { falta: "mensual", noAbre: "" },
    { falta: "diario", noAbre: "" },
    { falta: "", noAbre: "" },
    { falta: "", noAbre: "diario" },
    { falta: "", noAbre: "mensual" },
  ])("YAML con aws simulado y restauración real: falta=$falta, noAbre=$noAbre", ({ falta, noAbre }) => {
    const trabajo = mkdtempSync(join(carpeta, "workflow-"));
    symlinkSync(resolve("scripts"), join(trabajo, "scripts"));
    const binarios = join(trabajo, "bin");
    mkdirSync(binarios);
    // Solo R2 es simulado. El guion, gpg, Postgres y el verificador son reales.
    writeFileSync(join(binarios, "aws"), `#!${process.execPath}
const { copyFileSync, appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const opcion = (n) => args[args.indexOf(n) + 1];
const etiqueta = process.env.ETIQUETA;
appendFileSync("aws.jsonl", JSON.stringify({ etiqueta, args }) + "\\n");
if (args[0] === "s3api" && args[1] === "list-objects-v2") {
  console.log(etiqueta === process.env.FALTA ? "None" : opcion("--prefix") + "prueba.dump.gpg");
} else if (args[0] === "s3api" && args[1] === "head-object") {
  console.log("2026-09-16T06:00:00+00:00");
} else if (args[0] === "s3" && args[1] === "cp") {
  copyFileSync(etiqueta === process.env.NO_ABRE ? process.env.TRUNCADO : process.env.BUENO, args[3]);
} else {
  throw new Error("Operación inesperada: " + args.join(" "));
}
`, { mode: 0o755 });
    for (const etiqueta of ["diario", "mensual"]) {
      const nombre = `ensayo_${etiqueta}`;
      psql(urlDeBaseDeTest(), `DROP DATABASE IF EXISTS ${nombre}`);
      if (!basesCreadas.includes(nombre)) basesCreadas.push(nombre);
    }
    const servidor = new URL(urlDeBaseDeTest());
    servidor.pathname = "";
    const r = spawnSync("bash", ["-euo", "pipefail", "-c", paso("Ensayar las dos copias por separado").run!], {
      cwd: trabajo, encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${binarios}:${process.env.PATH}`, PG_BIN: process.env.PG_BIN ?? "/usr/bin",
        PG_URL: servidor.toString().replace(/\/$/, ""),
        BACKUP_ENCRYPTION_KEY: PASSPHRASE, GNUPGHOME: join(carpeta, "gnupg"), [IDS]: "1",
        R2_BUCKET: "bucket-simulado", R2_ENDPOINT: "https://r2.invalid",
        FALTA: falta, NO_ABRE: noAbre,
        BUENO: join(carpeta, "bueno.dump.gpg"), TRUNCADO: join(carpeta, "truncado.dump.gpg"),
      },
    });
    expect(r.status, r.stderr).toBe(falta || noAbre ? 1 : 0);
    const llamadas = readFileSync(join(trabajo, "aws.jsonl"), "utf8").trim().split("\n")
      .map((l) => JSON.parse(l) as { etiqueta: string; args: string[] });
    for (const etiqueta of ["diario", "mensual"]) {
      const estado = JSON.parse(readFileSync(join(trabajo, `estado-${etiqueta}.json`), "utf8"));
      const ruta = join(trabajo, `resultado-${etiqueta}.json`);
      if (etiqueta === falta || etiqueta === noAbre) {
        expect(estado.etapa).toBe(etiqueta === falta ? "no_existe" : "apertura");
        expect(estado.codigo).toBe(1);
        expect(existsSync(ruta)).toBe(false);
      } else {
        expect(estado.etapa).toBe("completado");
        expect(estado.codigo).toBe(0);
        const resultado = JSON.parse(readFileSync(ruta, "utf8"));
        expect(resultado.ok).toBe(true);
        expect(resultado.tablas.conteos.sesiones_clinicas).toBe(1);
        expect(resultado.tablas.conteos.hilo_versiones).toBe(1);
        expect(resultado.descifrado.muestras).toHaveLength(4);
      }
      expect(llamadas.filter((l) => l.etiqueta === etiqueta && l.args[0] === "s3")).toHaveLength(etiqueta === falta ? 0 : 1);
    }
    const acta = execFileSync(process.execPath, [VERIFICAR, "--acta", "--salida", trabajo], { encoding: "utf8" });
    expect(acta.match(/\*\*Resultado de la verificación:\*\* OK/g)).toHaveLength(falta || noAbre ? 1 : 2);
    if (falta) expect(acta).toContain("No existe la copia bajo el prefijo consultado");
    if (noAbre) expect(acta).toContain("La copia falló al abrirse o restaurarse");
    expect(acta).not.toContain("descifrado gpg");
    expect(acta).not.toContain("La causa es desconocida");
  });
  it("no recibe ninguna clave clínica: solo ids, y solo los secrets del respaldo y del aviso", () => {
    const texto = readFileSync(WORKFLOW, "utf8");
    const secrets = new Set([...texto.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]));
    expect([...secrets].sort()).toEqual(["ALERTA_CORREO", "BACKUP_ENCRYPTION_KEY", "GITHUB_TOKEN", "R2_ACCESS_KEY_ID", "R2_BUCKET", "R2_ENDPOINT", "R2_SECRET_ACCESS_KEY", "RESEND_API_KEY"]);
    expect(texto).not.toMatch(/^\s+CLAVES_CIFRADO:/m);
    expect(texto).toContain(`${IDS}: \${{ vars.${IDS} }}`);
  });

  // El ensayo corría el día 1 "una hora después del backup de ese día", y eso
  // era falso: el respaldo está agendado a las 06:00 UTC pero GitHub demora
  // los schedule, y sus 25 corridas programadas arrancaron entre las 10:23 y
  // las 12:26 UTC. El ensayo del día 1 miraba un bucket al que el respaldo de
  // ese día todavía no había llegado. Ahora corre el día 2, y el acta le dice
  // al dueño cuándo vuelve a mirarse: si alguien cambia el cron y no el acta,
  // el documento que registra el estado de los respaldos empieza a mentir.
  it("el día que anuncia el acta es el día en que el ensayo realmente corre", () => {
    const cron = readFileSync(WORKFLOW, "utf8").match(/^\s*- cron: "(\S+) (\S+) (\S+) (\S+) (\S+)"/m);
    expect(cron, "No se encontró el cron del ensayo").toBeTruthy();
    const [, , , diaDelMes, mes, diaDeSemana] = cron!;
    expect([mes, diaDeSemana], "el ensayo tiene que ser mensual").toEqual(["*", "*"]);
    const anunciado = readFileSync(VERIFICAR, "utf8").match(/^const DIA_ENSAYO = (\d+);$/m);
    expect(anunciado, "Falta DIA_ENSAYO en verificar-restauracion.mjs").toBeTruthy();
    expect(anunciado![1]).toBe(diaDelMes);
    // Y el día 1 no vuelve: el respaldo del mes puede no haber llegado.
    expect(Number(diaDelMes)).toBeGreaterThan(1);
  });
});
