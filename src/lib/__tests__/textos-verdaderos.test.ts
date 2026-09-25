// Textos que la profesional lee y que tienen que decir lo que la app hace.
// Desde 5c1bfe2 (18/9/2026) la app no cifra el audio: no hay clave que
// destruir al aprobar, y lo que cifra el audio guardado es el proveedor.

import { describe, expect, it } from "vitest";

import { APROBAR_MENSAJE, TERMINOS_SECCIONES } from "@/lib/glosario";

describe("textos que describen el audio", () => {
  it("la confirmación de aprobar no habla de una clave y dice dónde se borra el audio", () => {
    expect(APROBAR_MENSAJE).not.toMatch(/clave/i);
    expect(APROBAR_MENSAJE).toMatch(/audio se borra/);
    expect(APROBAR_MENSAJE).toMatch(/teléfono/);
    expect(APROBAR_MENSAJE).toMatch(/almacenamiento/);
    expect(APROBAR_MENSAJE).toMatch(/no se puede deshacer/);
  });

  it("los términos dicen que el cifrado del audio en R2 es del proveedor, en reposo", () => {
    const donde = TERMINOS_SECCIONES.find((s) => s.titulo === "Dónde se procesa y se guarda");
    expect(donde?.texto).toContain("cifrado en reposo por el proveedor");
    expect(donde?.texto).not.toContain("guarda el audio cifrado");
  });
});
