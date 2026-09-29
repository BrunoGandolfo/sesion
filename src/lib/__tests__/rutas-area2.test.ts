// Unitario, dos partes:
//   - la FORMA de toda ruta de src/app/api: runtime nodejs y force-dynamic.
//     El techo de tiempo (H-29) no se mira acá: lo exige
//     scripts/ci/max-duration.mjs en el job Guardias, que es el único
//     guardián de maxDuration;
//   - las reglas propias del área 2 (sesión clínica, cola de trabajos).
// Las rutas salen del disco: una ruta nueva entra sola.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { crearGrafo, exportadoresDe, type Grafo } from "./grafo-imports";

const R2 = "src/lib/r2.ts";

/** Los exports de r2.ts que borran: los que mandan un DeleteObjectCommand y,
 *  hasta que no aparezcan más, los que llaman a uno de esos. Así un envoltorio
 *  nuevo (como adaptadorBorradoR2 alrededor de borrarAudio) entra solo. */
function exportsDeR2QueBorran(grafo: Grafo): Set<string> {
  const fuente = ts.createSourceFile(R2, grafo.leer(R2), ts.ScriptTarget.Latest, true);
  const exportados = new Map<string, string>();
  for (const st of fuente.statements) {
    const exportado = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportado) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) exportados.set(d.name.getText(fuente), st.getText(fuente));
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) {
      exportados.set(st.name.text, st.getText(fuente));
    }
  }
  const borran = new Set([...exportados].filter(([, texto]) => texto.includes("DeleteObjectCommand")).map(([n]) => n));
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const [nombre, texto] of exportados) {
      if (!borran.has(nombre) && [...borran].some((b) => new RegExp(`\\b${b}\\b`).test(texto))) {
        borran.add(nombre);
        cambio = true;
      }
    }
  }
  return borran;
}

/** Las rutas que llegan a algo que borra de R2, con la cadena de imports.
 *  Cuenta el import directo, el que pasa por un caso de uso, el que pasa
 *  por un barril (`export *`, `export { x as y }`, `export * as x`). Un
 *  import namespace o dinámico de un módulo que exporta algo que borra
 *  cuenta SIEMPRE: el namespace se puede pasar a otro módulo y no hay forma
 *  estática de saber qué hace con él. Hoy ninguna ruta lo hace. */
function rutasQueBorran(grafo: Grafo): Record<string, string[]> {
  const exportadores = exportadoresDe(grafo, R2, exportsDeR2QueBorran(grafo));
  const salida: Record<string, string[]> = {};
  for (const ruta of grafo.rutasBajo("src/app/api")) {
    busqueda: for (const [modulo, cadena] of grafo.alcanzables(ruta, new Set([R2]))) {
      for (const imp of grafo.importsLocales(modulo)) {
        const nombres = imp.tipo === "import" ? exportadores.get(imp.destino) : undefined;
        if (!nombres) continue;
        const trae = imp.nombres === "*" || imp.nombres.some((n) => nombres.has(n));
        if (trae) {
          salida[ruta] = cadena;
          break busqueda;
        }
      }
    }
  }
  return salida;
}

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

  it("sólo el cron de trabajos borra de R2 (por cualquier cadena de imports)", () => {
    // Antes se buscaba el import con una regex, y sólo en la ruta: un caso de
    // uso que importara borrarAudio, o un barril, pasaban sin que se viera.
    // Ahora se pregunta al grafo quién alcanza lo que borra.
    const grafo = crearGrafo();
    expect([...exportsDeR2QueBorran(grafo)]).toEqual(expect.arrayContaining(["adaptadorBorradoR2", "borrarAudio"]));
    const borran = rutasQueBorran(grafo);
    expect(Object.keys(borran), JSON.stringify(borran, null, 1)).toEqual(["src/app/api/cron/trabajos/route.ts"]);
  });

  it("encuentra las rutas del área en el disco", () => {
    // La lista escrita a mano tenía 14; el disco no puede traer menos.
    expect(RUTAS.length).toBeGreaterThanOrEqual(14);
    expect(RUTAS).toContain("src/app/api/sesion-clinica/[id]/aprobar/route.ts");
  });
});

describe("el detector de borrado en R2, sobre un árbol de mentira", () => {
  it("ve el caso de uso, el barril con export *, el alias, el export * as y el import() dinámico; no ve a quien sólo lee", () => {
    const raiz = mkdtempSync(join(tmpdir(), "grafo-r2-"));
    const escribir = (ruta: string, texto: string) => {
      mkdirSync(join(raiz, ruta, ".."), { recursive: true });
      writeFileSync(join(raiz, ruta), texto);
    };
    try {
      escribir("src/lib/r2.ts", [
        'import { DeleteObjectCommand } from "@aws-sdk/client-s3";',
        "export async function borrarAudio(key: string) { return new DeleteObjectCommand({ Key: key }); }",
        "export const adaptador = { borrar: (k: string) => borrarAudio(k) };",
        "export function r2Configurado() { return true; }",
      ].join("\n"));
      escribir("src/lib/barril.ts", 'export * from "./r2";');
      escribir("src/lib/alias.ts", 'export { adaptador as limpiador } from "@/lib/r2";');
      escribir("src/lib/espacio.ts", 'export * as storage from "./r2";');
      escribir("src/app/api/_lib/caso.ts", 'import { borrarAudio } from "@/lib/r2";\nexport const caso = borrarAudio;');
      escribir("src/app/api/directa/route.ts", 'import { adaptador } from "@/lib/r2";\nexport const GET = adaptador;');
      escribir("src/app/api/por-caso/route.ts", 'import { caso } from "../_lib/caso";\nexport const GET = caso;');
      escribir("src/app/api/por-barril/route.ts", 'import { borrarAudio } from "@/lib/barril";\nexport const GET = borrarAudio;');
      escribir("src/app/api/por-alias/route.ts", 'import { limpiador } from "@/lib/alias";\nexport const GET = limpiador;');
      escribir("src/app/api/por-namespace/route.ts", 'import { storage } from "@/lib/espacio";\nexport const GET = () => storage.borrarAudio("k");');
      escribir("src/app/api/_lib/ayudante.ts", 'export const usar = (s: { borrarAudio(k: string): unknown }) => s.borrarAudio("k");');
      escribir("src/app/api/namespace-pasado/route.ts", 'import * as almacen from "@/lib/r2";\nimport { usar } from "../_lib/ayudante";\nexport const GET = () => usar(almacen);');
      escribir("src/app/api/dinamica/route.ts", 'export const GET = async () => (await import("@/lib/r2")).borrarAudio("k");');
      escribir("src/app/api/solo-lee/route.ts", 'import { r2Configurado } from "@/lib/barril";\nexport const GET = r2Configurado;');

      const grafo = crearGrafo(raiz);
      expect([...exportsDeR2QueBorran(grafo)].sort()).toEqual(["adaptador", "borrarAudio"]);
      expect(Object.keys(rutasQueBorran(grafo)).sort()).toEqual([
        "src/app/api/dinamica/route.ts",
        "src/app/api/directa/route.ts",
        "src/app/api/namespace-pasado/route.ts",
        "src/app/api/por-alias/route.ts",
        "src/app/api/por-barril/route.ts",
        "src/app/api/por-caso/route.ts",
        "src/app/api/por-namespace/route.ts",
      ]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});

