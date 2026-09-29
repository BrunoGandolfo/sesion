// La pantalla de la sesión pregunta a la tabla de operaciones: cada estado
// tiene su cuerpo y sus acciones, y "Pedir de nuevo" sigue la regla del
// servidor (forense 03, P3-12 y P3-23).
import { describe, expect, it } from "vitest";

import { FEEDBACK_REPEDIBLE } from "@/app/api/_lib/casos-uso/sesion/reintentar-feedback";
import { ESTADOS_EN_PROCESO, ESTADOS_SESION, OPERACIONES } from "@/lib/sesion-clinica/estados";

import {
  accionesDeUsuaria,
  CUERPO,
  cuerpoDe,
  FEEDBACK_REPEDIBLE_EN_PANTALLA,
  sePuedePedirFeedback,
} from "../acciones-sesion";

describe("cuerpo de la pantalla", () => {
  it("hay un cuerpo para cada estado del enum, y 'escribiendo' es exactamente ESTADOS_EN_PROCESO", () => {
    expect(Object.keys(CUERPO).sort()).toEqual([...ESTADOS_SESION].sort());
    const escribiendo = ESTADOS_SESION.filter((e) => cuerpoDe(e) === "escribiendo");
    expect(escribiendo.sort()).toEqual([...ESTADOS_EN_PROCESO].sort());
    expect(ESTADOS_SESION.filter((e) => CUERPO[e] === "escribiendo").sort()).toEqual([...ESTADOS_EN_PROCESO].sort());
  });

  it("la nota se ve donde hay nota; la fallida y la que se graba tienen su cuerpo", () => {
    expect(cuerpoDe("revision")).toBe("nota");
    expect(cuerpoDe("aprobada")).toBe("nota");
    expect(cuerpoDe("fallida")).toBe("fallida");
    expect(cuerpoDe("grabando")).toBe("sin-nota");
  });
});

describe("accionesDeUsuaria", () => {
  it("coincide con los estados de partida de OPERACIONES", () => {
    for (const estado of ESTADOS_SESION) {
      const a = accionesDeUsuaria(estado);
      expect(a.aprobar).toBe((OPERACIONES.aprobar.desde as readonly string[]).includes(estado));
      expect(a.descartar).toBe((OPERACIONES.reprocesar.desde as readonly string[]).includes(estado));
      expect(a.reintentar).toBe((OPERACIONES.reintentar.desde as readonly string[]).includes(estado));
      expect(a.eliminar).toBe((OPERACIONES.eliminar.desde as readonly string[]).includes(estado));
    }
  });
});

describe("sePuedePedirFeedback", () => {
  it("la lista de la pantalla es la del servidor", () => {
    expect([...FEEDBACK_REPEDIBLE_EN_PANTALLA].sort()).toEqual([...FEEDBACK_REPEDIBLE].sort());
  });

  it("revision o aprobada, feedback fallido o no pedido, y con transcripción", () => {
    const base = { estado: "revision", feedbackEstado: "fallido" as const, modeloAsr: "universal" };
    expect(sePuedePedirFeedback(base)).toBe(true);
    expect(sePuedePedirFeedback({ ...base, estado: "aprobada", feedbackEstado: "no_pedido" })).toBe(true);
    expect(sePuedePedirFeedback({ ...base, feedbackEstado: "pendiente" })).toBe(false);
    expect(sePuedePedirFeedback({ ...base, feedbackEstado: "listo" })).toBe(false);
    expect(sePuedePedirFeedback({ ...base, modeloAsr: null })).toBe(false);
    expect(sePuedePedirFeedback({ ...base, estado: "fallida" })).toBe(false);
  });
});
