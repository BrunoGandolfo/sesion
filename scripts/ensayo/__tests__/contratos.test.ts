// El mapa migración → contrato de scripts/ensayo/contratos.mjs dice la verdad,
// y el verificador elige el contrato por la migración de la copia, contra el
// esquema de release, nunca contra el del checkout.
//
// Es de integración: necesita el Postgres 17 de test (DATABASE_URL_TEST,
// superusuario: crea y borra bases ensayo_contrato_*) y psql. En la suite
// unitaria se saltea (VITEST_SUITE=unit); vitest.config.ts no es de este
// territorio, y su lista INTEGRACION todavía no lo nombra.

import { execFileSync, spawnSync } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { urlDeBaseDeTest } from "../../../src/lib/__tests__/db-test";
import * as contratos from "../contratos.mjs";

const { CONTRATO_ACTUAL, contratoDelSchema, diferencias, firma } = contratos;
const CONTRATO_POR_MIGRACION: Record<string, string> = contratos.CONTRATO_POR_MIGRACION;
const CONTRATOS: Record<string, { archivo: string | null }> = contratos.CONTRATOS;

const VERIFICAR = resolve("scripts/ensayo/verificar-restauracion.mjs");
const WORKFLOW = resolve(".github/workflows/ensayo-restauracion.yml");
const MIGRACIONES = resolve("prisma/migrations");
const bin = (nombre: string) => (process.env.PG_BIN ? join(process.env.PG_BIN, nombre) : nombre);

const urlDe = (nombreBase: string) => {
  const url = new URL(urlDeBaseDeTest());
  url.pathname = `/${nombreBase}`;
  return url.toString();
};
const psql = (url: string, sql: string) =>
  execFileSync(bin("psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql, url], { encoding: "utf8", stdio: "pipe" }).trim();
const psqlArchivo = (url: string, archivo: string) =>
  execFileSync(bin("psql"), ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", archivo, url], { stdio: "pipe" });

const bases: string[] = [];
function crearBase(nombre: string, plantilla?: string) {
  psql(urlDeBaseDeTest(), `DROP DATABASE IF EXISTS ${nombre}`);
  // Copiar de una plantilla falla si alguien está conectado a ella, y el
  // autovacuum de Postgres a veces lo está un instante: se reintenta.
  for (let intento = 1; ; intento++) {
    try {
      psql(urlDeBaseDeTest(), `CREATE DATABASE ${nombre}${plantilla ? ` TEMPLATE ${plantilla}` : ""}`);
      break;
    } catch (error) {
      if (!plantilla || intento === 5 || !String((error as { stderr?: string }).stderr).includes("being accessed by other users")) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  if (!bases.includes(nombre)) bases.push(nombre);
  return urlDe(nombre);
}

/** Catálogo físico de la base, como lo lee el verificador. */
function catalogo(url: string) {
  return JSON.parse(psql(url, `SELECT coalesce(json_object_agg(tabla, columnas), '{}') FROM (
    SELECT t.table_name AS tabla,
      coalesce(json_object_agg(c.column_name, c.udt_name) FILTER (WHERE c.column_name IS NOT NULL), '{}') AS columnas
    FROM information_schema.tables t LEFT JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name <> '_prisma_migrations'
    GROUP BY t.table_name) s`));
}

const migracionesDelRepo = () => readdirSync(MIGRACIONES).filter((m) => existsSync(join(MIGRACIONES, m, "migration.sql"))).sort();

describe.skipIf(process.env.VITEST_SUITE === "unit")("contratos del ensayo", () => {
  let carpeta: string;
  /** Base con TODAS las migraciones aplicadas por Prisma, como producción. */
  const PLANTILLA = "ensayo_contrato_plantilla";

  beforeAll(() => {
    carpeta = mkdtempSync(join(tmpdir(), "sesion-contratos-"));
    const url = crearBase(PLANTILLA);
    execFileSync(resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
      env: { NODE_ENV: "test", PATH: process.env.PATH, DATABASE_URL: url }, stdio: "pipe",
    });
  }, 120_000);

  afterAll(() => {
    for (const b of bases) psql(urlDeBaseDeTest(), `DROP DATABASE IF EXISTS ${b}`);
    if (carpeta) rmSync(carpeta, { recursive: true, force: true });
  });

  describe("el mapa", () => {
    it("la última migración del repo tiene contrato, y es el actual", () => {
      const ultima = migracionesDelRepo().at(-1)!;
      expect(CONTRATO_POR_MIGRACION[ultima], `${ultima} no está en scripts/ensayo/contratos.mjs`).toBe(CONTRATO_ACTUAL);
    });

    it("toda migración del repo desde la reconstrucción tiene contrato", () => {
      const desde = "20260918120000_grabador_restaurado";
      const sinContrato = migracionesDelRepo().filter((m) => m >= desde && !CONTRATO_POR_MIGRACION[m]);
      expect(sinContrato).toEqual([]);
    });

    it("todo contrato congelado existe y todo id del mapa es un contrato", () => {
      for (const id of new Set(Object.values(CONTRATO_POR_MIGRACION))) expect(CONTRATOS).toHaveProperty(id);
      for (const [id, c] of Object.entries(CONTRATOS)) {
        if (id === CONTRATO_ACTUAL) expect(c.archivo).toBeNull();
        else expect(existsSync(resolve(c.archivo!)), `${id}: falta ${c.archivo}`).toBe(true);
      }
    });

    // La historia vieja (producción hasta el 17-sep) no está en este repo: su
    // única entrada se comprobó a mano aplicando las migraciones de d02ae0e.
    const delRepo = Object.entries(CONTRATO_POR_MIGRACION).filter(([m]) => existsSync(join(MIGRACIONES, m)));

    it.each(delRepo)("aplicar hasta %s deja exactamente el contrato %s", (migracion, id) => {
      const url = crearBase("ensayo_contrato_hasta");
      for (const m of migracionesDelRepo().filter((m) => m <= migracion)) psqlArchivo(url, join(MIGRACIONES, m, "migration.sql"));
      const archivo = CONTRATOS[id].archivo ?? "prisma/schema.prisma";
      const contrato = contratoDelSchema(readFileSync(resolve(archivo), "utf8"));
      const real = catalogo(url);
      expect(diferencias(real, contrato)).toEqual([]);
      expect(firma(real)).toBe(firma(contrato));
    });
  });

  describe("el verificador elige por la migración de la copia", () => {
    /** Una copia con filas mínimas y todas las muestras ENC2 con la clave 1. */
    let COPIA: string;
    beforeAll(() => {
      COPIA = "ensayo_contrato_copia";
      const url = crearBase(COPIA, PLANTILLA);
      sembrar(url, [{ clave: 1, fecha: "2026-09-20" }]);
    });

    function verificar(url: string, env: Record<string, string> = {}, etiqueta = "contrato") {
      const r = spawnSync(process.execPath, [VERIFICAR, "--etiqueta", etiqueta, "--salida", carpeta], {
        encoding: "utf8",
        env: { NODE_ENV: "test", PATH: process.env.PATH, PG_BIN: process.env.PG_BIN ?? "", DATABASE_URL: url, CLAVES_CIFRADO_IDS: "1", ...env },
      });
      const ruta = join(carpeta, `resultado-${etiqueta}.json`);
      return { ...r, resultado: existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : null };
    }

    it("una copia con todas las migraciones da el contrato actual, y dice por qué", () => {
      const v = verificar(urlDe(COPIA));
      expect(v.status, v.stderr).toBe(0);
      expect(v.resultado.esquema).toBe(CONTRATO_ACTUAL);
      expect(v.resultado.contrato.migracion).toBe(migracionesDelRepo().at(-1));
      expect(v.stdout).toContain(`contrato elegido por su última migración, ${migracionesDelRepo().at(-1)}`);
    });

    it("una copia del 22 o del 28 de septiembre (sin la migración del recifrado) también es conocida", () => {
      for (const ultima of ["20260923120100_turnos_pago_fecha_idx", "20260924120000_eventos_auditoria_accion_idx"]) {
        const url = crearBase("ensayo_contrato_vieja", COPIA);
        psql(url, `DELETE FROM _prisma_migrations WHERE migration_name > '${ultima}'`);
        const v = verificar(url);
        expect(v.status, v.stderr).toBe(0);
        expect(v.resultado.esquema).toBe(CONTRATO_POR_MIGRACION[ultima]);
        expect(v.resultado.contrato.migracion).toBe(ultima);
      }
    });

    it("una copia cuyo esquema no corresponde a su migración es desconocida", () => {
      const url = crearBase("ensayo_contrato_distinta", COPIA);
      psql(url, "ALTER TABLE pacientes DROP COLUMN telefono");
      const v = verificar(url);
      expect(v.status).toBe(1);
      expect(v.resultado.esquema).toBe("desconocido");
      expect(v.stderr).toContain(`esquema restaurado desconocido: no corresponde a su última migración, ${migracionesDelRepo().at(-1)}`);
      expect(v.stderr).toContain("falta pacientes.telefono");
    });

    it("aunque coincida EXACTAMENTE con otro contrato: el esquema de d02ae0e con una migración nueva es desconocido", () => {
      const url = crearBase("ensayo_contrato_otro");
      execFileSync(resolve("node_modules/.bin/prisma"), ["db", "push", "--schema", "scripts/ensayo/esquema-produccion.prisma", "--skip-generate"], {
        env: { NODE_ENV: "test", PATH: process.env.PATH, DATABASE_URL: url }, stdio: "pipe",
      });
      const ultima = migracionesDelRepo().at(-1)!;
      // Sin _prisma_migrations, la firma lo reconoce como d02ae0e…
      expect(verificar(url).resultado.contrato).toMatchObject({ id: "produccion-d02ae0e", migracion: null });
      // …pero si la copia dice tener aplicada la última migración nueva, no.
      psql(url, `CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
        migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(),
        applied_steps_count integer NOT NULL DEFAULT 0);
        INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at) VALUES ('x', 'x', '${ultima}', now())`);
      const v = verificar(url);
      expect(v.status).toBe(1);
      expect(v.resultado.esquema).toBe("desconocido");
      expect(v.stderr).toContain(`no corresponde a su última migración, ${ultima} (contrato ${CONTRATO_POR_MIGRACION[ultima]})`);
    });

    it("sin el checkout de release no verifica nada y dice por qué", () => {
      const v = verificar(urlDe(COPIA), { RAIZ_RELEASE: join(carpeta, "no-existe") }, "sin-release");
      expect(v.status).toBe(1);
      expect(v.stderr).toContain("el checkout de release falta o está vacío");
      expect(v.resultado).toBeNull();
    });

    it("una migración sin contrato, o empezada y sin terminar, da desconocido", () => {
      const url = crearBase("ensayo_contrato_futura", COPIA);
      psql(url, `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
        VALUES ('x', 'x', '20991231000000_futura', now(), now(), 1)`);
      let v = verificar(url);
      expect(v.status).toBe(1);
      expect(v.stderr).toContain("su última migración, 20991231000000_futura, no tiene contrato");
      psql(url, `UPDATE _prisma_migrations SET finished_at = NULL WHERE id = 'x'`);
      v = verificar(url);
      expect(v.status).toBe(1);
      expect(v.stderr).toContain("migraciones empezadas y sin terminar: 20991231000000_futura");
    });

    it("el contrato actual sale de RAIZ_RELEASE, no del checkout", () => {
      // Un release que todavía no tiene la última migración del checkout:
      // la copia que sí la tiene no puede compararse contra nada publicado.
      const release = mkdtempSync(join(carpeta, "release-"));
      cpSync(resolve("prisma"), join(release, "prisma"), { recursive: true });
      const ultima = migracionesDelRepo().at(-1)!;
      rmSync(join(release, "prisma/migrations", ultima), { recursive: true });
      let v = verificar(urlDe(COPIA), { RAIZ_RELEASE: release });
      expect(v.status).toBe(1);
      expect(v.stderr).toContain(`su última migración, ${ultima}, no está en el release publicado`);

      // Y un release cuyo schema.prisma difiere del checkout manda él.
      cpSync(resolve("prisma/migrations", ultima), join(release, "prisma/migrations", ultima), { recursive: true });
      const schema = readFileSync(join(release, "prisma/schema.prisma"), "utf8")
        .replace(/^(model Paciente \{\n)/m, "$1  soloEnRelease String? @map(\"solo_en_release\")\n");
      writeFileSync(join(release, "prisma/schema.prisma"), schema);
      v = verificar(urlDe(COPIA), { RAIZ_RELEASE: release });
      expect(v.status).toBe(1);
      expect(v.stderr).toContain("falta pacientes.solo_en_release");
      const url = crearBase("ensayo_contrato_release", COPIA);
      psql(url, "ALTER TABLE pacientes ADD COLUMN solo_en_release text");
      v = verificar(url, { RAIZ_RELEASE: release });
      expect(v.status, v.stderr).toBe(0);
    });
  });

  describe("claves históricas", () => {
    function verificar(url: string, env: Record<string, string>, etiqueta: string) {
      const r = spawnSync(process.execPath, [VERIFICAR, "--etiqueta", etiqueta, "--salida", carpeta], {
        encoding: "utf8",
        env: { NODE_ENV: "test", PATH: process.env.PATH, PG_BIN: process.env.PG_BIN ?? "", DATABASE_URL: url, ...env },
      });
      const ruta = join(carpeta, `resultado-${etiqueta}.json`);
      return { ...r, resultado: existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : null };
    }
    const acta = (etiqueta: string) => {
      const trabajo = mkdtempSync(join(carpeta, "acta-"));
      writeFileSync(join(trabajo, "resultado-mensual.json"), readFileSync(join(carpeta, `resultado-${etiqueta}.json`)));
      return execFileSync(process.execPath, [VERIFICAR, "--acta", "--salida", trabajo], { encoding: "utf8" });
    };

    type Muestra = { claveId: number; ok: boolean | null; descifrada: boolean | null; historica?: boolean; cual: string };
    let clave1: string, clave2: string, mezclada: string;

    beforeAll(() => {
      // Antes del recifrado del 29-sep (todo con la 1), después (todo con la 2)
      // y una copia a medio recifrar: lo viejo con la 1, lo nuevo con la 2.
      clave1 = crearBase("ensayo_contrato_clave1", PLANTILLA);
      sembrar(clave1, [{ clave: 1, fecha: "2026-09-20" }, { clave: 1, fecha: "2026-09-27" }]);
      clave2 = crearBase("ensayo_contrato_clave2", PLANTILLA);
      sembrar(clave2, [{ clave: 2, fecha: "2026-09-20" }, { clave: 2, fecha: "2026-09-30" }]);
      mezclada = crearBase("ensayo_contrato_mezclada", PLANTILLA);
      sembrar(mezclada, [{ clave: 1, fecha: "2026-09-20" }, { clave: 2, fecha: "2026-09-30" }]);
    });

    it("copia con clave 1, la 1 histórica: esquema conocido y 'clave histórica no disponible: id 1', sin fallar", () => {
      const v = verificar(clave1, { CLAVES_CIFRADO_IDS: "2", CLAVES_HISTORICAS_IDS: "1" }, "clave1");
      expect(v.status, v.stderr).toBe(0);
      expect(v.resultado).toMatchObject({ esquema: CONTRATO_ACTUAL, ok: true, problemas: [] });
      expect(v.resultado.cifrado.clavesAusentes).toEqual([]);
      const blobs = v.resultado.cifrado.porClave[1];
      expect(blobs).toBeGreaterThan(0);
      expect(v.resultado.avisos).toEqual([`clave histórica no disponible: id 1, ${blobs} blobs`]);
      expect(v.stdout).toContain(`clave histórica no disponible: id 1, ${blobs} blobs`);
      expect((v.resultado.descifrado.muestras as Muestra[]).every((m) => m.historica && m.ok === null && m.descifrada === null)).toBe(true);
      const texto = acta("clave1");
      expect(texto).toContain("**Resultado de la verificación:** OK");
      expect(texto).toContain(`Clave histórica no disponible: id 1, ${blobs} blobs.`);
    });

    it("copia con clave 2: 4/4 muestras con clave conocida", () => {
      const v = verificar(clave2, { CLAVES_CIFRADO_IDS: "2", CLAVES_HISTORICAS_IDS: "1" }, "clave2");
      expect(v.status, v.stderr).toBe(0);
      expect(v.resultado.avisos).toEqual([]);
      expect(v.stdout).toContain("muestras con clave conocida: 4/4");
    });

    it("copia mezclada: avisa la histórica y verifica las de la clave presente", () => {
      const v = verificar(mezclada, { CLAVES_CIFRADO_IDS: "2", CLAVES_HISTORICAS_IDS: "1" }, "mezclada");
      expect(v.status, v.stderr).toBe(0);
      expect(v.resultado.avisos).toEqual([`clave histórica no disponible: id 1, ${v.resultado.cifrado.porClave[1]} blobs`]);
      const muestras = v.resultado.descifrado.muestras as Muestra[];
      expect(muestras.filter((m) => m.cual === "más vieja").every((m) => m.claveId === 1 && m.historica)).toBe(true);
      expect(muestras.filter((m) => m.cual === "más nueva").every((m) => m.claveId === 2 && m.ok === true)).toBe(true);
    });

    it("manual: descifra lo de la clave presente y no intenta lo histórico", () => {
      const v = verificar(mezclada, { CLAVES_CIFRADO: `2=${CLAVE_2}`, CLAVES_HISTORICAS_IDS: "1" }, "manual-mezclada");
      expect(v.status, v.stderr).toBe(0);
      const muestras = v.resultado.descifrado.muestras as Muestra[];
      expect(muestras.filter((m) => m.claveId === 2).every((m) => m.descifrada === true)).toBe(true);
      expect(muestras.filter((m) => m.claveId === 1).every((m) => m.historica && m.descifrada === null)).toBe(true);
      expect(v.stdout).toContain("muestras descifradas: 2/4, de clave histórica: 2");
    });

    it("manual: falla si una clave presente no descifra, aunque haya históricas", () => {
      const otra = Buffer.alloc(32, 7).toString("base64");
      const v = verificar(mezclada, { CLAVES_CIFRADO: `2=${otra}`, CLAVES_HISTORICAS_IDS: "1" }, "manual-equivocada");
      expect(v.status).toBe(1);
      expect(v.stderr).toContain("no descifra con la clave 2");
      expect(v.resultado.problemas.some((p: string) => p.includes("clave 1"))).toBe(false);
    });

    it("sin declararla histórica, la clave 1 sigue siendo un fallo; y no puede ser histórica y disponible a la vez", () => {
      let v = verificar(clave1, { CLAVES_CIFRADO_IDS: "2" }, "clave1-sin-historica");
      expect(v.status).toBe(1);
      expect(v.resultado.cifrado.clavesAusentes).toEqual([1]);
      v = verificar(clave1, { CLAVES_CIFRADO_IDS: "1,2", CLAVES_HISTORICAS_IDS: "1" }, "ambas");
      expect(v.status).toBe(1);
      expect(v.stderr).toContain("CLAVES_HISTORICAS_IDS: 1 también figura entre las claves disponibles");
      expect(v.resultado).toBeNull();
    });
  });

  it("el workflow compara contra release: checkout de release en la carpeta de RAIZ_RELEASE", () => {
    type Paso = { name?: string; uses?: string; with?: Record<string, string> };
    const { load } = createRequire(import.meta.url)("js-yaml") as {
      load: (s: string) => { jobs: { ensayo: { env: Record<string, string>; steps: Paso[] } } };
    };
    const job = load(readFileSync(WORKFLOW, "utf8")).jobs.ensayo;
    const raiz = job.env.RAIZ_RELEASE;
    expect(raiz).toBe("${{ github.workspace }}/publicado");
    const checkouts = job.steps.filter((p) => p.uses?.startsWith("actions/checkout@"));
    const release = checkouts.filter((p) => p.with?.ref === "release");
    expect(release).toHaveLength(1);
    expect(raiz.endsWith(`/${release[0].with!.path}`)).toBe(true);
    // Ningún otro checkout trae prisma/ a esa carpeta.
    expect(checkouts.filter((p) => p.with?.path === release[0].with!.path)).toHaveLength(1);
  });
});

// ─── Siembra ────────────────────────────────────────────────────────────────

const CLAVE_1 = Buffer.alloc(32, 1).toString("base64");
const CLAVE_2 = Buffer.alloc(32, 2).toString("base64");
const CLAVES: Record<number, string> = { 1: CLAVE_1, 2: CLAVE_2 };

/** ENC2 como src/lib/encryption.ts: "ENC2" | id | IV | tag | ciphertext, AAD tabla:columna:id. */
function enc2(clave: number, tabla: string, columna: string, id: string, valor: unknown) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(CLAVES[clave], "base64"), iv);
  c.setAAD(Buffer.from(`${tabla}:${columna}:${id}`, "utf8"));
  const cuerpo = Buffer.concat([c.update(JSON.stringify(valor), "utf8"), c.final()]);
  return `decode('${Buffer.concat([Buffer.from("ENC2"), Buffer.from([clave]), iv, c.getAuthTag(), cuerpo]).toString("hex")}', 'hex')`;
}

/** Una organización, y por cada entrada un paciente con turno, nota aprobada
 *  e hilo con una versión, cifrados con esa clave y fechados ese día. */
function sembrar(url: string, filas: { clave: number; fecha: string }[]) {
  const nota = { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" };
  const sentencias = [
    `INSERT INTO organizaciones (id, nombre) VALUES ('org', 'Prueba')`,
    `INSERT INTO usuarios (id, email, hashed_password, nombre, organization_id) VALUES ('u', 'prueba@example.invalid', 'x', 'Prueba', 'org')`,
  ];
  filas.forEach(({ clave, fecha }, i) => {
    const [p, t, s, v] = [`p${i}`, `t${i}`, `s${i}`, `v${i}`];
    sentencias.push(
      `INSERT INTO pacientes (id, nombre, apellido, telefono, tarifa, organization_id, actualizado_en) VALUES ('${p}', 'P', '${i}', '', 1, 'org', now())`,
      `INSERT INTO turnos (id, fecha, tarifa_cobrada, paciente_id, organization_id, actualizado_en) VALUES ('${t}', '${fecha}T12:00:00Z', 1, '${p}', 'org', now())`,
      `INSERT INTO sesiones_clinicas (id, turno_id, organization_id, creada_en, actualizada_en, nota_final_encrypted)
         VALUES ('${s}', '${t}', 'org', '${fecha}T13:00:00Z', now(), ${enc2(clave, "sesiones_clinicas", "nota_final_encrypted", s, nota)})`,
      `INSERT INTO hilos (paciente_id, organization_id, actualizado_en) VALUES ('${p}', 'org', now())`,
      `INSERT INTO hilo_versiones (id, paciente_id, organization_id, version, actor, estado, contenido_encrypted, creada_en)
         VALUES ('${v}', '${p}', 'org', 1, 'profesional', 'aplicada', ${enc2(clave, "hilo_versiones", "contenido_encrypted", v, { resumen: "r" })}, '${fecha}T14:00:00Z')`,
    );
  });
  psql(url, sentencias.join(";\n"));
}
