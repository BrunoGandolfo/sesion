import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Los componentes formatean fechas con la capa de format.ts (fechaLarga,
// hora, …), no con los formatear*Mvd del motor: dos nombres para lo mismo
// hacían buscar en dos lados. Ver la cabecera de "Fechas" en format.ts.
it("ningún componente de src/components importa un formatear*Mvd", () => {
  const infracciones: string[] = [];
  function recorrer(carpeta: string) {
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const archivo = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name !== "__tests__") recorrer(archivo);
        continue;
      }
      if (!/\.tsx?$/.test(archivo)) continue;
      const fuente = ts.createSourceFile(archivo, fs.readFileSync(archivo, "utf8"), ts.ScriptTarget.Latest, true);
      for (const st of fuente.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        if (!st.moduleSpecifier.text.endsWith("fechas-montevideo")) continue;
        const nombres = st.importClause?.namedBindings;
        if (!nombres || !ts.isNamedImports(nombres)) continue;
        for (const el of nombres.elements) {
          const nombre = (el.propertyName ?? el.name).text;
          if (/^formatear.*Mvd$/.test(nombre)) infracciones.push(`${archivo}: ${nombre}`);
        }
      }
    }
  }
  recorrer(path.join("src", "components"));
  expect(infracciones).toEqual([]);
});
