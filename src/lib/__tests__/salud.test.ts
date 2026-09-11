// Unitario — el agregador de salud y las métricas de SMS.
//
// Sin base: las fuentes se inyectan, y las de SMS reciben un doble del
// cliente Prisma que contesta números fijos. Lo que se prueba es la
// DECISIÓN (qué cruza, qué nivel, qué texto) y que una fuente rota no deje
// ciego al resto.

import { describe, expect, it } from "vitest";

import { revisarSalud } from "@/app/api/_lib/casos-uso/salud";
import type { ContextoMetricas, FuenteMetricas } from "@/lib/salud-metricas";
import {
  metricasSms,
  SMS_TRABADO_MS,
  UMBRAL_SMS_DESCONOCIDOS,
} from "@/lib/sms/metricas";

const AHORA = new Date("2026-09-11T15:00:00.000Z");

const prismaVacio = {} as unknown as ContextoMetricas["prisma"];

function fuente(nombre: string, f: FuenteMetricas) {
  return { nombre, fuente: f };
}

describe("revisarSalud (agregador)", () => {
  it("con todo en orden no avisa nada, pero devuelve las métricas", async () => {
    const salud = await revisarSalud({
      prisma: prismaVacio,
      ahora: AHORA,
      fuentes: [
        fuente("a", async () => [{ nombre: "a_cosas", valor: 0, umbral: 1, texto: "cosas" }]),
        fuente("b", async () => [{ nombre: "b_info", valor: 42, umbral: null, texto: "info" }]),
      ],
    });

    expect(salud.alerta).toBeNull();
    expect(salud.nivel).toBeNull();
    expect(salud.alertas).toEqual([]);
    expect(salud.metricas.map((m) => m.nombre)).toEqual(["a_cosas", "b_info"]);
  });

  it("junta en un solo texto las que cruzaron, con el número adelante", async () => {
    const salud = await revisarSalud({
      prisma: prismaVacio,
      ahora: AHORA,
      fuentes: [
        fuente("a", async () => [
          { nombre: "a1", valor: 3, umbral: 1, texto: "sesiones trabadas" },
          { nombre: "a2", valor: 0, umbral: 1, texto: "no cruza" },
        ]),
        fuente("b", async () => [{ nombre: "b1", valor: 2, umbral: 2, texto: "SMS fallidos" }]),
      ],
    });

    expect(salud.alerta).toBe("Sesión: 3 sesiones trabadas; 2 SMS fallidos");
    expect(salud.alertas.map((m) => m.nombre)).toEqual(["a1", "b1"]);
    expect(salud.nivel).toBe("aviso");
  });

  it("una crítica vuelve crítico el correo entero", async () => {
    const salud = await revisarSalud({
      prisma: prismaVacio,
      ahora: AHORA,
      fuentes: [
        fuente("a", async () => [{ nombre: "a1", valor: 1, umbral: 1, texto: "aviso" }]),
        fuente("w", async () => [{ nombre: "w", valor: 900, umbral: 601, texto: "worker caído", nivel: "critico" }]),
      ],
    });
    expect(salud.nivel).toBe("critico");
  });

  it("una fuente que lanza se vuelve alerta crítica y no tumba a las demás", async () => {
    const salud = await revisarSalud({
      prisma: prismaVacio,
      ahora: AHORA,
      fuentes: [
        fuente("rota", async () => { throw new Error("connection refused"); }),
        fuente("sana", async () => [{ nombre: "s", valor: 1, umbral: 1, texto: "algo" }]),
      ],
    });

    expect(salud.nivel).toBe("critico");
    expect(salud.alertas.map((m) => m.nombre)).toEqual(["fuente_fallida[rota]", "s"]);
    expect(salud.alerta).toContain('fuente de métricas "rota" falló');
    expect(salud.alerta).toContain("connection refused");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Métricas de SMS
// ────────────────────────────────────────────────────────────────────────────

interface EscenarioSms {
  fallidos?: number;
  desconocidos?: number;
  trabados?: number;
  porOrganizacion?: Array<{ organizationId: string; segmentos: number | null }>;
}

function prismaSms(e: EscenarioSms): ContextoMetricas["prisma"] {
  return {
    envioSms: {
      count: async (args: { where: { estado: string; actualizadoEn?: { lt?: Date } } }) => {
        const w = args.where;
        if (w.estado === "fallido") return e.fallidos ?? 0;
        if (w.estado === "desconocido") return e.desconocidos ?? 0;
        if (w.estado === "enviando") {
          // La consulta de trabados tiene que mirar hacia atrás SMS_TRABADO_MS.
          expect(w.actualizadoEn?.lt?.getTime()).toBe(AHORA.getTime() - SMS_TRABADO_MS);
          return e.trabados ?? 0;
        }
        throw new Error(`estado inesperado ${w.estado}`);
      },
      groupBy: async () =>
        (e.porOrganizacion ?? []).map((o) => ({
          organizationId: o.organizationId,
          _sum: { segmentos: o.segmentos },
        })),
    },
  } as unknown as ContextoMetricas["prisma"];
}

async function correrSms(e: EscenarioSms) {
  return revisarSalud({
    prisma: prismaSms(e),
    ahora: AHORA,
    fuentes: [{ nombre: "sms", fuente: metricasSms }],
  });
}

describe("metricasSms", () => {
  it("con todo en cero no avisa", async () => {
    const salud = await correrSms({});
    expect(salud.alerta).toBeNull();
  });

  it("un solo fallido ya avisa y dice dónde mirar", async () => {
    const salud = await correrSms({ fallidos: 1 });
    expect(salud.alerta).toContain("1 SMS fallidos en 24 h");
    expect(salud.alerta).toContain("cada turno");
  });

  it("los desconocidos avisan desde el umbral, no antes", async () => {
    expect((await correrSms({ desconocidos: UMBRAL_SMS_DESCONOCIDOS - 1 })).alerta).toBeNull();
    const salud = await correrSms({ desconocidos: UMBRAL_SMS_DESCONOCIDOS });
    expect(salud.alerta).toContain("estado desconocido");
    expect(salud.alerta).toContain("no se reenvían solos");
  });

  it("los trabados en enviando avisan", async () => {
    const salud = await correrSms({ trabados: 2 });
    expect(salud.alerta).toContain("2 SMS trabados en enviando hace más de 30 min");
  });

  it("el conteo mensual por consultorio es informativo: se cuenta, no se limita", async () => {
    const salud = await correrSms({
      porOrganizacion: [
        { organizationId: "org-1", segmentos: 180 },
        { organizationId: "org-2", segmentos: null },
      ],
    });
    expect(salud.alerta).toBeNull();
    const conteos = salud.metricas.filter((m) => m.nombre.startsWith("sms_segmentos_mes"));
    expect(conteos).toEqual([
      expect.objectContaining({ nombre: "sms_segmentos_mes[org-1]", valor: 180, umbral: null }),
      expect.objectContaining({ nombre: "sms_segmentos_mes[org-2]", valor: 0, umbral: null }),
    ]);
  });
});
