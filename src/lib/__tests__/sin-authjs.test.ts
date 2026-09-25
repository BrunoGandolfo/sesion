// Auth.js ya no existe, y no vuelve como dependencia. Que nada lo importe lo
// asegura tsc: sin el paquete instalado, cualquier import no compila.
//
// La autenticación vive en: src/lib/sesion-cookie.ts (cookie opaca),
// src/lib/sesion-acceso.ts (tabla sesiones_acceso), src/app/api/_lib/auth.ts
// (getSessionActor) y src/proxy.ts (redirección optimista, sin base).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

it("Auth.js no está en package.json", () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  expect(Object.keys(deps).filter((d) => /^(next-auth|@auth\/)/.test(d))).toEqual([]);
});
