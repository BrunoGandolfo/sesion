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

  it("sin fecha en los turnos no agrega diasAtraso", () => {
    const deudores = calcularDeudores(turnos);
    expect(deudores.every((d) => !("diasAtraso" in d))).toBe(true);
  });
});

describe("calcularDeudores — diasAtraso", () => {
  const ana = { nombre: "Ana", apellido: "Pérez" };
  const luis = { nombre: "Luis", apellido: "García" };
  // Mediodía para que el redondeo a inicio de día no dependa del reloj.
  const hoy = new Date(2026, 8, 3, 12, 0, 0);
  const diasAntes = (n: number) =>
    new Date(2026, 8, 3 - n, 15, 30, 0);

  const turnos: TurnoParaDeuda[] = [
    // Ana: impagas hace 10 y hace 3 días → cuenta la más antigua (10)
    { pacienteId: "ana", paciente: ana, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 2000, fecha: diasAntes(3) },
    { pacienteId: "ana", paciente: ana, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 2000, fecha: diasAntes(10) },
    // Ana: una pagada más vieja aún, no cuenta para el atraso
    { pacienteId: "ana", paciente: ana, estado: "realizado", pagoEstado: "pagado", tarifaCobrada: 2000, fecha: diasAntes(40) },
    // Luis: impaga de hoy → 0 días
    { pacienteId: "luis", paciente: luis, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 5000, fecha: diasAntes(0) },
  ];

  it("toma el impago más antiguo del paciente", () => {
    const deAna = calcularDeudores(turnos, hoy).find((d) => d.pacienteId === "ana");
    expect(deAna?.diasAtraso).toBe(10);
  });

  it("un impago de hoy tiene 0 días de atraso", () => {
    const deLuis = calcularDeudores(turnos, hoy).find((d) => d.pacienteId === "luis");
    expect(deLuis?.diasAtraso).toBe(0);
  });

  it("ignora la fecha de los turnos pagados", () => {
    const deAna = calcularDeudores(turnos, hoy).find((d) => d.pacienteId === "ana");
    expect(deAna?.diasAtraso).not.toBe(40);
  });

  it("cuenta días enteros sobre el inicio del día, no fracciones", () => {
    const ayerTarde = new Date(2026, 8, 2, 23, 0, 0);
    const hoyTemprano = new Date(2026, 8, 3, 1, 0, 0);
    const [deudor] = calcularDeudores(
      [{ pacienteId: "x", paciente: ana, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 1, fecha: ayerTarde }],
      hoyTemprano,
    );
    expect(deudor.diasAtraso).toBe(1);
  });

  it("una fecha futura da 0, nunca negativo", () => {
    const [deudor] = calcularDeudores(
      [{ pacienteId: "x", paciente: ana, estado: "realizado", pagoEstado: "pendiente", tarifaCobrada: 1, fecha: diasAntes(-5) }],
      hoy,
    );
    expect(deudor.diasAtraso).toBe(0);
  });
});
