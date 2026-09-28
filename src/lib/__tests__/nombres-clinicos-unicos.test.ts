import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import enumsClinicos from "../../../processor/contrato/enums-clinicos.json";
import {
  estaEnDiccionario,
  formatearEtiqueta,
  NOMBRE_ALIANZA,
  NOMBRE_FLAG,
  NOMBRE_INTERVENCION,
} from "@/lib/etiquetas";

// Los nombres clínicos (intervenciones, flags de riesgo, alianza) tienen una
// sola fuente: el DICCIONARIO de etiquetas.ts. Antes estaban además en el
// banner de riesgo y en dos pantallas, letra por letra iguales hasta que
// alguien corrigiera uno solo.

describe("mapas NOMBRE_* de etiquetas.ts", () => {
  it.each([
    ["tipoIntervencion", NOMBRE_INTERVENCION],
    ["flagRiesgo", NOMBRE_FLAG],
    ["alianzaTerapeutica", NOMBRE_ALIANZA],
  ] as const)("cubren exactamente el contrato %s, cada clave con su nombre del diccionario", (enumeracion, mapa) => {
    const claves = enumsClinicos[enumeracion];
    expect(Object.keys(mapa).sort()).toEqual([...claves].sort());
    for (const clave of claves) {
      expect(estaEnDiccionario(clave), clave).toBe(true);
      expect((mapa as Record<string, string>)[clave]).toBe(formatearEtiqueta(clave));
    }
  });
});

it("ningún componente de src/components escribe un nombre clínico a mano", () => {
  // "Otra" es también una palabra común: no identifica un nombre clínico.
  const nombres = new Set(
    [...Object.values(NOMBRE_INTERVENCION), ...Object.values(NOMBRE_FLAG), ...Object.values(NOMBRE_ALIANZA)]
      .filter((nombre) => nombre !== "Otra"),
  );
  const infracciones: string[] = [];
  function recorrer(carpeta: string) {
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const archivo = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name !== "__tests__") recorrer(archivo);
        continue;
      }
      if (!archivo.endsWith(".tsx")) continue;
      const fuente = ts.createSourceFile(archivo, fs.readFileSync(archivo, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visitar = (nodo: ts.Node) => {
        const texto =
          ts.isStringLiteralLike(nodo) ? nodo.text
          : ts.isJsxText(nodo) ? nodo.text.trim()
          : null;
        if (texto !== null && nombres.has(texto)) {
          const linea = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1;
          infracciones.push(`${archivo}:${linea} "${texto}"`);
        }
        ts.forEachChild(nodo, visitar);
      };
      visitar(fuente);
    }
  }
  recorrer(path.join("src", "components"));
  expect(infracciones).toEqual([]);
});
