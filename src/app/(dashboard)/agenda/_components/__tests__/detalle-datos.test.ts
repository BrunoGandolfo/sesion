// Las lecturas y las reglas del detalle del turno, sin pantalla. Las reglas
// en sí (accionClinicaDe, sePuedeCobrar) tienen sus propios tests: acá se
// prueba que el detalle las usa con la sesión que corresponde.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sePuedeCobrar } from "@/app/api/_lib/domain";
import { accionClinicaDe } from "@/lib/sesion-clinica/accion-clinica";
import type { TurnoConPaciente } from "@/types/domain";

import { accionesDelDetalle, leerRecordatorio, leerSesion } from "../detalle-datos";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
}));

// Miércoles 16 de septiembre de 2026, 12:00 de Montevideo.
const AHORA = new Date("2026-09-16T15:00:00.000Z");

function turno(parcial: Partial<TurnoConPaciente> = {}): TurnoConPaciente {
  return {
    id: "t1", pacienteId: "p1", organizationId: "org", serieId: null, sesionClinica: null,
    fecha: new Date("2026-09-16T13:00:00.000Z"), duracion: 50, modalidad: "presencial",
    estado: "programado", tarifaCobrada: 2200, pagoEstado: "pendiente", pagoMetodo: null,
    pagoFecha: null, notas: null,
    paciente: { id: "p1", nombre: "Lucía", apellido: "Prueba", telefono: "099" },
    ...parcial,
  } as TurnoConPaciente;
}

describe("leerSesion y leerRecordatorio", () => {
  beforeEach(() => m.get.mockReset());

  it("piden la sesión y el recordatorio del turno con el signal", async () => {
    const control = new AbortController();
    m.get.mockResolvedValueOnce({ id: "s1", estado: "revision" });
    expect(await leerSesion("t1", control.signal)).toEqual({ id: "s1", estado: "revision" });
    expect(m.get).toHaveBeenLastCalledWith("/api/sesion-clinica?turnoId=t1", { signal: control.signal });

    m.get.mockResolvedValueOnce([{ id: "r1" }, { id: "r0" }]);
    expect(await leerRecordatorio("t1", control.signal)).toEqual({ id: "r1" });
    expect(m.get).toHaveBeenLastCalledWith("/api/sms/envios?turnoId=t1", { signal: control.signal });
  });

  it("sin recordatorios devuelve null", async () => {
    m.get.mockResolvedValueOnce([]);
    expect(await leerRecordatorio("t1")).toBeNull();
  });
});

describe("accionesDelDetalle", () => {
  it("decide con accionClinicaDe y sePuedeCobrar, no con una copia", () => {
    const t = turno({ estado: "realizado" });
    const sesion = { id: "s1", estado: "fallida" };
    const acciones = accionesDelDetalle(t, sesion, AHORA);
    expect(acciones.clinica).toEqual(accionClinicaDe(sesion, t, AHORA));
    expect(acciones.puedeCobrar).toBe(sePuedeCobrar(t, AHORA));
    expect(acciones.sesion).toBe(sesion);
  });

  it("mientras la lectura no contestó vale la sesión que trae el turno", () => {
    const deLaAgenda = { id: "s9", estado: "revision" };
    const acciones = accionesDelDetalle(turno({ sesionClinica: deLaAgenda }), "sin-dato", AHORA);
    expect(acciones.sesion).toBe(deLaAgenda);
    expect(acciones.clinica).toEqual({ tipo: "nota", sesionId: "s9", estado: "revision" });
  });

  it("con la lectura en la mano, manda la lectura aunque diga que no hay sesión", () => {
    const acciones = accionesDelDetalle(turno({ sesionClinica: { id: "s9", estado: "revision" } }), null, AHORA);
    expect(acciones.sesion).toBeNull();
  });

  it.each([
    ["programado", true, true],
    ["realizado", true, false],
    ["cancelado", false, false],
    ["ausente", false, false],
  ] as const)("%s: acciones %s, programado %s", (estado, grabarORevisar, esProgramado) => {
    const acciones = accionesDelDetalle(turno({ estado }), null, AHORA);
    expect(acciones.puedeGrabarORevisar).toBe(grabarORevisar);
    expect(acciones.esProgramado).toBe(esProgramado);
  });

  it("deshacer el cobro solo con el turno cobrado", () => {
    expect(accionesDelDetalle(turno({ estado: "realizado", pagoEstado: "pagado" }), null, AHORA).puedeDeshacerCobro).toBe(true);
    expect(accionesDelDetalle(turno({ estado: "realizado" }), null, AHORA).puedeDeshacerCobro).toBe(false);
  });
});
