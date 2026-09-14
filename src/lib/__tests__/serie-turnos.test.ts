import { describe, expect, it } from "vitest";

import {
  fechasDeSerie,
  HORIZONTE_MESES,
  TOPE_TURNOS_POR_SERIE,
} from "@/app/api/_lib/casos-uso/serie-turnos";
import { instanteMvd, partesMvd } from "@/lib/fechas-montevideo";

// Martes 15 de septiembre de 2026, 15:30 de Montevideo.
const ANCLA = instanteMvd(2026, 8, 15, 15, 30);

describe("fechasDeSerie", () => {
  it("una serie semanal cubre tres meses: 13 martes, empezando por el elegido", () => {
    const fechas = fechasDeSerie(ANCLA, "semanal");

    expect(HORIZONTE_MESES).toBe(3);
    expect(fechas[0]).toEqual(ANCLA);
    expect(fechas).toHaveLength(13);
    // La última cae antes del 15 de diciembre a las 15:30; el 15/12 mismo
    // queda afuera (el horizonte es abierto en el final).
    expect(fechas[fechas.length - 1].getTime()).toBeLessThan(
      instanteMvd(2026, 11, 15, 15, 30).getTime(),
    );
  });

  it("una serie quincenal tiene la mitad de fechas, cada 14 días", () => {
    const fechas = fechasDeSerie(ANCLA, "quincenal");

    expect(fechas).toHaveLength(7);
    for (let i = 1; i < fechas.length; i++) {
      expect(fechas[i].getTime() - fechas[i - 1].getTime()).toBe(
        14 * 24 * 60 * 60 * 1000,
      );
    }
  });

  it("todas las fechas conservan el día de la semana y la hora de Montevideo", () => {
    for (const fecha of fechasDeSerie(ANCLA, "semanal")) {
      const p = partesMvd(fecha);
      expect(p.diaSemana).toBe(partesMvd(ANCLA).diaSemana);
      expect([p.hora, p.minuto]).toEqual([15, 30]);
    }
  });

  it("el tope de turnos por serie acota cualquier horizonte", () => {
    expect(TOPE_TURNOS_POR_SERIE).toBe(30);
    // Con tres meses no se llega al tope: si alguien agranda el horizonte,
    // la serie se corta ahí igual.
    expect(fechasDeSerie(ANCLA, "semanal").length).toBeLessThanOrEqual(
      TOPE_TURNOS_POR_SERIE,
    );
  });

  it("cruza el fin de año sin perder la hora", () => {
    const ancla = instanteMvd(2026, 11, 20, 9, 0);
    const fechas = fechasDeSerie(ancla, "semanal");
    expect(fechas).toHaveLength(13);
    expect(partesMvd(fechas[2])).toMatchObject({ anio: 2027, mes: 0, dia: 3, hora: 9 });
  });
});
