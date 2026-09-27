// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Contador, Latido, AnilloProgreso } from "../movimiento";
import { TIEMPOS } from "@/lib/movimiento";
const excluidos = /(__tests__|\.test\.|\/grabacion\/|\/grabar\/|\/graficos\/|brief|contexto-clinico|ContextoGoldenThreadView|recorrido-tab)/;
function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (excluidos.test(p)) return [];
    return e.isDirectory() ? fuentes(p) : /\.(tsx|css)$/.test(p) ? [p] : [];
  });
}
it("solo admite las tres duraciones y la curva común en el código editable", () => {
  expect(Object.values(TIEMPOS)).toEqual([150,180,220]);
  for (const p of fuentes(join(process.cwd(), "src"))) {
    const s = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"");
    expect(s, p).not.toMatch(/duration:\s*[1-9]|duration:\s*0\.[0-9]|ease:\s*["']|type:\s*["']spring|repeat:\s*Infinity/);
    expect(s, p).not.toMatch(/duration-\d+/);
  }
});
// Lupita como presencia (docs/diseno/06-lupita-presencia.md, sección 3)
// trajo cuatro tiempos propios —TIEMPOS_LUPITA— y la respiración, un loop CSS.
// La prueba de arriba no se aflojó por eso: TIEMPOS sigue siendo de tres
// valores y los tiempos de Lupita no entran a la app general. Esta prueba es
// la otra mitad: sólo los archivos de Lupita pueden nombrarlos, y los únicos
// loops CSS son el de la nota que se escribe y la respiración.
const ARCHIVOS_DE_LUPITA = [
  "src/lib/movimiento.ts",
  "src/components/ui/lupita.tsx",
  "src/components/layout/presencia-lupita.tsx",
  "src/app/globals.css",
];
it("los tiempos de Lupita y su respiración no salen de sus archivos", () => {
  const raiz = process.cwd();
  function todas(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = join(dir, e.name);
      if (/__tests__|\.test\./.test(p)) return [];
      return e.isDirectory() ? todas(p) : /\.(tsx?|css)$/.test(p) ? [p] : [];
    });
  }
  for (const p of todas(join(raiz, "src"))) {
    const relativo = p.slice(raiz.length + 1);
    if (ARCHIVOS_DE_LUPITA.includes(relativo)) continue;
    const s = readFileSync(p, "utf8");
    expect(s, relativo).not.toMatch(/TIEMPOS_LUPITA|--lupita-respiracion|lupita-respira|repeat:/);
    expect(s, relativo).not.toMatch(/\binfinite\b/);
  }
  const css = readFileSync(join(raiz, "src/app/globals.css"), "utf8");
  const loops = css.match(/animation:[^;]*infinite/g) ?? [];
  expect(loops).toHaveLength(2);
  expect(loops.join(" ")).toMatch(/gira-procesando/);
  expect(loops.join(" ")).toMatch(/lupita-respira/);
});
it("los totales se leen completos al montar y al cambiar, sin contar desde cero", () => {
  const { rerender } = render(<Contador valor={2500} formato={n => "$" + n} />);
  expect(screen.getByText("$2500")).toBeTruthy();
  rerender(<Contador valor={4200} formato={n => "$" + n} />);
  expect(screen.getByText("$4200")).toBeTruthy();
});
it("los indicadores conservan su significado sin pulsos ni giros", () => {
  const { container } = render(<><Latido etiqueta="Grabando" /><AnilloProgreso etiqueta="Procesando" /></>);
  expect(screen.getByRole("img", {name:"Grabando"})).toBeTruthy();
  expect(screen.getByRole("img", {name:"Procesando"})).toBeTruthy();
  expect(container.innerHTML).not.toMatch(/transform:|animation:/);
});

it("movimiento reducido apaga también las transiciones CSS y el desplazamiento suave", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important/);
  expect(css).toContain("scroll-behavior: auto !important");
});
