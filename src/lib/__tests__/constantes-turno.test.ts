import { describe, expect, it } from "vitest";
import {
  EstadoPago as EnumEstadoPago,
  EstadoTurno as EnumEstadoTurno,
  FrecuenciaSerie as EnumFrecuenciaSerie,
  MetodoPago as EnumMetodoPago,
  Modalidad as EnumModalidad,
} from "@prisma/client";

import {
  DURACIONES,
  DURACION_DEFAULT,
  ESTADOS_PAGO,
  ESTADOS_TURNO,
  FRECUENCIAS_SERIE,
  FRECUENCIAS_TURNO,
  METODOS_PAGO,
  MODALIDADES,
  duracionSchema,
  esDuracion,
  frecuenciaTurnoSchema,
  metodoPagoSchema,
} from "@/lib/constantes-turno";
import { METODO_PAGO_LABEL } from "@/lib/glosario";

// Guardián de las tres copias que no pueden derivar de constantes-turno.ts:
// los enums de Postgres (vía el cliente que genera Prisma), el CHECK de
// duracion (documentado: se lee a mano) y las etiquetas del glosario.
// Si alguien agrega un método de pago en un solo lado, esto falla en CI.

function ordenado(valores: readonly string[]): string[] {
  return [...valores].sort();
}

describe("constantes-turno ↔ enums de Prisma", () => {
  it("MODALIDADES es el enum modalidad", () => {
    expect(ordenado(MODALIDADES)).toEqual(ordenado(Object.values(EnumModalidad)));
  });

  it("METODOS_PAGO es el enum metodo_pago", () => {
    expect(ordenado(METODOS_PAGO)).toEqual(ordenado(Object.values(EnumMetodoPago)));
  });

  it("ESTADOS_TURNO es el enum estado_turno", () => {
    expect(ordenado(ESTADOS_TURNO)).toEqual(
      ordenado(Object.values(EnumEstadoTurno)),
    );
  });

  it("ESTADOS_PAGO es el enum estado_pago", () => {
    expect(ordenado(ESTADOS_PAGO)).toEqual(ordenado(Object.values(EnumEstadoPago)));
  });

  it("FRECUENCIAS_SERIE es el enum frecuencia_serie", () => {
    expect(ordenado(FRECUENCIAS_SERIE)).toEqual(
      ordenado(Object.values(EnumFrecuenciaSerie)),
    );
  });
});

describe("constantes-turno ↔ glosario", () => {
  it("METODO_PAGO_LABEL tiene exactamente una etiqueta por método", () => {
    expect(ordenado(Object.keys(METODO_PAGO_LABEL))).toEqual(
      ordenado(METODOS_PAGO),
    );
  });
});

describe("duraciones", () => {
  it("el default está en la lista y es el de la columna", () => {
    expect(esDuracion(DURACION_DEFAULT)).toBe(true);
    expect(DURACION_DEFAULT).toBe(50);
  });

  it("esDuracion y duracionSchema dicen lo mismo", () => {
    for (const d of DURACIONES) {
      expect(esDuracion(d)).toBe(true);
      expect(duracionSchema.safeParse(d).success).toBe(true);
    }
    for (const otro of [0, 47, 120, "50", null, undefined]) {
      expect(esDuracion(otro)).toBe(false);
      expect(duracionSchema.safeParse(otro).success).toBe(false);
    }
  });
});

describe("frecuencias", () => {
  it("el formulario ofrece único más las frecuencias de serie", () => {
    expect(FRECUENCIAS_TURNO).toEqual(["unico", ...FRECUENCIAS_SERIE]);
    expect(frecuenciaTurnoSchema.safeParse("unico").success).toBe(true);
    expect(frecuenciaTurnoSchema.safeParse("mensual").success).toBe(false);
  });

  it("metodoPagoSchema rechaza lo que no está en la lista", () => {
    expect(metodoPagoSchema.safeParse("cripto").success).toBe(false);
  });
});
