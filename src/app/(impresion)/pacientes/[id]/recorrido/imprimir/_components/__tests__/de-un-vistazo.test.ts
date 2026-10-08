import { describe, expect, it } from "vitest";

import { hiloVacio } from "@/lib/hilo/contenido";

import { cifrasDeUnVistazo } from "../de-un-vistazo";
import type { Exportacion } from "../formato";

const SESION = "7b0c7e0a-1c4e-4d8a-9a51-0f5d7a9b2c11";

function datos(contenido: Partial<ReturnType<typeof hiloVacio>> | null): Exportacion {
  return {
    sesiones: [{ id: SESION, fecha: "2026-08-01T14:00:00.000Z" }, { id: "s2", fecha: "2026-08-20T14:00:00.000Z" }],
    vigente: contenido ? { contenido: { ...hiloVacio(), ...contenido } } : null,
  } as unknown as Exportacion;
}

describe("De un vistazo", () => {
  it("cuenta lo que la exportación ya trae y nombra la última señal", () => {
    const cifras = cifrasDeUnVistazo(datos({
      objetivosTerapeuticos: [
        { id: "a", descripcion: "Dormir", estado: "activo", fechaInicio: "2026-08-01", fechaCierre: null },
        { id: "b", descripcion: "Manejar", estado: "cerrado", fechaInicio: "2026-08-01", fechaCierre: "2026-09-01" },
      ],
      temasRecurrentes: [{ tema: "Madre", conteo: 2 }, { tema: "Trabajo", conteo: 3 }],
      riesgosHistoricos: [
        { sesionId: SESION, fecha: "2026-09-02", flag: "crisisPanico", detalle: "x" },
        { sesionId: SESION, fecha: "2026-08-20", flag: "autolesion", detalle: "y" },
      ],
    }));
    expect(cifras.map((c) => [c.rotulo, c.valor, c.detalle])).toEqual([
      ["Sesiones con nota", "2", undefined],
      ["Objetivos activos", "1", undefined],
      ["El tema que más vuelve", "Trabajo", "3 sesiones"],
      ["Última señal", "2 sep 2026", expect.any(String)],
    ]);
    expect(cifras.at(-1)?.senal).toBe(true);
  });

  it("sin señales son tres cifras, y sin Recorrido vigente no inventa nada", () => {
    expect(cifrasDeUnVistazo(datos({})).map((c) => c.rotulo)).toEqual(["Sesiones con nota", "Objetivos activos", "El tema que más vuelve"]);
    expect(cifrasDeUnVistazo(datos(null)).map((c) => c.valor)).toEqual(["2", "—", "—"]);
  });
});
