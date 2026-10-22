// Unitario — el agregador de salud.
//
// Sin base: las fuentes se inyectan. Lo que se prueba es la DECISIÓN (qué
// cruza, qué nivel, qué texto) y que una fuente rota no deje ciego al resto.

import { describe, expect, it } from "vitest";

import { revisarSalud } from "@/app/api/_lib/casos-uso/salud";
import type { ContextoMetricas, FuenteMetricas } from "@/lib/salud-metricas";

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
        fuente("b", async () => [{ nombre: "b1", valor: 2, umbral: 2, texto: "avisos fallidos" }]),
      ],
    });

    expect(salud.alerta).toBe("Sesión: 3 sesiones trabadas; 2 avisos fallidos");
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
