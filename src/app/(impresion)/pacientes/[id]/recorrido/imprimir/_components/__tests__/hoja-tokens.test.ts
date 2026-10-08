// La hoja del Recorrido no trae colores propios: la paleta es cerrada
// (docs/diseno/01-tokens.md) y Lupita no aparece en el Recorrido
// (docs/diseno/04-personaje.md).
//
// Recorre todo src/app/(impresion) sin tests: ningún hexadecimal, rgb() ni
// hsl() escrito a mano; cada clase de color nombra un token que existe en
// globals.css, y cada var(--color-…) también.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const CARPETA = join(RAIZ, "src/app/(impresion)");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__tests__" ? [] : archivos(ruta);
    return /\.(tsx?|css)$/.test(nombre) ? [ruta] : [];
  });
}

const fuentes = archivos(CARPETA).map((ruta) => ({ ruta: relative(RAIZ, ruta), texto: readFileSync(ruta, "utf8") }));
const globals = readFileSync(join(RAIZ, "src/app/globals.css"), "utf8");
const tokens = new Set([...globals.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));

describe("la hoja del Recorrido usa solo los tokens de la app", () => {
  it("encuentra lo que mide", () => {
    expect(fuentes.map((f) => f.ruta)).toEqual(expect.arrayContaining([
      "src/app/(impresion)/impresion.css",
      "src/app/(impresion)/pacientes/[id]/recorrido/imprimir/_components/recorrido-imprimible.tsx",
    ]));
    expect(tokens.has("cream-50")).toBe(true);
  });

  it("no escribe ningún color a mano", () => {
    const sueltos = fuentes.flatMap(({ ruta, texto }) =>
      [...texto.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)].map((m) => `${ruta}: ${m[0]}`),
    );
    expect(sueltos).toEqual([]);
  });

  it("cada clase de color y cada var(--color-…) es un token de globals.css", () => {
    const usados = fuentes.flatMap(({ ruta, texto }) => [
      ...[...texto.matchAll(/\b(?:bg|text|border(?:-[lrtb])?|fill|stroke|from|to|ring|outline|decoration)-((?:sage|cream|ink|terracotta|gold)-\d+)\b/g)].map((m) => ({ ruta, token: m[1] })),
      ...[...texto.matchAll(/var\(--color-([a-z0-9-]+)\)/g)].map((m) => ({ ruta, token: m[1] })),
    ]);
    expect(usados.length).toBeGreaterThan(10);
    expect(usados.filter((u) => !tokens.has(u.token)).map((u) => `${u.ruta}: ${u.token}`)).toEqual([]);
  });

  it("Lupita no aparece en el Recorrido", () => {
    for (const { ruta, texto } of fuentes) {
      expect(texto, ruta).not.toMatch(/lupita|LUPITA/i);
    }
  });
});
