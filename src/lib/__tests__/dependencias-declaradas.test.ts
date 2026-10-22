// Todo paquete que importan los scripts del repositorio está declarado en
// package.json. Un script que usa un paquete que sólo llega como dependencia
// de otro (jiti llegaba por eslint) funciona hasta el día en que esa otra
// cambia, y los de scripts/mantenimiento se corren a mano, en un mal día.
import { builtinModules } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

const RAIZ = process.cwd();
const paquete = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const declarados = new Set([...Object.keys(paquete.dependencies), ...Object.keys(paquete.devDependencies)]);
const nativos = new Set(builtinModules);

function archivos(dir: string): string[] {
  return readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? archivos(`${dir}/${e.name}`) : /\.(?:mjs|cjs|js|ts)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );
}

/** "@scope/nombre/sub" → "@scope/nombre"; "nombre/sub" → "nombre". */
const nombreDelPaquete = (especificador: string) =>
  especificador.split("/").slice(0, especificador.startsWith("@") ? 2 : 1).join("/");

it("los scripts sólo importan paquetes declarados en package.json", () => {
  const usados = new Map<string, string>();
  for (const rel of archivos("scripts")) {
    const fuente = readFileSync(join(RAIZ, rel), "utf8");
    for (const [, especificador] of fuente.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"'./][^"']*)["']/g)) {
      if (especificador.startsWith("node:") || nativos.has(especificador) || especificador.startsWith("@/")) continue;
      usados.set(nombreDelPaquete(especificador), rel);
    }
  }
  // Que el lector encuentre algo: si no, el test pasaría sin mirar nada.
  // (Desde que se borró reconciliar-sms.mjs, los scripts importan un solo
  // paquete.)
  expect(usados.size).toBeGreaterThan(0);
  expect([...usados].filter(([nombre]) => !declarados.has(nombre)).map(([nombre, rel]) => `${nombre} (${rel})`)).toEqual([]);
});
