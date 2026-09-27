// El fixture de las pruebas de la pantalla es la respuesta de ejemplo del
// contrato, y la respuesta de ejemplo pasa el schema con que el servidor
// valida antes de responder: si alguno de los tres se mueve, esto avisa.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { resumenFinanzasSchema } from "@/app/api/_lib/casos-uso/finanzas";

import { RESPUESTA_EJEMPLO } from "./respuesta-ejemplo";

it("el fixture es el ejemplo de docs/contrato-finanzas.md y cumple el schema", () => {
  const doc = readFileSync(join(process.cwd(), "docs", "contrato-finanzas.md"), "utf8");
  const ejemplo = JSON.parse(doc.split("~~~json")[1].split("~~~")[0]);
  expect(RESPUESTA_EJEMPLO).toEqual(ejemplo);
  expect(resumenFinanzasSchema.parse(RESPUESTA_EJEMPLO)).toEqual(RESPUESTA_EJEMPLO);
});
