// Unitario — la interfaz de métricas y la decisión sobre el latido del worker.

import { describe, expect, it } from "vitest";

import {
  cruzaUmbral,
  estadoDelWorker,
  LATIDO_MAXIMO_SEG,
  LATIDO_NUNCA,
  lineasDeAlerta,
  metricasWorker,
  nivelMaximo,
  type ContextoMetricas,
} from "@/lib/salud-metricas";

const AHORA = new Date("2026-09-11T15:00:00.000Z");

describe("cruzaUmbral", () => {
  it("cruza desde el umbral inclusive", () => {
    expect(cruzaUmbral({ nombre: "x", valor: 1, umbral: 1, texto: "" })).toBe(true);
    expect(cruzaUmbral({ nombre: "x", valor: 0, umbral: 1, texto: "" })).toBe(false);
  });

  it("una informativa (umbral null) nunca cruza", () => {
    expect(cruzaUmbral({ nombre: "x", valor: 9999, umbral: null, texto: "" })).toBe(false);
  });

  it("un valor que no es número no cruza (no se inventa una alerta)", () => {
    expect(cruzaUmbral({ nombre: "x", valor: Number.NaN, umbral: 1, texto: "" })).toBe(false);
  });
});

describe("nivelMaximo y lineasDeAlerta", () => {
  it("con una crítica el correo es crítico", () => {
    expect(
      nivelMaximo([
        { nombre: "a", valor: 1, umbral: 1, texto: "a" },
        { nombre: "b", valor: 1, umbral: 1, texto: "b", nivel: "critico" },
      ]),
    ).toBe("critico");
  });

  it("sin críticas es aviso", () => {
    expect(nivelMaximo([{ nombre: "a", valor: 1, umbral: 1, texto: "a" }])).toBe("aviso");
  });

  it("cada línea es valor + texto", () => {
    expect(lineasDeAlerta([{ nombre: "a", valor: 3, umbral: 1, texto: "sesiones trabadas" }])).toEqual([
      "3 sesiones trabadas",
    ]);
  });
});

describe("estadoDelWorker", () => {
  it("sin fila nunca hubo poll: muerto", () => {
    expect(estadoDelWorker(null, AHORA)).toEqual({
      vivo: false, ultimoPollEn: null, edadSegundos: null, version: null,
    });
  });

  it("un poll reciente es vivo", () => {
    const hace30s = new Date(AHORA.getTime() - 30_000);
    expect(estadoDelWorker({ ultimoPollEn: hace30s, version: "1.2.0" }, AHORA)).toEqual({
      vivo: true, ultimoPollEn: hace30s, edadSegundos: 30, version: "1.2.0",
    });
  });

  it("el borde: exactamente el máximo sigue vivo, un segundo más no", () => {
    const enElBorde = new Date(AHORA.getTime() - LATIDO_MAXIMO_SEG * 1000);
    expect(estadoDelWorker({ ultimoPollEn: enElBorde, version: "v" }, AHORA).vivo).toBe(true);
    const pasado = new Date(AHORA.getTime() - (LATIDO_MAXIMO_SEG + 1) * 1000);
    expect(estadoDelWorker({ ultimoPollEn: pasado, version: "v" }, AHORA).vivo).toBe(false);
  });

  it("un reloj adelantado no da edad negativa", () => {
    const futuro = new Date(AHORA.getTime() + 5_000);
    expect(estadoDelWorker({ ultimoPollEn: futuro, version: "v" }, AHORA).edadSegundos).toBe(0);
  });
});

describe("metricasWorker", () => {
  function contexto(fila: { ultimoPollEn: Date; version: string } | null): ContextoMetricas {
    return {
      prisma: { workerEstado: { findUnique: async () => fila } } as unknown as ContextoMetricas["prisma"],
      ahora: AHORA,
    };
  }

  it("con el worker vivo no cruza", async () => {
    const [m] = await metricasWorker(contexto({ ultimoPollEn: new Date(AHORA.getTime() - 10_000), version: "v" }));
    expect(m.valor).toBe(10);
    expect(cruzaUmbral(m)).toBe(false);
  });

  it("caído: cruza y es crítica", async () => {
    const [m] = await metricasWorker(contexto({ ultimoPollEn: new Date(AHORA.getTime() - 3_600_000), version: "v" }));
    expect(cruzaUmbral(m)).toBe(true);
    expect(m.nivel).toBe("critico");
  });

  it("sin poll nunca: cruza con el valor centinela y lo dice", async () => {
    const [m] = await metricasWorker(contexto(null));
    expect(m.valor).toBe(LATIDO_NUNCA);
    expect(cruzaUmbral(m)).toBe(true);
    expect(m.texto).toContain("NUNCA");
  });
});
