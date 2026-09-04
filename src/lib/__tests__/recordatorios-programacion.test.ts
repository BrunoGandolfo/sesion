/**
 * calcularProgramadoEn — cuándo sale el recordatorio de un turno.
 *
 * Todo se expresa en instantes UTC explícitos, no en `new Date(y, m, d)`:
 * la función razona en hora de Montevideo (UTC-3 fijo) y estos tests tienen
 * que dar lo mismo corran donde corran, no solo en una máquina uruguaya.
 *
 * Referencias: 20:00 de Montevideo = 23:00Z del mismo día;
 *              08:00 de Montevideo = 11:00Z del mismo día.
 */
import { describe, expect, it } from "vitest";

import {
  calcularProgramadoEn,
  esRecordatorioModo,
  normalizarRecordatorioModo,
  RECORDATORIO_MODO_DEFAULT,
} from "@/lib/recordatorios-programacion";

/** Reloj de pared de Montevideo → instante. */
function mvd(
  anio: number,
  mes: number,
  dia: number,
  hora: number,
  minutos = 0,
): Date {
  return new Date(Date.UTC(anio, mes - 1, dia, hora + 3, minutos, 0, 0));
}

function iso(fecha: Date): string {
  return fecha.toISOString();
}

describe("calcularProgramadoEn — los tres modos", () => {
  // Miércoles 15 de abril de 2026, 10:00 en Montevideo.
  const turno = mvd(2026, 4, 15, 10);

  it("dia_anterior: la tarde de antes, 20:00", () => {
    expect(iso(calcularProgramadoEn(turno, "dia_anterior"))).toBe(
      iso(mvd(2026, 4, 14, 20)),
    );
  });

  it("dos_dias_antes: la tarde de dos días antes, 20:00", () => {
    expect(iso(calcularProgramadoEn(turno, "dos_dias_antes"))).toBe(
      iso(mvd(2026, 4, 13, 20)),
    );
  });

  it("misma_manana: 08:00 del día del turno", () => {
    expect(iso(calcularProgramadoEn(turno, "misma_manana"))).toBe(
      iso(mvd(2026, 4, 15, 8)),
    );
  });

  it("sin modo explícito usa el default (dia_anterior)", () => {
    expect(iso(calcularProgramadoEn(turno))).toBe(
      iso(calcularProgramadoEn(turno, RECORDATORIO_MODO_DEFAULT)),
    );
    expect(iso(calcularProgramadoEn(turno))).toBe(iso(mvd(2026, 4, 14, 20)));
  });

  it("no depende de la hora del turno salvo en misma_manana", () => {
    const temprano = mvd(2026, 4, 15, 9);
    const tarde = mvd(2026, 4, 15, 19, 30);

    expect(iso(calcularProgramadoEn(temprano, "dia_anterior"))).toBe(
      iso(calcularProgramadoEn(tarde, "dia_anterior")),
    );
  });
});

describe("calcularProgramadoEn — turno de madrugada", () => {
  it("misma_manana con turno a las 7:30 avisa la tarde anterior", () => {
    const turno = mvd(2026, 4, 15, 7, 30);

    expect(iso(calcularProgramadoEn(turno, "misma_manana"))).toBe(
      iso(mvd(2026, 4, 14, 20)),
    );
  });

  it("misma_manana con turno a las 00:30 avisa la tarde anterior", () => {
    const turno = mvd(2026, 4, 15, 0, 30);

    expect(iso(calcularProgramadoEn(turno, "misma_manana"))).toBe(
      iso(mvd(2026, 4, 14, 20)),
    );
  });

  it("a las 8:00 en punto todavía es la mañana del propio día", () => {
    const turno = mvd(2026, 4, 15, 8);

    expect(iso(calcularProgramadoEn(turno, "misma_manana"))).toBe(
      iso(mvd(2026, 4, 15, 8)),
    );
  });
});

describe("calcularProgramadoEn — cambio de día, de mes y de año", () => {
  it("dia_anterior desde el 1 de marzo cae en el 28 de febrero", () => {
    const turno = mvd(2026, 3, 1, 9);

    expect(iso(calcularProgramadoEn(turno, "dia_anterior"))).toBe(
      iso(mvd(2026, 2, 28, 20)),
    );
  });

  it("dos_dias_antes desde el 1 de marzo cae en el 27 de febrero", () => {
    const turno = mvd(2026, 3, 1, 9);

    expect(iso(calcularProgramadoEn(turno, "dos_dias_antes"))).toBe(
      iso(mvd(2026, 2, 27, 20)),
    );
  });

  it("respeta el año bisiesto: 1 de marzo de 2028 → 29 de febrero", () => {
    const turno = mvd(2028, 3, 1, 9);

    expect(iso(calcularProgramadoEn(turno, "dia_anterior"))).toBe(
      iso(mvd(2028, 2, 29, 20)),
    );
  });

  it("cruza el año: 1 de enero → 31 de diciembre anterior", () => {
    const turno = mvd(2027, 1, 1, 10);

    expect(iso(calcularProgramadoEn(turno, "dia_anterior"))).toBe(
      iso(mvd(2026, 12, 31, 20)),
    );
  });

  it("madrugada del 1 de marzo con misma_manana cae en el 28 de febrero", () => {
    const turno = mvd(2026, 3, 1, 6, 15);

    expect(iso(calcularProgramadoEn(turno, "misma_manana"))).toBe(
      iso(mvd(2026, 2, 28, 20)),
    );
  });

  it("un turno de las 22:00 no se corre de día por el UTC", () => {
    // Las 22:00 del 15 de abril en Montevideo son las 01:00Z del 16: si la
    // cuenta se hiciera sobre el reloj UTC, "el día anterior" daría el 15 y
    // "la misma mañana" daría el 16. Ambas cosas están mal.
    const turnoNoche = mvd(2026, 4, 15, 22);

    expect(iso(calcularProgramadoEn(turnoNoche, "dia_anterior"))).toBe(
      iso(mvd(2026, 4, 14, 20)),
    );
    expect(iso(calcularProgramadoEn(turnoNoche, "misma_manana"))).toBe(
      iso(mvd(2026, 4, 15, 8)),
    );
  });
});

describe("normalizarRecordatorioModo", () => {
  it("reconoce los tres modos", () => {
    expect(esRecordatorioModo("dia_anterior")).toBe(true);
    expect(esRecordatorioModo("dos_dias_antes")).toBe(true);
    expect(esRecordatorioModo("misma_manana")).toBe(true);
  });

  it("cualquier otra cosa cae en el default", () => {
    expect(esRecordatorioModo("24hs")).toBe(false);
    expect(normalizarRecordatorioModo("24hs")).toBe(RECORDATORIO_MODO_DEFAULT);
    expect(normalizarRecordatorioModo(null)).toBe(RECORDATORIO_MODO_DEFAULT);
    expect(normalizarRecordatorioModo(undefined)).toBe(
      RECORDATORIO_MODO_DEFAULT,
    );
  });
});
