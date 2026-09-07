/**
 * Los dos lugares donde la agenda todavía dejaba entrar la zona del
 * dispositivo después de pasar las fechas a Montevideo.
 *
 * POR QUÉ ESTE TEST
 *
 * Convertir un solo lado de un par es peor que no convertir ninguno. Cuando
 * el envío del formulario pasó a leer "15:15" como hora de Montevideo, los
 * dos productores de esos strings quedaron en la zona del aparato, y la
 * vuelta dejó de cerrar: desde Madrid, la propuesta "el mismo día y hora que
 * la última vez" mostraba las 20:15 de un turno de las 15:15 y lo agendaba a
 * las 20:15 de Montevideo. Lo mismo con el día que se toca en la grilla del
 * mes: MonthView arma las celdas con date-fns (medianoches locales) y
 * computeRange, que ya razonaba en Montevideo, pedía el día anterior.
 *
 * `conZona` mueve process.env.TZ dentro del proceso: Node la relee en cada
 * operación de Date, así que alcanza para poner el aparato en Madrid.
 */
import { describe, expect, it } from "vitest";

import { anclaDelDiaTocado } from "@/app/(dashboard)/agenda/_components/agenda-view";
import { proponerDesdeUltimoTurno } from "@/app/(dashboard)/agenda/_components/nuevo-turno-form";
import {
  fechaInputMvd,
  horaInputMvd,
  inicioFinDiaMvd,
  instanteDesdeFechaHoraMvd,
} from "@/lib/fechas-montevideo";

/** Corre `f` con la zona del proceso puesta en `tz` y la restaura después. */
function conZona<T>(tz: string, f: () => T): T {
  const anterior = process.env.TZ;
  process.env.TZ = tz;
  try {
    return f();
  } finally {
    if (anterior === undefined) delete process.env.TZ;
    else process.env.TZ = anterior;
  }
}

const MADRID = "Europe/Madrid";

describe("la propuesta del formulario, desde un aparato en Madrid", () => {
  it("ida y vuelta: lo que se propone es el instante que se agenda", () => {
    // Turno de las 15:15 de Montevideo del sábado 5 de septiembre.
    const ultimo = new Date("2026-09-05T18:15:00.000Z");

    const agendado = conZona(MADRID, () => {
      // Lo que hace el formulario: propone, llena los inputs…
      const sugerida = proponerDesdeUltimoTurno(ultimo, new Date("2026-09-06T12:00:00.000Z"));
      const fecha = fechaInputMvd(sugerida);
      const hora = horaInputMvd(sugerida);
      // …y lo que hace el submit con esos mismos strings.
      return { fecha, hora, instante: instanteDesdeFechaHoraMvd(fecha, hora) };
    });

    // Una semana después, misma hora de Montevideo: sábado 12, 15:15.
    expect(agendado.fecha).toBe("2026-09-12");
    expect(agendado.hora).toBe("15:15");
    expect(agendado.instante.toISOString()).toBe("2026-09-12T18:15:00.000Z");
  });

  it("con la forma vieja el turno se iba cinco horas: eso es lo que se arregló", () => {
    const sugerida = new Date("2026-09-12T18:15:00.000Z");

    const conGetHours = conZona(MADRID, () => {
      const h = String(sugerida.getHours()).padStart(2, "0");
      const m = String(sugerida.getMinutes()).padStart(2, "0");
      return `${h}:${m}`;
    });

    // En Madrid las 15:15 de Montevideo son las 20:15: leído después como
    // hora de Montevideo, el turno quedaba cinco horas tarde.
    expect(conGetHours).toBe("20:15");
    expect(conZona(MADRID, () => horaInputMvd(sugerida))).toBe("15:15");
  });

  it("una sesión de las 21:30 no se propone para el día siguiente", () => {
    // 21:30 del viernes 4 = 00:30Z del sábado 5.
    const ultimo = new Date("2026-09-05T00:30:00.000Z");
    const sugerida = proponerDesdeUltimoTurno(ultimo, new Date("2026-09-06T12:00:00.000Z"));

    for (const tz of ["UTC", MADRID, "America/Montevideo"]) {
      expect(conZona(tz, () => fechaInputMvd(sugerida))).toBe("2026-09-11");
      expect(conZona(tz, () => horaInputMvd(sugerida))).toBe("21:30");
    }
  });
});

describe("anclaDelDiaTocado — el día que ella tocó en la grilla del mes", () => {
  it("desde Madrid, tocar el 5 pide el 5 y no el 4", () => {
    // Lo que entrega MonthView: medianoche local del aparato.
    const celda = conZona(MADRID, () => new Date(2026, 8, 5));
    expect(celda.toISOString()).toBe("2026-09-04T22:00:00.000Z");

    const ancla = conZona(MADRID, () => anclaDelDiaTocado(celda));
    const { desde, hasta } = inicioFinDiaMvd(ancla);

    expect(desde.toISOString()).toBe("2026-09-05T03:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-09-06T02:59:59.999Z");
  });

  it("sin el re-anclaje, ese mismo toque pedía el día anterior", () => {
    const celda = conZona(MADRID, () => new Date(2026, 8, 5));
    expect(inicioFinDiaMvd(celda).desde.toISOString()).toBe(
      "2026-09-04T03:00:00.000Z",
    );
  });

  it("en Montevideo no cambia nada: el día tocado sigue siendo el mismo", () => {
    const celda = conZona("America/Montevideo", () => new Date(2026, 8, 5));
    const ancla = conZona("America/Montevideo", () => anclaDelDiaTocado(celda));
    expect(inicioFinDiaMvd(ancla).desde.toISOString()).toBe(
      inicioFinDiaMvd(celda).desde.toISOString(),
    );
  });

  it("el ancla cae al mediodía: lejos de los dos bordes del día", () => {
    const celda = conZona(MADRID, () => new Date(2026, 8, 5));
    expect(conZona(MADRID, () => anclaDelDiaTocado(celda)).toISOString()).toBe(
      "2026-09-05T15:00:00.000Z",
    );
  });
});
