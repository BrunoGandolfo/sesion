// La plantilla del aviso de cobro: configurable en Tu consultorio, con el
// texto de siempre como default, y una sola función que arma el texto para
// el SMS, el WhatsApp y la vista previa de Cobros.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TEMPLATE_COBRO_DEFAULT, textoDelCobro } from "@/lib/deudas";
import { configUpdateSchema } from "@/app/api/_lib/schemas";

const CONFIG = {
  templateCobro: TEMPLATE_COBRO_DEFAULT,
  nombreProfesional: "Mariana Roldán",
  direccion: "Bulevar Artigas 1234",
  whatsappOrigen: "+59899000111",
};
const PACIENTE = { nombre: "Lucía", apellido: "Fernández" };

describe("plantilla de cobro", () => {
  it("el default de la base es el texto que el aviso tenía fijo", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const linea = schema.split("\n").find((l) => /^\s*templateCobro\s/.test(l));
    const literal = linea?.match(/@default\((".*?")\)/)?.[1];
    expect(literal && JSON.parse(literal)).toBe(TEMPLATE_COBRO_DEFAULT);
    const migracion = readFileSync("prisma/migrations/20261021120000_plantilla_cobro/migration.sql", "utf8");
    expect(migracion).toContain(`DEFAULT '${TEMPLATE_COBRO_DEFAULT}'`);
  });

  it("con el default sale, carácter por carácter, el mismo texto de antes", () => {
    expect(textoDelCobro(CONFIG, PACIENTE, { sesiones: 2, monto: 2400 })).toBe(
      "Consultorio Mariana Roldán\nLucía, tenés 2 sesiones pendientes de pago: $ 2.400.",
    );
    expect(textoDelCobro(CONFIG, PACIENTE, { sesiones: 1, monto: 1200 })).toContain("1 sesión pendiente de pago");
  });

  it("acepta las variables de la plantilla de turno que tienen sentido sin turno", () => {
    const texto = textoDelCobro(
      { ...CONFIG, templateCobro: "{{nombre}} {{apellido}}: {{sesiones}} por {{monto}}. {{direccion}}. Llamá al {{telefonoConsultorio}}. {{profesional}}" },
      PACIENTE,
      { sesiones: 3, monto: 3600 },
    );
    expect(texto).toBe("Lucía Fernández: 3 por $ 3.600. Bulevar Artigas 1234. Llamá al +59899000111. Mariana Roldán");
  });

  it("un valor con $ entra literal", () => {
    expect(textoDelCobro({ ...CONFIG, templateCobro: "{{nombre}}" }, { nombre: "Ana $&", apellido: "" }, { sesiones: 1, monto: 1 })).toBe("Ana $&");
  });

  it("el PATCH de /api/config acepta la plantilla y no la deja vacía", () => {
    expect(configUpdateSchema.parse({ templateCobro: "Hola {{nombre}}" })).toEqual({ templateCobro: "Hola {{nombre}}" });
    expect(configUpdateSchema.safeParse({ templateCobro: "   " }).success).toBe(false);
  });
});
