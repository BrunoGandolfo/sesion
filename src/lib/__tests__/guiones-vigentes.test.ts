// Los guiones de prueba fuera de vitest (pruebas/) y la ayuda no se quedan
// con nombres o versiones que la app ya cambió. Nadie los corre en CI: si
// quedan viejos, fallan recién el día que alguien los necesita.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONSENTIMIENTO_VERSION } from "@/lib/consentimiento";
import { NOTA_GUARDADA, NOTA_LISTA, NOTA_PROCESANDO, PARA_REVISAR } from "@/lib/glosario";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const plano = (t: string) => t.replace(/\s+/g, " ");

describe("pruebas/grabador-ajustes/verificar.mjs", () => {
  const guion = leer("pruebas/grabador-ajustes/verificar.mjs");

  it("firma el consentimiento con la versión vigente, leída del código", () => {
    // Una versión escrita a mano da 409 consentimiento_version_vieja (B1).
    expect(guion).not.toMatch(/textoVersion:\s*["'`]\d/);
    const lectura = /\/(export const CONSENTIMIENTO_VERSION = "\(\[\^"\]\+\)")\//.exec(guion);
    expect(lectura, "verificar.mjs ya no lee CONSENTIMIENTO_VERSION").not.toBeNull();
    const fuente = leer("src/lib/consentimiento.ts");
    expect(new RegExp(lectura![1]).exec(fuente)?.[1]).toBe(CONSENTIMIENTO_VERSION);
  });
});

describe("el chip de la nota", () => {
  it("el recorrido e2e busca el chip con el nombre de la pantalla", () => {
    const recorrido = leer("pruebas/e2e/recorrido.mjs");
    expect(recorrido).toContain(`getByText('${NOTA_LISTA}', { exact: true })`);
    expect(recorrido).not.toContain(`getByText('${NOTA_GUARDADA}'`);
  });

  it("la ayuda lo nombra como la pantalla, sin el dorado", () => {
    const ficha = plano(leer("docs/ayuda/04-pacientes-y-ficha.md"));
    const nota = plano(leer("docs/ayuda/08-la-nota-clinica.md"));
    for (const texto of [ficha, nota]) {
      expect(texto).toContain(`**${PARA_REVISAR}**`);
      expect(texto).toContain(`**${NOTA_LISTA}**`);
      expect(texto).not.toMatch(/chip[^.]*Nota guardada/);
      expect(texto).not.toMatch(/\(dorado\)/);
    }
    expect(ficha).toContain(`**${NOTA_PROCESANDO}**`);
  });
});

describe("docs/ayuda/14", () => {
  it("no anuncia mensajes del navegador en inglés: la app ya no los muestra", () => {
    expect(plano(leer("docs/ayuda/14-cuando-algo-falla.md"))).not.toMatch(/en inglés/);
  });
});
