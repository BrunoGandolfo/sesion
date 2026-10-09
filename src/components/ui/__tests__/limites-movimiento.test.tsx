// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Latido, AnilloProgreso } from "../movimiento";
import { TIEMPOS } from "@/lib/movimiento";
const excluidos = /(__tests__|\.test\.|\/grabacion\/|\/grabar\/|\/graficos\/|brief|contexto-clinico|ContextoGoldenThreadView|recorrido-tab)/;
function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (excluidos.test(p)) return [];
    return e.isDirectory() ? fuentes(p) : /\.(tsx|css)$/.test(p) ? [p] : [];
  });
}
// Los únicos loops permitidos, con su motivo. Como gira-procesando
// (globals.css): una espera de decenas de segundos que, quieta, se lee como
// "se colgó". Cada uno respeta prefers-reduced-motion y arma su duración con
// TIEMPOS; ninguno escribe una duración a mano.
const LOOPS_PERMITIDOS: Record<string, string> = {
  "src/components/lux/puntos-leyendo.tsx": "los puntos de \"Lux está leyendo\" mientras Lux lee el material y las transcripciones",
};
it("solo admite las tres duraciones y la curva común en el código editable", () => {
  expect(Object.values(TIEMPOS)).toEqual([150,180,220]);
  for (const p of fuentes(join(process.cwd(), "src"))) {
    const s = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"");
    const conLoop = p.replace(process.cwd() + "/", "") in LOOPS_PERMITIDOS;
    expect(s, p).not.toMatch(/duration:\s*[1-9]|duration:\s*0\.[0-9]|ease:\s*["']|type:\s*["']spring/);
    if (!conLoop) expect(s, p).not.toMatch(/repeat:\s*Infinity/);
    expect(s, p).not.toMatch(/duration-\d+/);
  }
});
it("los indicadores son decorativos y quietos: el texto de al lado dice qué pasa", () => {
  const { container } = render(<><Latido /><AnilloProgreso /></>);
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(2);
  expect(container.innerHTML).not.toMatch(/transform:|animation:/);
});

it("movimiento reducido apaga también las transiciones CSS y el desplazamiento suave", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important/);
  expect(css).toContain("scroll-behavior: auto !important");
});
