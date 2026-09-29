// Las dos acciones compuestas de infraestructura, y que los workflows las usen
// en vez de copiar el bloque.
//
// Antes la instalación de postgresql-client-17 estaba copiada en ci.yml,
// backup.yml y ensayo-restauracion.yml, y la configuración del AWS CLI para
// R2 en los dos últimos: pasar a Postgres 18 era cambiar cuatro lugares y
// acordarse de todos. Ahora hay una acción por cosa (.github/actions/) y este
// test falla si un workflow vuelve a escribir el bloque a mano.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const { load } = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => unknown };

interface Paso { name?: string; uses?: string; run?: string; shell?: string }
interface Workflow { jobs: Record<string, { steps: Paso[] }> }
interface Accion { runs: { using: string; steps: Paso[] } }

const leer = <T>(ruta: string) => load(readFileSync(ruta, "utf8")) as T;
const pasosDe = (archivo: string, job: string) => leer<Workflow>(`.github/workflows/${archivo}`).jobs[job].steps;

const POSTGRES = "./.github/actions/postgres-cliente";
const R2 = "./.github/actions/r2-cli";

const USAN_POSTGRES: Array<[string, string]> = [
  ["ci.yml", "test"],
  ["backup.yml", "backup"],
  ["ensayo-restauracion.yml", "ensayo"],
];
const USAN_R2: Array<[string, string]> = [
  ["backup.yml", "backup"],
  ["ensayo-restauracion.yml", "ensayo"],
];

describe("los workflows usan las acciones compuestas", () => {
  it.each(USAN_POSTGRES)("%s instala el cliente de Postgres con la acción", (archivo, job) => {
    const pasos = pasosDe(archivo, job);
    expect(pasos.filter((p) => p.uses === POSTGRES)).toHaveLength(1);
    expect(pasos.some((p) => p.run?.includes("postgresql-client"))).toBe(false);
  });

  it.each(USAN_R2)("%s configura el AWS CLI para R2 con la acción, antes de usarlo", (archivo, job) => {
    const pasos = pasosDe(archivo, job);
    const configura = pasos.findIndex((p) => p.uses === R2);
    expect(configura).toBeGreaterThanOrEqual(0);
    expect(pasos.some((p) => p.run?.includes("aws configure"))).toBe(false);
    const primeroQueUsaAws = pasos.findIndex((p) => /\baws s3/.test(p.run ?? ""));
    expect(primeroQueUsaAws).toBeGreaterThan(configura);
  });

  it("ningún workflow copia el bloque del repositorio PGDG", () => {
    for (const archivo of ["ci.yml", "backup.yml", "ensayo-restauracion.yml", "publicar.yml", "avisar-ci.yml", "latido.yml"]) {
      expect(readFileSync(`.github/workflows/${archivo}`, "utf8"), archivo).not.toContain("apt.postgresql.org");
    }
  });
});

describe("r2-cli", () => {
  const paso = leer<Accion>(".github/actions/r2-cli/action.yml").runs.steps[0];
  let carpeta = "";

  afterEach(() => {
    if (carpeta) rmSync(carpeta, { recursive: true, force: true });
  });

  function correr(env: Record<string, string>) {
    carpeta = mkdtempSync(join(tmpdir(), "r2-cli-"));
    const registro = join(carpeta, "llamadas");
    // Un `aws` falso que anota sus argumentos: nunca el real.
    writeFileSync(join(carpeta, "aws"), `#!/bin/bash\necho "$*" >> "${registro}"\n`);
    chmodSync(join(carpeta, "aws"), 0o755);
    const r = spawnSync("bash", ["-c", paso.run!], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: `${carpeta}:${process.env.PATH}`, ...env },
    });
    let llamadas: string[] = [];
    try {
      llamadas = readFileSync(registro, "utf8").trim().split("\n");
    } catch {
      // sin llamadas
    }
    return { status: r.status, stderr: r.stderr, llamadas };
  }

  it("configura credenciales, región y los dos checksums", () => {
    const r = correr({ R2_ACCESS_KEY_ID: "clave", R2_SECRET_ACCESS_KEY: "secreto" });
    expect(r.status).toBe(0);
    expect(r.llamadas).toEqual([
      "configure set aws_access_key_id clave",
      "configure set aws_secret_access_key secreto",
      "configure set default.region auto",
      "configure set default.s3.request_checksum_calculation when_required",
      "configure set default.s3.response_checksum_validation when_required",
    ]);
  });

  it("sin credenciales falla antes de tocar el AWS CLI", () => {
    const r = correr({ R2_ACCESS_KEY_ID: "clave" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("R2_SECRET_ACCESS_KEY");
    expect(r.llamadas).toEqual([]);
  });
});

describe("postgres-cliente", () => {
  it("instala el cliente 17 donde los workflows lo buscan (PG_BIN)", () => {
    const script = leer<Accion>(".github/actions/postgres-cliente/action.yml").runs.steps[0].run!;
    expect(script).toContain("postgresql-client-17");
    expect(script).toContain("/usr/lib/postgresql/17/bin/pg_dump --version");
    for (const [archivo] of USAN_POSTGRES) {
      expect(readFileSync(`.github/workflows/${archivo}`, "utf8"), archivo).toContain("PG_BIN: /usr/lib/postgresql/17/bin");
    }
  });
});
