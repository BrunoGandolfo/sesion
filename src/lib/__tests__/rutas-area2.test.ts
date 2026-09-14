// Unitario: toda ruta del área declara runtime nodejs, force-dynamic y un
// maxDuration (H-29): ninguna función puede colgarse sin límite.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RUTAS = [
  "src/app/api/sesion-clinica/[id]/route.ts",
  "src/app/api/sesion-clinica/[id]/aprobar/route.ts",
  "src/app/api/sesion-clinica/[id]/reprocesar/route.ts",
  "src/app/api/sesion-clinica/[id]/reintentar/route.ts",
  "src/app/api/sesion-clinica/[id]/eliminar/route.ts",
  "src/app/api/sesion-clinica/[id]/feedback/reintentar/route.ts",
  "src/app/api/sesion-clinica/[id]/transcripcion/route.ts",
  "src/app/api/sesion-clinica/[id]/lease/route.ts",
  "src/app/api/sesion-clinica/[id]/asr/route.ts",
  "src/app/api/sesion-clinica/[id]/resultado/route.ts",
  "src/app/api/sesion-clinica/pendientes/route.ts",
  "src/app/api/trabajos/pendientes/route.ts",
  "src/app/api/trabajos/[id]/resultado/route.ts",
  "src/app/api/cron/trabajos/route.ts",
];

describe("rutas del área 2", () => {
  it.each(RUTAS)("%s declara runtime, dynamic y maxDuration", (ruta) => {
    const fuente = readFileSync(resolve(process.cwd(), ruta), "utf8");
    expect(fuente).toMatch(/export const runtime = "nodejs"/);
    expect(fuente).toMatch(/export const dynamic = "force-dynamic"/);
    expect(fuente).toMatch(/export const maxDuration = \d+/);
  });

  it("el GET de la sesión no tiene PATCH ni DELETE", () => {
    const fuente = readFileSync(resolve(process.cwd(), "src/app/api/sesion-clinica/[id]/route.ts"), "utf8");
    expect(fuente).not.toMatch(/export async function (PATCH|DELETE)/);
  });

  it("sólo el cron de trabajos llama a R2 para borrar", () => {
    const importan = RUTAS.filter((ruta) =>
      /from "@\/lib\/r2"/.test(readFileSync(resolve(process.cwd(), ruta), "utf8")),
    );
    expect(importan).toEqual(["src/app/api/cron/trabajos/route.ts"]);
  });
});
