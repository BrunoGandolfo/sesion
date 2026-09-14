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

  it("las rutas que llama el worker están excluidas del matcher del proxy", () => {
    const proxy = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
    // La cadena del matcher tal como la ve Next (JSON.parse deshace los
    // escapes del código fuente).
    const crudo = proxy.match(/"(\/\(\(\?![\s\S]*?)"\s*,?\s*\]/)?.[1];
    expect(crudo).toBeDefined();
    const matcher = JSON.parse(`"${crudo}"`) as string;
    // El matcher de Next es "/((?!a|b|c).*)": lo que está en la negación no
    // pasa por el proxy. Se prueba con la misma regex sobre cada path.
    const excluye = (path: string) => !new RegExp(`^${matcher}$`).test(path);
    for (const path of [
      "/api/sesion-clinica/pendientes",
      "/api/sesion-clinica/abc-123/lease",
      "/api/sesion-clinica/abc-123/asr",
      "/api/sesion-clinica/abc-123/transcripcion",
      "/api/sesion-clinica/abc-123/resultado",
      "/api/trabajos/pendientes",
      "/api/trabajos/t-1/resultado",
      "/api/cron/trabajos",
    ]) {
      expect(excluye(path), path).toBe(true);
    }
    // Y las de usuaria siguen pasando por el proxy (cookie + Origin).
    for (const path of [
      "/api/sesion-clinica/abc-123",
      "/api/sesion-clinica/abc-123/aprobar",
      "/api/sesion-clinica/abc-123/eliminar",
    ]) {
      expect(excluye(path), path).toBe(false);
    }
  });

  it("fuera del proxy, ninguna ruta acepta sesión de usuaria con método no seguro sin chequear Origin", () => {
    // Contrato del Área 3 (docs/pendientes/03-identidad.md §3): el proxy
    // chequea Origin (CSRF) sólo para lo que matchea. Una ruta excluida que
    // use la sesión de usuaria en POST/PATCH/DELETE tiene que llamar a
    // esOrigenPropio. Hoy la única excluida con sesión es el GET de la
    // transcripción, y GET es método seguro.
    const excluidas = RUTAS.filter((r) =>
      /\/(lease|asr|transcripcion|resultado)\/route\.ts$|\/pendientes\/route\.ts$|api\/trabajos\/|api\/cron\//.test(r),
    );
    expect(excluidas.length).toBeGreaterThanOrEqual(8);
    for (const ruta of excluidas) {
      const fuente = readFileSync(resolve(process.cwd(), ruta), "utf8");
      if (!fuente.includes("getSessionActor")) continue;
      const handlers = [...fuente.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
      const conSesion = handlers.filter((h) => {
        const cuerpo = fuente.slice(fuente.indexOf(`export async function ${h}`));
        const fin = cuerpo.slice(1).search(/export async function /);
        return (fin === -1 ? cuerpo : cuerpo.slice(0, fin + 1)).includes("getSessionActor");
      });
      for (const h of conSesion) {
        if (h !== "GET") expect(fuente, `${ruta} ${h}`).toContain("esOrigenPropio");
      }
      expect(conSesion, ruta).toEqual(["GET"]);
    }
  });

  it("sólo el cron de trabajos llama a R2 para borrar", () => {
    const importan = RUTAS.filter((ruta) =>
      /from "@\/lib\/r2"/.test(readFileSync(resolve(process.cwd(), ruta), "utf8")),
    );
    expect(importan).toEqual(["src/app/api/cron/trabajos/route.ts"]);
  });
});
