// La suite corre en UTC también cuando se lanza un archivo suelto
// (`npx vitest run archivo`), no sólo por los scripts de npm. Varias
// cabeceras de test indican correrlos así, y con la hora local de la
// máquina (Montevideo, -03) un `new Date(2026, 8, 3, 15)` cae en otro
// instante: el veredicto dependería de cómo se lanzó. Lo fija vitest.config.ts.
import { expect, it } from "vitest";

it("los tests corren en UTC", () => {
  expect(process.env.TZ).toBe("UTC");
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  expect(new Date(2026, 8, 3, 15, 0, 0).toISOString()).toBe("2026-09-03T15:00:00.000Z");
});
