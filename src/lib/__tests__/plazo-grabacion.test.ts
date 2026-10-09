// La regla de cuándo se acepta una grabación por su inicio (iniciadaEn):
// del día del turno en Montevideo y de las últimas 36 horas.
import { describe, expect, it } from "vitest";

import { motivoGrabacionNoAdmitida } from "@/app/api/_lib/domain";
import { GRABACION_OTRO_DIA_QUE_EL_TURNO, GRABACION_VENCIDA } from "@/lib/glosario";
import { HORAS_PARA_ENVIAR_GRABACION } from "@/lib/plazo-grabacion";

const HORA = 60 * 60_000;
const TURNO = new Date("2026-09-24T02:30:00.000Z"); // 23:30 del 23 en Montevideo

describe("motivoGrabacionNoAdmitida", () => {
  it("acepta el mismo día de Montevideo aunque ya sea otro día en UTC o pasada la medianoche", () => {
    expect(motivoGrabacionNoAdmitida(TURNO, TURNO, new Date("2026-09-24T03:10:00.000Z"))).toBeNull();
    // El inicio puede ser antes que la hora del turno, si es del mismo día.
    expect(motivoGrabacionNoAdmitida(TURNO, new Date("2026-09-23T12:00:00.000Z"), new Date("2026-09-23T20:00:00.000Z"))).toBeNull();
  });

  it("el plazo es de 36 horas, inclusive", () => {
    expect(HORAS_PARA_ENVIAR_GRABACION).toBe(36);
    expect(motivoGrabacionNoAdmitida(TURNO, TURNO, new Date(TURNO.getTime() + 36 * HORA))).toBeNull();
    expect(motivoGrabacionNoAdmitida(TURNO, TURNO, new Date(TURNO.getTime() + 36 * HORA + 1))).toBe(GRABACION_VENCIDA);
  });

  it("el inicio tiene que ser del día del turno en Montevideo", () => {
    // 00:30 del 24 en Montevideo: un día después del turno de las 23:30 del 23.
    const otroDia = new Date("2026-09-24T03:30:00.000Z");
    expect(motivoGrabacionNoAdmitida(TURNO, otroDia, new Date("2026-09-24T04:00:00.000Z"))).toBe(GRABACION_OTRO_DIA_QUE_EL_TURNO);
  });

  it("un reloj de teléfono adelantado unos minutos se tolera; una hora, no", () => {
    expect(motivoGrabacionNoAdmitida(TURNO, new Date(TURNO.getTime() + 4 * 60_000), TURNO)).toBeNull();
    expect(motivoGrabacionNoAdmitida(TURNO, new Date(TURNO.getTime() + HORA), new Date(TURNO.getTime() - 1))).toBe(GRABACION_OTRO_DIA_QUE_EL_TURNO);
  });
});
