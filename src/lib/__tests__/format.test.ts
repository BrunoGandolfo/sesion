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

describe("fechas", () => {
  // 20 de abril 2026 a las 09:00 — lunes
  const dia = new Date(2026, 3, 20, 9, 0);

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
});

describe("fechaRelativa", () => {
  // Fijamos la referencia para que el test sea determinístico
  const ref = new Date(2026, 3, 20, 12, 0);

  it("dice 'Hoy' cuando es el mismo día (usa la fecha real del sistema, no el ref)", () => {
    // isToday/isYesterday de date-fns comparan contra hoy real, no contra ref.
    const hoy = new Date();
    expect(fechaRelativa(hoy)).toBe("Hoy");
  });

  it("dice 'Ayer' para el día anterior (relativo a hoy real)", () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    expect(fechaRelativa(ayer)).toBe("Ayer");
  });

  it("dice 'Hace N días' para 2..6 días atrás", () => {
    expect(fechaRelativa(new Date(2026, 3, 17, 12, 0), ref)).toBe("Hace 3 días");
  });

  it("dice 'Hace N sem' para semanas pasadas", () => {
    expect(fechaRelativa(new Date(2026, 3, 6, 12, 0), ref)).toBe("Hace 2 sem");
  });

  it("dice 'En N días' para fechas próximas a futuro", () => {
    expect(fechaRelativa(new Date(2026, 3, 23, 12, 0), ref)).toBe("En 3 días");
  });

  it("singulariza 'En 1 día' para mañana", () => {
    expect(fechaRelativa(new Date(2026, 3, 21, 12, 0), ref)).toBe("En 1 día");
  });
});

describe("saludo", () => {
  it("antes del mediodía devuelve 'Buen día'", () => {
    expect(saludo(new Date(2026, 3, 20, 8, 0))).toBe("Buen día");
  });

  it("entre las 12 y las 19 devuelve 'Buenas tardes'", () => {
    expect(saludo(new Date(2026, 3, 20, 15, 0))).toBe("Buenas tardes");
  });

  it("desde las 19 devuelve 'Buenas noches'", () => {
    expect(saludo(new Date(2026, 3, 20, 21, 0))).toBe("Buenas noches");
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
