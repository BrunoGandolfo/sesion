// Unitario: los estados de una versión del Recorrido y sus operaciones
// (src/lib/hilo/versiones.ts), la tabla que consultan los casos de uso del hilo.
import { describe, expect, it } from "vitest";
import { EstadoVersionHilo } from "@prisma/client";

import {
  ESTADOS_VERSION_HILO,
  estadoDePropuestaNueva,
  OPERACIONES_VERSION,
  puedeVersion,
} from "@/lib/hilo/versiones";

describe("versiones del Recorrido", () => {
  it("los estados son los del enum estado_version_hilo", () => {
    expect([...ESTADOS_VERSION_HILO].sort()).toEqual(Object.values(EstadoVersionHilo).sort());
  });

  it("aceptar sólo desde una propuesta; rechazar también una desactualizada", () => {
    expect(ESTADOS_VERSION_HILO.filter((e) => puedeVersion("aceptar", e))).toEqual(["propuesta"]);
    expect(ESTADOS_VERSION_HILO.filter((e) => puedeVersion("rechazar", e)).sort()).toEqual(["desactualizada", "propuesta"]);
    expect(ESTADOS_VERSION_HILO.filter((e) => puedeVersion("regenerar", e)).sort()).toEqual(["desactualizada", "rechazada"]);
    expect(OPERACIONES_VERSION.desactualizar).toEqual({ desde: ["propuesta"], hacia: "desactualizada" });
  });

  it("una aplicada no se mueve por ninguna operación", () => {
    for (const op of Object.keys(OPERACIONES_VERSION) as Array<keyof typeof OPERACIONES_VERSION>) {
      expect(puedeVersion(op, "aplicada")).toBe(false);
    }
  });

  it("la propuesta nueva es propuesta sobre la vigente y desactualizada si la vigente cambió", () => {
    expect(estadoDePropuestaNueva(3, 3)).toBe("propuesta");
    expect(estadoDePropuestaNueva(2, 3)).toBe("desactualizada");
  });
});
