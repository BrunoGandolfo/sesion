import { describe, it, expect } from "vitest";

import {
  money,
  moneyShort,
  fechaLarga,
  fechaCorta,
  hora,
  fechaRelativa,
  diaSemana,
  saludo,
  initials,
  avatarColor,
} from "@/lib/format";

describe("money", () => {
  it("formatea miles con separador es-UY", () => {
    expect(money(1500)).toBe("$ 1.500");
  });

  it("maneja el cero", () => {
    expect(money(0)).toBe("$ 0");
  });

  it("formatea valores grandes con separadores cada tres dígitos", () => {
    expect(money(1234567)).toBe("$ 1.234.567");
  });

  it("formatea valores chicos sin separador", () => {
    expect(money(50)).toBe("$ 50");
  });
});

describe("moneyShort", () => {
  it("usa 'k' redondo cuando el valor es múltiplo de 1000", () => {
    expect(moneyShort(2000)).toBe("$ 2k");
  });

  it("usa un decimal cuando el valor no es múltiplo de 1000", () => {
    expect(moneyShort(1500)).toBe("$ 1.5k");
  });

  it("muestra el valor literal cuando es menor a 1000", () => {
    expect(moneyShort(500)).toBe("$ 500");
  });

  it("muestra cero como '$ 0'", () => {
    expect(moneyShort(0)).toBe("$ 0");
  });
});

// Los instantes van en UTC explícito, nunca con new Date(2026, 3, 20, 9):
// ese constructor usa la zona del proceso, y estas funciones ahora formatean
// SIEMPRE en hora de Montevideo (UTC-3). Con el constructor local, el mismo
// test decía "09:00" en la máquina de desarrollo y "06:00" en CI.
//
// 09:00 de Montevideo = 12:00Z del mismo día.
function mvd(anio: number, mes: number, dia: number, hora = 0, minuto = 0) {
  return new Date(Date.UTC(anio, mes - 1, dia, hora + 3, minuto, 0, 0));
}

describe("fechas", () => {
  // 20 de abril 2026 a las 09:00 de Montevideo — lunes
  const dia = mvd(2026, 4, 20, 9);

  it("fechaLarga incluye día de la semana, número y mes en español", () => {
    expect(fechaLarga(dia)).toBe("lunes 20 de abril");
  });

  it("fechaCorta usa día y mes abreviado en español", () => {
    expect(fechaCorta(dia)).toBe("20 abr");
  });

  it("hora devuelve formato HH:mm de 24h", () => {
    expect(hora(dia)).toBe("09:00");
  });

  it("diaSemana devuelve el nombre del día en español", () => {
    expect(diaSemana(dia)).toBe("lunes");
  });

  it("un turno de las 15:15 se lee 15:15 aunque el proceso corra en UTC", () => {
    expect(hora(new Date("2026-09-05T18:15:00.000Z"))).toBe("15:15");
  });

  it("una sesión de las 21:30 sigue siendo del día que empezó", () => {
    // 21:30 del viernes 4 = 00:30Z del sábado 5.
    const sesion = new Date("2026-09-05T00:30:00.000Z");
    expect(fechaLarga(sesion)).toBe("viernes 4 de septiembre");
    expect(hora(sesion)).toBe("21:30");
  });
});

describe("fechaRelativa", () => {
  // Fijamos la referencia para que el test sea determinístico
  const ref = mvd(2026, 4, 20, 12);

  it("dice 'Hoy' cuando cae el mismo día que la referencia", () => {
    expect(fechaRelativa(mvd(2026, 4, 20, 23, 30), ref)).toBe("Hoy");
  });

  it("dice 'Ayer' para el día anterior de calendario", () => {
    expect(fechaRelativa(mvd(2026, 4, 19, 23, 30), ref)).toBe("Ayer");
  });

  it("sin referencia usa el reloj real", () => {
    expect(fechaRelativa(new Date())).toBe("Hoy");
    expect(fechaRelativa(new Date(Date.now() - 86_400_000))).toBe("Ayer");
  });

  it("dice 'Hace N días' para 2..6 días atrás", () => {
    expect(fechaRelativa(mvd(2026, 4, 17, 12), ref)).toBe("Hace 3 días");
  });

  it("singulariza 'Hace 1 día' si la referencia no es el reloj real", () => {
    // Con `desde` en el futuro respecto de hoy, el día anterior a la
    // referencia es "Ayer"; dos días antes ya son "Hace 2 días".
    expect(fechaRelativa(mvd(2026, 4, 18, 12), ref)).toBe("Hace 2 días");
  });

  it("dice 'Hace N semanas' para semanas pasadas", () => {
    expect(fechaRelativa(mvd(2026, 4, 6, 12), ref)).toBe("Hace 2 semanas");
  });

  // Los plurales, uno por unidad. Antes decía "Hace 2 sem" y "Hace 3 mes":
  // la abreviatura no ahorraba nada y el singular fijo hacía que tres meses
  // se leyeran como tres veces el mismo mes.
  it("singulariza 'Hace 1 semana'", () => {
    expect(fechaRelativa(mvd(2026, 4, 13, 12), ref)).toBe("Hace 1 semana");
  });

  it("dice 'Hace 3 semanas', con la palabra entera y en plural", () => {
    expect(fechaRelativa(mvd(2026, 3, 30, 12), ref)).toBe("Hace 3 semanas");
  });

  it("singulariza 'Hace 1 mes'", () => {
    expect(fechaRelativa(mvd(2026, 3, 20, 12), ref)).toBe("Hace 1 mes");
  });

  it("dice 'Hace 2 meses' en plural", () => {
    expect(fechaRelativa(mvd(2026, 2, 20, 12), ref)).toBe("Hace 2 meses");
  });

  it("dice 'Hace 11 meses' antes de pasar a años", () => {
    expect(fechaRelativa(mvd(2025, 5, 20, 12), ref)).toBe("Hace 11 meses");
  });

  it("singulariza 'Hace 1 año'", () => {
    expect(fechaRelativa(mvd(2025, 4, 20, 12), ref)).toBe("Hace 1 año");
  });

  it("dice 'Hace 2 años' en plural", () => {
    expect(fechaRelativa(mvd(2024, 4, 20, 12), ref)).toBe("Hace 2 años");
  });

  it("cuenta semanas cuando pasaron 28 días pero no un mes de calendario", () => {
    // Del 23/3 al 20/4 hay 28 días y cero meses enteros. Sin este caso, la
    // columna caía a la fecha corta y mezclaba "Hace 3 semanas" con "23 mar".
    expect(fechaRelativa(mvd(2026, 3, 23, 12), ref)).toBe("Hace 4 semanas");
  });

  it("dice 'En N días' para fechas próximas a futuro", () => {
    expect(fechaRelativa(mvd(2026, 4, 23, 12), ref)).toBe("En 3 días");
  });

  it("singulariza 'En 1 día' para mañana", () => {
    expect(fechaRelativa(mvd(2026, 4, 21, 12), ref)).toBe("En 1 día");
  });

  it("un futuro lejano se muestra como fecha corta, no como 'En N días'", () => {
    expect(fechaRelativa(mvd(2026, 5, 30, 12), ref)).toBe("30 may");
  });

  it("no quedan abreviaturas en ninguna escala", () => {
    // La regresión de fondo era escribir la unidad abreviada y fija:
    // "Hace 2 sem", "Hace 3 mes". Ninguna salida vuelve a abreviar.
    const casos = [
      mvd(2026, 4, 17, 12),
      mvd(2026, 4, 13, 12),
      mvd(2026, 4, 6, 12),
      mvd(2026, 3, 20, 12),
      mvd(2026, 2, 20, 12),
      mvd(2025, 4, 20, 12),
    ];
    for (const fecha of casos) {
      const texto = fechaRelativa(fecha, ref);
      expect(texto, texto).not.toMatch(/\bsem\b/);
      expect(texto, texto).toMatch(/^Hace \d+ (día|días|semana|semanas|mes|meses|año|años)$/);
    }
  });
});

describe("saludo", () => {
  it("antes del mediodía devuelve 'Buen día'", () => {
    expect(saludo(mvd(2026, 4, 20, 8))).toBe("Buen día");
  });

  it("entre las 12 y las 19 devuelve 'Buenas tardes'", () => {
    expect(saludo(mvd(2026, 4, 20, 15))).toBe("Buenas tardes");
  });

  it("desde las 19 devuelve 'Buenas noches'", () => {
    expect(saludo(mvd(2026, 4, 20, 21))).toBe("Buenas noches");
  });

  it("a las 22:00 de Montevideo saluda de noche, no de mañana", () => {
    // 22:00 local = 01:00Z del día siguiente: con la hora del proceso el
    // saludo salía "Buen día" en plena noche.
    expect(saludo(new Date("2026-04-21T01:00:00.000Z"))).toBe("Buenas noches");
  });
});

describe("initials", () => {
  it("usa la primera letra del nombre y del apellido", () => {
    expect(initials("Ana", "Pérez")).toBe("AP");
  });

  it("si solo hay nombre y es una palabra, usa las dos primeras letras", () => {
    expect(initials("Ana")).toBe("AN");
  });

  it("si solo hay nombre con varias palabras, usa primera y última", () => {
    expect(initials("Ana María Pérez")).toBe("AP");
  });
});

describe("avatarColor", () => {
  it("devuelve el mismo color para el mismo nombre (determinístico)", () => {
    expect(avatarColor("Ana Pérez")).toEqual(avatarColor("Ana Pérez"));
  });

  it("devuelve un objeto con bg y fg en formato hex", () => {
    const c = avatarColor("Ana");
    expect(c.bg).toMatch(/^#[0-9A-F]{6}$/i);
    expect(c.fg).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
