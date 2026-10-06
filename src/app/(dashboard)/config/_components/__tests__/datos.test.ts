// Las reglas puras del autoguardado de Tu consultorio: qué campos de un lote
// salen y cuáles quedan pendientes por inválidos.
import { describe, expect, it } from "vitest";

import { FORM_VACIO, formDesdeConfig, patchDesdeCampos, type FormConfig } from "../datos";
import type { Configuracion } from "@/types/domain";

const FORM: FormConfig = {
  ...FORM_VACIO,
  nombreProfesional: "Mariana",
  direccion: "Calle 123",
  tarifaDefault: "1500",
};

describe("patchDesdeCampos", () => {
  it("convierte la tarifa a número y manda solo los campos pedidos", () => {
    expect(patchDesdeCampos(FORM, ["tarifaDefault", "direccion"])).toEqual({
      patch: { tarifaDefault: 1500, direccion: "Calle 123" },
      campos: ["tarifaDefault", "direccion"],
      invalido: false,
    });
  });

  it.each([
    ["tarifa vacía", { tarifaDefault: " " }, "tarifaDefault"],
    ["tarifa con decimales", { tarifaDefault: "10.5" }, "tarifaDefault"],
    ["tarifa negativa", { tarifaDefault: "-1" }, "tarifaDefault"],
    ["nombre vacío", { nombreProfesional: "  " }, "nombreProfesional"],
    ["plantilla vacía", { templateRecordatorio: "" }, "templateRecordatorio"],
  ] as const)("%s queda afuera y marca el lote como inválido, sin frenar a los válidos", (_caso, cambio, campo) => {
    const resultado = patchDesdeCampos({ ...FORM, ...cambio }, [campo, "direccion"]);
    expect(resultado).toEqual({ patch: { direccion: "Calle 123" }, campos: ["direccion"], invalido: true });
  });

  it("el momento del aviso y el enfoque salen tal cual", () => {
    const form: FormConfig = { ...FORM, recordatorioModo: "misma_manana", orientacionTeorica: "gestalt" };
    expect(patchDesdeCampos(form, ["recordatorioModo", "orientacionTeorica"]).patch).toEqual({
      recordatorioModo: "misma_manana",
      orientacionTeorica: "gestalt",
    });
  });
});

describe("formDesdeConfig", () => {
  it("lleva la tarifa a texto para el campo", () => {
    const config = {
      nombreProfesional: "Mariana",
      direccion: "Calle 123",
      whatsappOrigen: "099",
      tarifaDefault: 1500,
      recordatorioModo: "dia_anterior",
      templateRecordatorio: "Hola {{nombre}}",
      orientacionTeorica: "cbt_mi",
    } as Configuracion;
    expect(formDesdeConfig(config).tarifaDefault).toBe("1500");
  });
});
