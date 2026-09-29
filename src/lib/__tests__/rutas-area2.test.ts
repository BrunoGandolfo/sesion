// Unitario, dos partes:
//   - la FORMA de toda ruta de src/app/api: runtime nodejs y force-dynamic.
//     El techo de tiempo (H-29) no se mira acá: lo exige
//     scripts/ci/max-duration.mjs en el job Guardias, que es el único
//     guardián de maxDuration;
//   - las reglas propias del área 2 (sesión clínica, cola de trabajos).
// Las rutas salen del disco: una ruta nueva entra sola.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

function rutasBajo(dir: string): string[] {
  const absoluto = resolve(RAIZ, dir);
  return readdirSync(absoluto).flatMap((nombre) => {
    const ruta = join(absoluto, nombre);
    if (statSync(ruta).isDirectory()) return rutasBajo(relative(RAIZ, ruta));
    return nombre === "route.ts" ? [relative(RAIZ, ruta)] : [];
  });
}

/** El área 2: la sesión clínica, la cola de trabajos y su cron. */
const RUTAS = [
  ...rutasBajo("src/app/api/sesion-clinica"),
  ...rutasBajo("src/app/api/trabajos"),
  "src/app/api/cron/trabajos/route.ts",
].sort();

/** Rutas que no declaran runtime, con el motivo. */
const SIN_RUNTIME: Record<string, string> = {
  // Devuelve una constante del build: no usa nada de Node ni la base.
  "src/app/api/version/route.ts": "metadato del build, sin Node",
};

describe("forma de toda ruta de src/app/api", () => {
  const todas = rutasBajo("src/app/api").sort();

  it("encuentra las rutas en el disco", () => {
    expect(todas.length).toBeGreaterThan(60);
    for (const ruta of Object.keys(SIN_RUNTIME)) expect(todas, ruta).toContain(ruta);
  });

  it.each(todas)("%s declara runtime nodejs y force-dynamic", (ruta) => {
    const fuente = readFileSync(resolve(RAIZ, ruta), "utf8");
    if (!(ruta in SIN_RUNTIME)) expect(fuente).toMatch(/export const runtime = "nodejs"/);
    expect(fuente).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("las exceptuadas siguen sin runtime (si lo declaran, sacarlas de SIN_RUNTIME)", () => {
    for (const ruta of Object.keys(SIN_RUNTIME)) {
      expect(readFileSync(resolve(RAIZ, ruta), "utf8")).not.toMatch(/export const runtime/);
    }
  });
});

describe("rutas del área 2", () => {
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

  it("sólo el cron de trabajos borra de R2", () => {
    const borran = rutasBajo("src/app/api").filter((ruta) =>
      // borrarAudio suelto, o el adaptador con timeout que lo envuelve.
      /import \{[^}]*\b(borrarAudio|adaptadorBorradoR2)\b[^}]*\} from "@\/lib\/r2"/.test(readFileSync(resolve(RAIZ, ruta), "utf8")),
    );
    expect(borran).toEqual(["src/app/api/cron/trabajos/route.ts"]);
  });

  it("encuentra las rutas del área en el disco", () => {
    // La lista escrita a mano tenía 14; el disco no puede traer menos.
    expect(RUTAS.length).toBeGreaterThanOrEqual(14);
    expect(RUTAS).toContain("src/app/api/sesion-clinica/[id]/aprobar/route.ts");
  });
});
