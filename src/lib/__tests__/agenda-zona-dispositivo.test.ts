/** Ida y vuelta del formulario en la zona del consultorio.
 * La grilla se verifica desde sus botones en calendario-consultorio.test.tsx. */
import { describe, expect, it } from "vitest";

import { proponerDesdeUltimoTurno } from "@/components/forms/nuevo-turno-form";
import {
  fechaInputMvd,
  horaInputMvd,
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

it("conserva la hora del consultorio al cruzar el cambio de hora de Madrid", () => {
  const ultimo = new Date("2026-10-24T18:15:00.000Z");
  const siguiente = conZona(MADRID, () => proponerDesdeUltimoTurno(ultimo, new Date("2026-10-25T12:00:00Z")));
  expect(siguiente.toISOString()).toBe("2026-10-31T18:15:00.000Z");
});
