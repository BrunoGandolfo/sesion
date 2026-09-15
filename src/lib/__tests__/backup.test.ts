import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Paso = { name?: string; run?: string; if?: string; with?: { texto?: string } };
const { load } = createRequire(import.meta.url)("js-yaml") as {
  load: (s: string) => { jobs: { backup: { steps: Paso[] } } };
};
const pasos = load(readFileSync(".github/workflows/backup.yml", "utf8")).jobs.backup.steps;
function paso(nombre: string) {
  const p = pasos.find((p) => p.name === nombre);
  if (!p) throw new Error("Falta paso " + nombre);
  return p;
}
const respaldo = ["DATABASE_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "BACKUP_ENCRYPTION_KEY"];
const correo = ["RESEND_API_KEY", "ALERTA_CORREO"];
let carpeta: string;
beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), "sesion-backup-test-"));
  mkdirSync(join(carpeta, "bin"));
  // Sólo el proveedor del índice se sustituye: se ejecuta el shell del workflow.
  writeFileSync(join(carpeta, "bin/pg_restore"), '#!/bin/sh\n[ "$1" = "--list" ] || exit 2\n[ "$INDICE_INVALIDO" != "1" ] || exit 1\ncat "$2"\n', { mode: 0o755 });
});
afterEach(() => rmSync(carpeta, { recursive: true, force: true }));
const ejecutar = (nombre: string, cambios: Record<string, string> = {}) => spawnSync("bash", ["-c", paso(nombre).run!], {
  cwd: carpeta, encoding: "utf8", env: {
    NODE_ENV: "test", PATH: process.env.PATH, GITHUB_ENV: join(carpeta, "env"),
    ...Object.fromEntries([...respaldo, ...correo].map((k) => [k, "ficticio"])),
    PG_BIN: join(carpeta, "bin"), BACKUP_FILE: "prueba.dump", ...cambios,
  },
});

describe("respaldo y canal de aviso independientes", () => {
  it.each(correo)("sin %s permite copiar y marca el aviso faltante al final", (clave) => {
    expect(ejecutar("Verificar secrets", { [clave]: "" }).status).toBe(0);
    expect(readFileSync(join(carpeta, "env"), "utf8")).toContain("AVISO_CONFIGURADO=0");
    for (const nombre of ["Ejecutar pg_dump", "Subir backup cifrado a R2", "Verificar que el backup está en R2"]) {
      expect(paso(nombre).if).toBeUndefined();
    }
    expect(paso("Sin canal de aviso configurado").if).toBe("always() && env.AVISO_CONFIGURADO == '0'");
    const final = ejecutar("Sin canal de aviso configurado");
    expect(final.status).toBe(1);
    expect(final.stdout).toContain("lo que falta es el canal");
    expect(pasos.indexOf(paso("Sin canal de aviso configurado"))).toBeGreaterThan(pasos.indexOf(paso("Verificar que el backup está en R2")));
  });
  it.each(respaldo)("sin %s aborta antes de pg_dump", (clave) => {
    expect(ejecutar("Verificar secrets", { [clave]: "" }).status).toBe(1);
    expect(pasos.indexOf(paso("Verificar secrets"))).toBeLessThan(pasos.indexOf(paso("Ejecutar pg_dump")));
  });
  it("con todos los datos habilita el correo y no asegura la fecha de la última copia", () => {
    expect(ejecutar("Verificar secrets").status).toBe(0);
    expect(readFileSync(join(carpeta, "env"), "utf8")).toContain("AVISO_CONFIGURADO=1");
    expect(paso("Avisar falla por correo").if).toBe("failure() && env.AVISO_CONFIGURADO == '1'");
    expect(paso("Avisar falla por correo").with?.texto).not.toContain("es el del día anterior");
  });
});

describe("índice del respaldo", () => {
  const comunes = ["organizaciones", "usuarios", "pacientes", "turnos", "sesiones_clinicas"];
  function indice(tablas: string[]) {
    writeFileSync(join(carpeta, "prueba.dump"), tablas.map((t) => `1; 0 0 TABLE DATA public ${t} postgres`).join("\n"));
  }
  const validar = (env: Record<string, string> = {}) => ejecutar("Verificar que el dump se puede leer (pg_restore --list)", env);
  it.each([["recordatorios"], ["envios_sms"], ["recordatorios", "envios_sms"]])("acepta el esquema con %j", (...tablas) => {
    indice([...comunes, ...tablas]);
    expect(validar().status).toBe(0);
  });
  it("rechaza cuando faltan ambas tablas", () => {
    indice(comunes);
    expect(validar().stderr).toContain("no contiene recordatorios ni envios_sms");
  });
  it("conserva el control de las tablas comunes", () => {
    indice(["envios_sms", ...comunes.filter((t) => t !== "pacientes")]);
    expect(validar().status).toBe(1);
  });
  it("rechaza si pg_restore no puede leer el archivo", () => {
    indice([...comunes, "envios_sms"]);
    expect(validar({ INDICE_INVALIDO: "1" }).status).toBe(1);
  });
});
