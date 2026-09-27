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
