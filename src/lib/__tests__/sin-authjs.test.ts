// Auth.js ya no existe. Este test lo fija por tres lados: no está en las
// dependencias, no quedan sus archivos, y nada de src/ lo importa ni lee
// sus variables (AUTH_SECRET, AUTH_URL). Si alguien lo vuelve a agregar
// "para una cosita", esto lo discute antes del merge.
//
// La autenticación vive en: src/lib/sesion-cookie.ts (cookie opaca),
// src/lib/sesion-acceso.ts (tabla sesiones_acceso), src/app/api/_lib/auth.ts
// (getSessionActor) y src/proxy.ts (redirección optimista, sin base).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

function archivosDe(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosDe(ruta, out);
    else if (/\.(ts|tsx|js|jsx|mts)$/.test(nombre)) out.push(ruta);
  }
  return out;
}

describe("Auth.js no existe", () => {
  it("no está en package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(RAIZ, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter((d) => /^(next-auth|@auth\/)/.test(d))).toEqual([]);
  });

  it("sus archivos y el middleware se fueron", () => {
    for (const ruta of [
      "src/lib/auth.ts",
      "src/lib/auth-utils.ts",
      "src/lib/db-auth.ts",
      "src/lib/login-eventos.ts",
      "src/lib/password-eventos.ts",
      "src/middleware.ts",
      "src/app/api/auth",
    ]) {
      expect(existsSync(resolve(RAIZ, ruta)), `${ruta} no debería existir`).toBe(false);
    }
    expect(existsSync(resolve(RAIZ, "src/proxy.ts"))).toBe(true);
  });

  it("nada de src/ importa next-auth ni lee AUTH_SECRET / AUTH_URL", () => {
    const sospechosos: string[] = [];
    for (const archivo of archivosDe(resolve(RAIZ, "src"))) {
      const fuente = readFileSync(archivo, "utf8");
      if (/from\s+["'](next-auth|@auth\/)/.test(fuente) || /import\s*\(\s*["']next-auth/.test(fuente)) {
        sospechosos.push(`${archivo}: importa next-auth`);
      }
      if (/process\.env\.(AUTH_SECRET|AUTH_URL|NEXTAUTH_[A-Z_]+)\b/.test(fuente)) {
        sospechosos.push(`${archivo}: lee una variable de Auth.js`);
      }
    }
    expect(sospechosos).toEqual([]);
  });
});
