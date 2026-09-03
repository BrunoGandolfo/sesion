import { describe, it, expect } from "vitest";

import {
  calcularDeudores,
  esDeudaPendiente,
  type TurnoParaDeuda,
} from "@/app/api/_lib/domain";

describe("esDeudaPendiente", () => {
  it("realizado + pendiente es deuda", () => {
    expect(esDeudaPendiente({ estado: "realizado", pagoEstado: "pendiente" })).toBe(
      true,
    );
  });

  it("realizado + pagado no es deuda", () => {
    expect(esDeudaPendiente({ estado: "realizado", pagoEstado: "pagado" })).toBe(
      false,
    );
  });

  it("programado + pendiente no es deuda (todavía no se dio la sesión)", () => {
    expect(esDeudaPendiente({ estado: "programado", pagoEstado: "pendiente" })).toBe(
      false,
    );
  });

  it("cancelado o ausente nunca es deuda", () => {
    expect(esDeudaPendiente({ estado: "cancelado", pagoEstado: "pendiente" })).toBe(
      false,
    );
    expect(esDeudaPendiente({ estado: "ausente", pagoEstado: "pendiente" })).toBe(
      false,
    );
  });
});

describe("calcularDeudores", () => {
  const ana = { nombre: "Ana", apellido: "Pérez" };
  const luis = { nombre: "Luis", apellido: "García" };
  const marta = { nombre: "Marta", apellido: "Sosa" };

  const turnos: TurnoParaDeuda[] = [
    // Ana: dos impagas de 2.000 y 2.200 → 4.200, 100 min
    { pacienteId: "ana", paciente: ana, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 2000, duracionMin: 50 },
    { pacienteId: "ana", paciente: ana, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 2200, duracionMin: 50 },
    // Ana: una pagada, no cuenta
    { pacienteId: "ana", paciente: ana, estado: "realizado", pagoEstado: "pagado", tarifaCobrada: 2000, duracionMin: 50 },
    // Luis: una impaga de 5.000, sin duración informada
    { pacienteId: "luis", paciente: luis, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 5000 },
    // Marta: solo programadas y una pagada → no aparece
    { pacienteId: "marta", paciente: marta, estado: "programado", pagoEstado: "pendiente", tarifaCobrada: 3000, duracionMin: 50 },
    { pacienteId: "marta", paciente: marta, estado: "realizado", pagoEstado: "pagado", tarifaCobrada: 3000, duracionMin: 50 },
  ];

  it("agrupa por paciente y suma cantidad, monto y minutos", () => {
    const deudores = calcularDeudores(turnos);
    const deAna = deudores.find((d) => d.pacienteId === "ana");
    expect(deAna).toEqual({
      pacienteId: "ana",
      nombre: "Ana",
      apellido: "Pérez",
      sesionesImpagas: 2,
      montoTotal: 4200,
      minutosTotales: 100,
    });
  });

  it("ordena por monto descendente", () => {
    const deudores = calcularDeudores(turnos);
    expect(deudores.map((d) => d.pacienteId)).toEqual(["luis", "ana"]);
  });

  it("un paciente sin deuda no aparece", () => {
    const deudores = calcularDeudores(turnos);
    expect(deudores.some((d) => d.pacienteId === "marta")).toBe(false);
  });

  it("sin duración informada los minutos son 0", () => {
    const deLuis = calcularDeudores(turnos).find((d) => d.pacienteId === "luis");
    expect(deLuis?.minutosTotales).toBe(0);
  });

  it("con lista vacía devuelve lista vacía", () => {
    expect(calcularDeudores([])).toEqual([]);
  });

  it("no muta la lista de entrada", () => {
    const copia = turnos.map((t) => ({ ...t }));
    calcularDeudores(turnos);
    expect(turnos).toEqual(copia);
  });
});
