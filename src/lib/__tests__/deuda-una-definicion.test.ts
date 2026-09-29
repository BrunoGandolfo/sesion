/**
 * Una sola definición de deuda. La cabecera de la ficha (toPacienteConDeuda →
 * deudaTotal), el aviso de Turnos y pagos (deudaDeTurnos), Cobros y el SMS de
 * cobro (calcularDeudores, que es la cuenta de deudaDePaciente) tienen que
 * dar lo mismo sobre los mismos turnos.
 */
import { describe, expect, it } from "vitest";

import { calcularDeudores, deudaDeTurnos } from "@/app/api/_lib/domain";

const PACIENTE = { nombre: "Ana", apellido: "López" };
const AHORA = new Date("2026-09-29T15:00:00Z");

function turno(estado: string, pagoEstado: string, tarifaCobrada: number, fecha: string) {
  return { pacienteId: "p1", estado, pagoEstado, tarifaCobrada, fecha: new Date(fecha), paciente: PACIENTE };
}

describe("deudaDeTurnos y calcularDeudores", () => {
  const casos: [string, ReturnType<typeof turno>[]][] = [
    ["sin turnos", []],
    ["realizados sin cobrar y cobrados", [
      turno("realizado", "pendiente", 2000, "2026-09-01T13:00:00Z"),
      turno("realizado", "pagado", 2000, "2026-09-08T13:00:00Z"),
      turno("realizado", "pendiente", 2500, "2026-09-15T13:00:00Z"),
    ]],
    ["un agendado que ya pasó no es deuda", [
      turno("programado", "pendiente", 2000, "2026-09-29T13:00:00Z"),
      turno("realizado", "pendiente", 1500, "2026-09-22T13:00:00Z"),
    ]],
    ["cancelados y ausentes no son deuda", [
      turno("cancelado", "pendiente", 2000, "2026-09-10T13:00:00Z"),
      turno("ausente", "pendiente", 2000, "2026-09-11T13:00:00Z"),
    ]],
  ];

  it.each(casos)("%s: dan lo mismo", (_nombre, turnos) => {
    const [deudor] = calcularDeudores(turnos, AHORA);
    const deuda = deudaDeTurnos(turnos);
    expect(deuda.sesionesImpagas).toBe(deudor?.sesionesImpagas ?? 0);
    expect(deuda.deudaTotal).toBe(deudor?.montoTotal ?? 0);
  });
});
