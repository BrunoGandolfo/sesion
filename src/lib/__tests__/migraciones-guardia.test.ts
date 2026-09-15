import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const script = resolve("scripts/ci/migraciones.mjs");
let carpeta: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: carpeta, stdio: "pipe" });
beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), "sesion-guardia-sql-"));
  git("init", "-q");
  git("config", "user.name", "Prueba");
  git("config", "user.email", "prueba@example.invalid");
  git("commit", "--allow-empty", "-qm", "Base de prueba");
});
afterEach(() => rmSync(carpeta, { recursive: true, force: true }));
const ejecutar = () => spawnSync(process.execPath, [script, "--sin-drift"], { cwd: carpeta, encoding: "utf8" });
function sql(texto: string) {
  mkdirSync(join(carpeta, "prisma/migrations/ejemplo"), { recursive: true });
  writeFileSync(join(carpeta, "prisma/migrations/ejemplo/migration.sql"), texto);
  git("add", "prisma");
}
it("sin rama base ni SQL falla avisando que no miró nada", () => {
  const r = ejecutar();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("el guardián no miró nada");
  expect(r.stdout).not.toContain("migraciones: OK");
});
it("sin rama base revisa las migraciones disponibles", () => {
  sql("CREATE TABLE ejemplo (id integer);");
  expect(ejecutar().status).toBe(0);
});
it("con una base válida y sin cambios no inventa un error", () => {
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  expect(ejecutar().status).toBe(0);
});
it("conserva el rechazo de SQL destructivo sin marca", () => {
  sql("DROP TABLE ejemplo;");
  const r = ejecutar();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("sentencia destructiva");
});
