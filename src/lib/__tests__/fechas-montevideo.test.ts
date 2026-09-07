/**
 * fechas-montevideo — el tiempo local del consultorio.
 *
 * Todos los instantes se escriben en UTC explícito (`Date.UTC` o un ISO con
 * Z), nunca con `new Date(2026, 8, 5)`: ese constructor usa la zona del
 * proceso y haría que el test dijera cosas distintas en la máquina de
 * desarrollo (Montevideo) y en CI o en Vercel (UTC). Precisamente lo que
 * este módulo viene a arreglar.
 *
 * Referencias: 00:00 de Montevideo = 03:00Z del mismo día.
 *              21:00 de Montevideo = 00:00Z del día siguiente.
 */
import { describe, expect, it } from "vitest";

import {
  agregarDiasMvd,
  fechaInputMvd,
  horaInputMvd,
  inicioFinDiaMvd,
  instanteDesdeFechaHoraMvd,
  diasEnterosMvd,
  esMismoDiaMvd,
  finDeMesMvd,
  finDelDiaMvd,
  formatearDiaSemanaMvd,
  formatearFechaCortaMvd,
  formatearFechaLargaMvd,
  formatearHoraMvd,
  horaLocalMvd,
  inicioDeMesMvd,
  inicioDeSemanaMvd,
  inicioDelDiaMvd,
  instanteMvd,
  mesesEnterosMvd,
  OFFSET_MONTEVIDEO_MIN,
  partesMvd,
} from "@/lib/fechas-montevideo";

/** Reloj de pared de Montevideo → instante, escrito a mano para no usar la
 *  misma función que estamos probando. */
function mvd(
  anio: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
): Date {
  return new Date(Date.UTC(anio, mes - 1, dia, hora + 3, minuto, 0, 0));
}

function iso(fecha: Date): string {
  return fecha.toISOString();
}

describe("el offset", () => {
  it("es UTC-3 fijo", () => {
    expect(OFFSET_MONTEVIDEO_MIN).toBe(-180);
  });

  it("instanteMvd y el helper del test coinciden", () => {
    expect(iso(instanteMvd(2026, 8, 5, 15, 15))).toBe(iso(mvd(2026, 9, 5, 15, 15)));
  });
});

describe("partesMvd — leer el reloj de pared", () => {
  it("las 23:30 de un lunes siguen siendo ese lunes", () => {
    // Lunes 7 de septiembre de 2026, 23:30 local = martes 02:30Z.
    const instante = new Date("2026-09-08T02:30:00.000Z");
    const partes = partesMvd(instante);

    expect(partes).toEqual({
      anio: 2026,
      mes: 8,
      dia: 7,
      hora: 23,
      minuto: 30,
      diaSemana: 0, // 0 = lunes
    });
  });

  it("las 00:30 locales ya son el día siguiente", () => {
    // Martes 8 de septiembre, 00:30 local = 03:30Z del martes.
    const partes = partesMvd(new Date("2026-09-08T03:30:00.000Z"));

    expect(partes.dia).toBe(8);
    expect(partes.hora).toBe(0);
    expect(partes.diaSemana).toBe(1); // martes
  });

  it("el domingo es el último día de la semana", () => {
    expect(partesMvd(mvd(2026, 9, 6, 12)).diaSemana).toBe(6);
  });
});

describe("inicioDelDiaMvd / finDelDiaMvd", () => {
  it("una sesión de las 21:30 pertenece a su propio día, no al siguiente", () => {
    // 21:30 local = 00:30Z del día siguiente: es el caso que rompía la
    // agenda del día cuando la cuenta se hacía en la zona del proceso.
    const sesion = new Date("2026-09-05T00:30:00.000Z"); // viernes 4, 21:30

    expect(iso(inicioDelDiaMvd(sesion))).toBe(iso(mvd(2026, 9, 4, 0, 0)));
    expect(iso(finDelDiaMvd(sesion))).toBe(
      new Date(mvd(2026, 9, 5, 0, 0).getTime() - 1).toISOString(),
    );
  });

  it("el inicio del día es 03:00Z", () => {
    expect(iso(inicioDelDiaMvd(mvd(2026, 9, 5, 15, 15)))).toBe(
      "2026-09-05T03:00:00.000Z",
    );
  });

  it("el fin del día es 02:59:59.999Z del día siguiente", () => {
    expect(iso(finDelDiaMvd(mvd(2026, 9, 5, 15, 15)))).toBe(
      "2026-09-06T02:59:59.999Z",
    );
  });

  it("00:00 local es el inicio de su propio día", () => {
    const medianoche = mvd(2026, 9, 5, 0, 0);
    expect(iso(inicioDelDiaMvd(medianoche))).toBe(iso(medianoche));
  });
});

describe("inicioDeSemanaMvd — la semana empieza el lunes", () => {
  it("un miércoles vuelve al lunes de esa semana", () => {
    // Miércoles 9 de septiembre de 2026.
    expect(iso(inicioDeSemanaMvd(mvd(2026, 9, 9, 15)))).toBe(
      iso(mvd(2026, 9, 7, 0)),
    );
  });

  it("el domingo pertenece a la semana que empezó el lunes anterior", () => {
    expect(iso(inicioDeSemanaMvd(mvd(2026, 9, 13, 22)))).toBe(
      iso(mvd(2026, 9, 7, 0)),
    );
  });

  it("el propio lunes a las 00:00 se devuelve igual", () => {
    const lunes = mvd(2026, 9, 7, 0);
    expect(iso(inicioDeSemanaMvd(lunes))).toBe(iso(lunes));
  });

  it("una semana que arranca en el mes anterior", () => {
    // Jueves 1 de octubre de 2026 → lunes 28 de septiembre.
    expect(iso(inicioDeSemanaMvd(mvd(2026, 10, 1, 9)))).toBe(
      iso(mvd(2026, 9, 28, 0)),
    );
  });
});

describe("inicioDeMesMvd / finDeMesMvd", () => {
  it("las 21:05 del 31 siguen siendo de ese mes", () => {
    // 31 de agosto 21:05 local = 1 de septiembre 00:05Z.
    const fin = new Date("2026-09-01T00:05:00.000Z");

    expect(iso(inicioDeMesMvd(fin))).toBe(iso(mvd(2026, 8, 1, 0)));
    expect(iso(finDeMesMvd(fin))).toBe(
      new Date(mvd(2026, 9, 1, 0).getTime() - 1).toISOString(),
    );
  });

  it("febrero de un año bisiesto termina el 29", () => {
    const feb = mvd(2028, 2, 15, 12);

    expect(iso(inicioDeMesMvd(feb))).toBe(iso(mvd(2028, 2, 1, 0)));
    expect(partesMvd(finDeMesMvd(feb)).dia).toBe(29);
  });

  it("febrero de un año no bisiesto termina el 28", () => {
    expect(partesMvd(finDeMesMvd(mvd(2026, 2, 15, 12))).dia).toBe(28);
  });

  it("diciembre termina el 31 y no se pasa de año", () => {
    const fin = finDeMesMvd(mvd(2026, 12, 3, 8));
    expect(partesMvd(fin)).toMatchObject({ anio: 2026, mes: 11, dia: 31 });
  });
});

describe("agregarDiasMvd", () => {
  it("suma y resta días de calendario", () => {
    expect(iso(agregarDiasMvd(mvd(2026, 9, 5, 15), 1))).toBe(
      iso(mvd(2026, 9, 6, 15)),
    );
    expect(iso(agregarDiasMvd(mvd(2026, 3, 1, 9), -1))).toBe(
      iso(mvd(2026, 2, 28, 9)),
    );
  });

  it("cruza el año bisiesto", () => {
    expect(iso(agregarDiasMvd(mvd(2028, 2, 28, 10), 1))).toBe(
      iso(mvd(2028, 2, 29, 10)),
    );
  });
});

describe("esMismoDiaMvd", () => {
  it("las 23:30 y las 00:30 del día siguiente NO son el mismo día", () => {
    const lunesTarde = new Date("2026-09-08T02:30:00.000Z"); // lunes 23:30
    const martesTemprano = new Date("2026-09-08T03:30:00.000Z"); // martes 00:30

    expect(esMismoDiaMvd(lunesTarde, martesTemprano)).toBe(false);
  });

  it("las 00:30 y las 23:30 del mismo día local sí lo son", () => {
    expect(
      esMismoDiaMvd(mvd(2026, 9, 5, 0, 30), mvd(2026, 9, 5, 23, 30)),
    ).toBe(true);
  });

  it("dos instantes con el mismo día UTC pero distinto día local", () => {
    // Ambos caen el 5 de septiembre en UTC; en Montevideo, uno es el 4.
    const a = new Date("2026-09-05T01:00:00.000Z"); // 4 de septiembre, 22:00
    const b = new Date("2026-09-05T15:00:00.000Z"); // 5 de septiembre, 12:00

    expect(esMismoDiaMvd(a, b)).toBe(false);
  });
});

describe("diasEnterosMvd", () => {
  it("de las 23:00 de un día a la 1:00 del siguiente hay un día", () => {
    expect(diasEnterosMvd(mvd(2026, 9, 4, 23), mvd(2026, 9, 5, 1))).toBe(1);
  });

  it("el mismo día da cero aunque cambie la hora", () => {
    expect(diasEnterosMvd(mvd(2026, 9, 5, 0, 5), mvd(2026, 9, 5, 23, 55))).toBe(0);
  });

  it("hacia atrás da negativo", () => {
    expect(diasEnterosMvd(mvd(2026, 9, 10, 12), mvd(2026, 9, 5, 12))).toBe(-5);
  });

  it("cruza el fin de mes", () => {
    expect(diasEnterosMvd(mvd(2026, 8, 30, 20), mvd(2026, 9, 2, 6))).toBe(3);
  });
});

describe("mesesEnterosMvd", () => {
  it("cuenta el mes recién cuando se pasa el mismo día", () => {
    expect(mesesEnterosMvd(mvd(2026, 1, 31, 12), mvd(2026, 2, 28, 12))).toBe(0);
    expect(mesesEnterosMvd(mvd(2026, 1, 31, 12), mvd(2026, 3, 3, 12))).toBe(1);
  });

  it("cuenta doce meses en un año", () => {
    expect(mesesEnterosMvd(mvd(2025, 9, 5, 12), mvd(2026, 9, 5, 12))).toBe(12);
  });

  it("hacia atrás da negativo", () => {
    expect(mesesEnterosMvd(mvd(2026, 9, 5, 12), mvd(2026, 7, 5, 12))).toBe(-2);
  });
});

describe("horaLocalMvd y formatearHoraMvd", () => {
  it("un turno de las 15:15 se lee 15:15, no 18:15", () => {
    const turno = new Date("2026-09-05T18:15:00.000Z");

    expect(horaLocalMvd(turno)).toEqual({ hora: 15, minuto: 15 });
    expect(formatearHoraMvd(turno)).toBe("15:15");
  });

  it("rellena con cero a la izquierda", () => {
    expect(formatearHoraMvd(mvd(2026, 9, 5, 9, 5))).toBe("09:05");
    expect(formatearHoraMvd(mvd(2026, 9, 5, 0, 0))).toBe("00:00");
  });

  it("las 23:30 locales no se leen como las 02:30", () => {
    expect(formatearHoraMvd(new Date("2026-09-08T02:30:00.000Z"))).toBe("23:30");
  });
});

describe("nombres en castellano", () => {
  it("formatearFechaLargaMvd", () => {
    // Sábado 5 de septiembre de 2026, 15:15 local.
    expect(formatearFechaLargaMvd(new Date("2026-09-05T18:15:00.000Z"))).toBe(
      "sábado 5 de septiembre",
    );
  });

  it("usa el día local, no el UTC", () => {
    // 4 de septiembre 21:30 local = 5 de septiembre 00:30Z.
    expect(formatearFechaLargaMvd(new Date("2026-09-05T00:30:00.000Z"))).toBe(
      "viernes 4 de septiembre",
    );
  });

  it("formatearFechaCortaMvd", () => {
    expect(formatearFechaCortaMvd(mvd(2026, 4, 20, 9))).toBe("20 abr");
  });

  it("formatearDiaSemanaMvd", () => {
    expect(formatearDiaSemanaMvd(mvd(2026, 9, 7, 9))).toBe("lunes");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Los inputs del formulario de turnos
//
// El caso que estas funciones vienen a arreglar es el del DISPOSITIVO EN OTRA
// ZONA: la profesional (o quien la ayude) abriendo la agenda desde un
// teléfono que no está en Montevideo. Antes se armaba con getFullYear/
// getHours y se leía con `new Date("2026-09-05T15:15:00")`, los dos en la
// zona del aparato.
//
// `conZona` corre el mismo caso con TZ distintos en el mismo proceso: Node lee
// process.env.TZ en cada operación de Date, así que alcanza para simular el
// aparato de otro lado sin salir del test.
// ────────────────────────────────────────────────────────────────────────────

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

/** Las zonas donde el mismo string de formulario daba instantes distintos:
 *  UTC (el servidor y CI), Madrid (+2), Los Ángeles (-7) y Montevideo. */
const ZONAS = ["UTC", "Europe/Madrid", "America/Los_Angeles", "America/Montevideo"];

describe("el arnés de zonas", () => {
  // Si esto fallara, los tests de abajo pasarían por la razón equivocada:
  // estarían comparando la misma zona contra sí misma. También deja escrito
  // el bug: el `new Date("…T15:15:00")` que había en los tres formularios
  // daba tres instantes distintos según dónde estuviera el aparato.
  it("cambia de verdad la zona del proceso", () => {
    const viejaForma = (tz: string) =>
      conZona(tz, () => new Date("2026-09-05T15:15:00").toISOString());

    expect(viejaForma("UTC")).toBe("2026-09-05T15:15:00.000Z");
    expect(viejaForma("Europe/Madrid")).toBe("2026-09-05T13:15:00.000Z");
    expect(viejaForma("America/Montevideo")).toBe("2026-09-05T18:15:00.000Z");
  });
});

describe("instanteDesdeFechaHoraMvd — la hora escrita es la del consultorio", () => {
  it("15:15 del 5/9 es 18:15Z, no la hora del dispositivo", () => {
    expect(iso(instanteDesdeFechaHoraMvd("2026-09-05", "15:15"))).toBe(
      "2026-09-05T18:15:00.000Z",
    );
  });

  it("da el mismo instante en toda zona del dispositivo", () => {
    const esperado = "2026-09-05T18:15:00.000Z";
    for (const tz of ZONAS) {
      expect(
        conZona(tz, () => iso(instanteDesdeFechaHoraMvd("2026-09-05", "15:15"))),
      ).toBe(esperado);
    }
  });

  it("una sesión de las 21:30 sigue siendo de ese día", () => {
    // El instante cae en el día siguiente en UTC; el día local es el 4.
    const instante = instanteDesdeFechaHoraMvd("2026-09-04", "21:30");
    expect(iso(instante)).toBe("2026-09-05T00:30:00.000Z");
    expect(fechaInputMvd(instante)).toBe("2026-09-04");
  });

  it("acepta la hora con segundos", () => {
    expect(iso(instanteDesdeFechaHoraMvd("2026-09-05", "15:15:30"))).toBe(
      "2026-09-05T18:15:30.000Z",
    );
  });

  it("devuelve un Date inválido si el texto no tiene la forma esperada", () => {
    expect(Number.isNaN(instanteDesdeFechaHoraMvd("", "15:15").getTime())).toBe(true);
    expect(Number.isNaN(instanteDesdeFechaHoraMvd("2026-09-05", "").getTime())).toBe(
      true,
    );
    expect(
      Number.isNaN(instanteDesdeFechaHoraMvd("5/9/2026", "15:15").getTime()),
    ).toBe(true);
  });

  it("cruza el fin de mes y el bisiesto sin cuentas extra", () => {
    expect(iso(instanteDesdeFechaHoraMvd("2028-02-29", "00:00"))).toBe(
      "2028-02-29T03:00:00.000Z",
    );
  });
});

describe("fechaInputMvd / horaInputMvd — llenar el formulario", () => {
  it("dan el día y la hora de Montevideo", () => {
    const instante = new Date("2026-09-05T18:15:00.000Z");
    expect(fechaInputMvd(instante)).toBe("2026-09-05");
    expect(horaInputMvd(instante)).toBe("15:15");
  });

  it("dan lo mismo en toda zona del dispositivo", () => {
    // 00:30Z del 5 = 21:30 del 4 en Montevideo. En Madrid el aparato diría
    // "2026-09-05" y "02:30"; en Los Ángeles, "2026-09-04" y "17:30".
    const instante = new Date("2026-09-05T00:30:00.000Z");
    for (const tz of ZONAS) {
      expect(conZona(tz, () => fechaInputMvd(instante))).toBe("2026-09-04");
      expect(conZona(tz, () => horaInputMvd(instante))).toBe("21:30");
    }
  });

  it("ida y vuelta: lo que se muestra es lo que se guarda", () => {
    const instante = mvd(2026, 9, 5, 15, 15);
    const ida = instanteDesdeFechaHoraMvd(
      fechaInputMvd(instante),
      horaInputMvd(instante),
    );
    expect(iso(ida)).toBe(iso(instante));
  });

  it("rellena con cero el mes y el día de un dígito", () => {
    expect(fechaInputMvd(mvd(2026, 1, 3, 9))).toBe("2026-01-03");
    expect(horaInputMvd(mvd(2026, 1, 3, 9, 5))).toBe("09:05");
  });
});

describe("inicioFinDiaMvd — el rango de un día de la agenda", () => {
  it("son los dos bordes del día de Montevideo", () => {
    const { desde, hasta } = inicioFinDiaMvd(new Date("2026-09-05T18:15:00.000Z"));
    expect(iso(desde)).toBe("2026-09-05T03:00:00.000Z");
    expect(iso(hasta)).toBe("2026-09-06T02:59:59.999Z");
  });

  it("la sesión de las 21:30 cae dentro de su propio día", () => {
    const sesion = instanteDesdeFechaHoraMvd("2026-09-04", "21:30");
    const { desde, hasta } = inicioFinDiaMvd(sesion);
    expect(sesion.getTime()).toBeGreaterThanOrEqual(desde.getTime());
    expect(sesion.getTime()).toBeLessThanOrEqual(hasta.getTime());
  });

  it("da el mismo rango en toda zona del dispositivo", () => {
    const instante = new Date("2026-09-05T00:30:00.000Z");
    for (const tz of ZONAS) {
      const { desde, hasta } = conZona(tz, () => inicioFinDiaMvd(instante));
      expect(iso(desde)).toBe("2026-09-04T03:00:00.000Z");
      expect(iso(hasta)).toBe("2026-09-05T02:59:59.999Z");
    }
  });
});
