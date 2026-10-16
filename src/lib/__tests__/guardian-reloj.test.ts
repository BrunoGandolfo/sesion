// Ningún test que renderiza depende de la hora real.
//
//   - En Hoy, (dashboard)/_components, todo test que renderiza fija la hora
//     (relojFijo de _components/__tests__/reloj-fijo.ts, o setSystemTime): las
//     pantallas de Hoy leen el reloj por su cuenta.
//   - En el resto del repositorio, un test que renderiza y lee el reloj real
//     él mismo (`new Date()` sin argumentos o `Date.now()`) también la fija:
//     su veredicto no puede cambiar según el día o la hora en que corre.
//
// PENDIENTES son tests de pantalla que hoy leen el reloj real y que arregla
// la rama que tiene esas pantallas. Una entrada que ya fija la hora, o que
// ya no existe, falla: hay que sacarla.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, it } from "vitest";

const RAIZ = process.cwd();
const HOY = join(RAIZ, "src", "app", "(dashboard)", "_components");
const CARPETAS = [join(RAIZ, "src"), join(RAIZ, "pruebas")];

const PENDIENTES = [
  "src/app/(dashboard)/agenda/_components/__tests__/cancelar-serie.test.tsx",
  "src/app/(dashboard)/agenda/_components/__tests__/detalle-nota-fallida.test.tsx",
  "src/app/(dashboard)/pacientes/[id]/_components/__tests__/turnos-pagos-tab.test.tsx",
  "src/components/forms/__tests__/nuevo-turno-propuesta.test.tsx",
  "src/components/layout/__tests__/menus.test.tsx",
  // Grabación: useFakeTimers sin setSystemTime (sólo un vencimiento relativo).
  "src/lib/__tests__/grabacion-diagnostico-integracion.test.tsx",
];

function tests(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules"
      ? []
      : e.isDirectory()
        ? tests(join(dir, e.name))
        : /\.test\.tsx?$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
  );
}

const renderiza = (fuente: string) => /\brender(Hook)?\(/.test(fuente);
const leeElReloj = (fuente: string) => /new Date\(\s*\)|\bDate\.now\(\)/.test(fuente);
// useFakeTimers solo no alcanza: sin setSystemTime arranca en la hora real.
const fijaLaHora = (fuente: string) => /\brelojFijo\(|\.setSystemTime\(/.test(fuente);

const todos = CARPETAS.flatMap(tests).map((abs) => ({
  rel: relative(RAIZ, abs).split("\\").join("/"),
  abs,
  fuente: readFileSync(abs, "utf8"),
}));

it("todo test que renderiza en Hoy fija la hora", () => {
  const sinReloj = todos
    .filter(({ abs, fuente }) => abs.startsWith(HOY) && renderiza(fuente) && !/\brelojFijo\(|\.setSystemTime\(/.test(fuente))
    .map(({ rel }) => rel);
  expect(sinReloj, "Agregá relojFijo(instante) de _components/__tests__/reloj-fijo.ts").toEqual([]);
});

it("ningún otro test que renderiza lee la hora real sin fijarla", () => {
  const conRelojReal = todos
    .filter(({ fuente }) => renderiza(fuente) && leeElReloj(fuente) && !fijaLaHora(fuente))
    .map(({ rel }) => rel);
  expect(
    conRelojReal.filter((rel) => !PENDIENTES.includes(rel)),
    "Fijá la hora: vi.useFakeTimers({ toFake: ['Date'] }) y vi.setSystemTime(instante)",
  ).toEqual([]);
  expect(PENDIENTES.filter((rel) => !conRelojReal.includes(rel)), "Ya no leen la hora real: sacalos de PENDIENTES").toEqual([]);
});

it("el guardián ve los tests que tiene que ver", () => {
  expect(todos.filter(({ abs, fuente }) => abs.startsWith(HOY) && renderiza(fuente)).length).toBeGreaterThanOrEqual(12);
  expect(todos.filter(({ fuente }) => renderiza(fuente)).length).toBeGreaterThan(100);
  expect(leeElReloj("const t = new Date();")).toBe(true);
  expect(leeElReloj("Date.now() + 1")).toBe(true);
  expect(leeElReloj('new Date("2026-10-01T12:00:00Z")')).toBe(false);
});
