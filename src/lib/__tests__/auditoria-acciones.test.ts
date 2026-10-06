// Guardián del catálogo de acciones de auditoría (src/lib/auditoria-acciones.ts).
//
// El tipo de `EventoAuditoriaInput.accion` ya obliga a que un nombre NUEVO
// entre al catálogo: lo que el tipo no ve es un literal que coincide con uno
// existente ("sesion.ver" escrito a mano compila igual). Eso es lo que este
// test prohíbe: fuera del catálogo y de los tests, ningún archivo de src
// escribe un valor del catálogo entre comillas, ni pasa una acción literal a
// quien audita.
//
// La lista de archivos sale del disco, como en proxy-liviano.test.ts: un
// archivo nuevo entra solo.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { ACCIONES, TODAS_LAS_ACCIONES } from "@/lib/auditoria-acciones";

const RAIZ = process.cwd();
const SRC = join(RAIZ, "src");
const CATALOGO = "src/lib/auditoria-acciones.ts";

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "__tests__") continue;
      salida.push(...archivos(ruta));
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.(test|spec)\.tsx?$/.test(nombre)) {
      salida.push(ruta);
    }
  }
  return salida.sort();
}

/** El código sin comentarios: un comentario puede nombrar la acción. */
export function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    // `//` precedido de `:` es una URL dentro de un string, no un comentario.
    .map((linea) => linea.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/** Los valores del catálogo que aparecen como literal en `fuente`. */
export function literalesDeAccion(fuente: string): string[] {
  const limpia = sinComentarios(fuente);
  return TODAS_LAS_ACCIONES.filter((accion) =>
    ["\"", "'", "`"].some((comilla) => limpia.includes(`${comilla}${accion}${comilla}`)),
  );
}

/** Quien escribe en eventos_auditoria (por la función o a mano). */
const AUDITA = /\b(?:auditar|registrarAuditoria|auditarHilo)\s*\(|\beventoAuditoria\s*\.\s*create/;
/** `accion: "…"`: una acción literal pasada a quien audita. */
const ACCION_LITERAL = /\baccion\s*:\s*["'`]/;

const todos = archivos(SRC).map((abs) => ({
  abs,
  rel: relative(RAIZ, abs).split("\\").join("/"),
}));

describe("catálogo de acciones de auditoría", () => {
  it("los valores son únicos y tienen la forma <entidad>.<acto>", () => {
    expect(new Set(TODAS_LAS_ACCIONES).size).toBe(TODAS_LAS_ACCIONES.length);
    for (const accion of TODAS_LAS_ACCIONES) expect(accion).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it("cada grupo nombra a su entidad", () => {
    for (const [grupo, acciones] of Object.entries(ACCIONES)) {
      for (const accion of Object.values(acciones)) expect(accion.startsWith(`${grupo}.`)).toBe(true);
    }
  });

  it("encuentra el código en el disco", () => {
    expect(todos.length).toBeGreaterThan(100);
    expect(todos.some(({ rel }) => rel === CATALOGO)).toBe(true);
  });

  it("la detección ve un literal y no ve un comentario", () => {
    expect(literalesDeAccion(`const a = "sesion.ver";`)).toEqual(["sesion.ver"]);
    expect(literalesDeAccion(`// deja un "sesion.ver"\nconst a = 1;`)).toEqual([]);
    expect(literalesDeAccion(`/* "turno.crear" */ const a = 1;`)).toEqual([]);
    expect(literalesDeAccion(`const a = ACCIONES.sesion.ver;`)).toEqual([]);
  });

  it.each(todos.filter(({ rel }) => rel !== CATALOGO).map(({ rel, abs }) => [rel, abs]))(
    "%s no escribe una acción como literal",
    (_rel, abs) => {
      const fuente = readFileSync(abs, "utf8");
      expect(literalesDeAccion(fuente)).toEqual([]);
      if (AUDITA.test(sinComentarios(fuente))) {
        expect(sinComentarios(fuente)).not.toMatch(ACCION_LITERAL);
      }
    },
  );
});
