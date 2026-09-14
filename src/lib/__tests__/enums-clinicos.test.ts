import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENUMS_CLINICOS,
  alianzaTerapeuticaSchema,
  confianzaModeloSchema,
  datosEstructuradosSchema,
  flagRiesgoSchema,
  nivelRiesgoSchema,
  tipoIntervencionSchema,
} from "@/lib/sesion-clinica/schema";

// El contrato compartido con el worker: processor/contrato/enums-clinicos.json.
// Lo que se prueba es que schema.ts LEE ese archivo (los z.enum salen de ahí)
// y que el archivo está bien formado. Los valores no se copian acá: la
// comparación es contra el JSON crudo, leído del disco por otro camino.

const RUTA = resolve(process.cwd(), "processor", "contrato", "enums-clinicos.json");
const CLAVES = [
  "tipoIntervencion",
  "flagRiesgo",
  "nivelRiesgo",
  "alianzaTerapeutica",
  "confianzaModelo",
] as const;

function crudo(): Record<string, unknown> {
  return JSON.parse(readFileSync(RUTA, "utf8")) as Record<string, unknown>;
}

describe("contrato de enums clínicos", () => {
  it("el JSON tiene las cinco claves, sin vacíos ni repetidos", () => {
    const json = crudo();
    for (const clave of CLAVES) {
      const valores = json[clave];
      expect(Array.isArray(valores), clave).toBe(true);
      const lista = valores as unknown[];
      expect(lista.length, clave).toBeGreaterThan(0);
      expect(lista.every((v) => typeof v === "string" && v.length > 0), clave).toBe(true);
      expect(new Set(lista).size, `${clave} repite valores`).toBe(lista.length);
    }
  });

  it("schema.ts importa exactamente lo que dice el archivo", () => {
    const json = crudo();
    for (const clave of CLAVES) {
      expect(ENUMS_CLINICOS[clave]).toEqual(json[clave]);
    }
  });

  it("las claves del objeto flagsRiesgo son las flags del contrato, más detalle", () => {
    const json = crudo() as { flagRiesgo: string[] };
    const shape = datosEstructuradosSchema.shape.flagsRiesgo.unwrap().shape;
    expect(Object.keys(shape).filter((k) => k !== "detalle").sort()).toEqual(
      [...json.flagRiesgo].sort(),
    );
  });

  it("los z.enum aceptan cada valor del archivo y rechazan uno inventado", () => {
    const json = crudo() as Record<(typeof CLAVES)[number], string[]>;
    const schemas = {
      tipoIntervencion: tipoIntervencionSchema,
      flagRiesgo: flagRiesgoSchema,
      nivelRiesgo: nivelRiesgoSchema,
      alianzaTerapeutica: alianzaTerapeuticaSchema,
      confianzaModelo: confianzaModeloSchema,
    };
    for (const clave of CLAVES) {
      expect(schemas[clave].options).toEqual(json[clave]);
      for (const valor of json[clave]) {
        expect(schemas[clave].safeParse(valor).success, `${clave}: ${valor}`).toBe(true);
      }
      expect(schemas[clave].safeParse("valor_inventado").success).toBe(false);
    }
  });
});
