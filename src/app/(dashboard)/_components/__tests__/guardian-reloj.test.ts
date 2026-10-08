// Ningún test de Hoy lee la hora real (ver reloj-fijo.ts): todo test de esta
// carpeta que renderiza fija la hora con relojFijo o con setSystemTime.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, it } from "vitest";

const CARPETA = join(process.cwd(), "src", "app", "(dashboard)", "_components");

function tests(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tests(join(dir, e.name)) : /\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

it("todo test que renderiza en _components fija la hora", () => {
  const sinReloj = tests(CARPETA)
    .filter((archivo) => /\brender\(/.test(readFileSync(archivo, "utf8")))
    .filter((archivo) => !/\brelojFijo\(|\.setSystemTime\(/.test(readFileSync(archivo, "utf8")))
    .map((archivo) => relative(CARPETA, archivo));
  expect(sinReloj, "Agregá relojFijo(instante) de __tests__/reloj-fijo.ts").toEqual([]);
});

it("el guardián ve los tests que tiene que ver", () => {
  const conRender = tests(CARPETA).filter((archivo) => /\brender\(/.test(readFileSync(archivo, "utf8")));
  expect(conRender.length).toBeGreaterThanOrEqual(12);
});
