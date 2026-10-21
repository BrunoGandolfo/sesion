// Unitario — el pedido de apertura de Lux con y sin conversación previa: si
// ya hablaron, el saludo empieza por dónde quedaron y cuándo.

import { describe, expect, it } from "vitest";

import { PEDIDO_APERTURA, pedidoApertura } from "@/app/api/_lib/casos-uso/lux/conversar";

describe("pedidoApertura", () => {
  it("sin conversación previa es el pedido de siempre", () => {
    expect(pedidoApertura(null)).toBe(PEDIDO_APERTURA);
    expect(PEDIDO_APERTURA).not.toMatch(/quedaron/);
  });

  it("con conversación previa pide la línea de en qué quedaron, con la fecha de Montevideo", () => {
    // 02:30 del 3 de octubre en UTC es todavía el 2 en Montevideo.
    const pedido = pedidoApertura(new Date("2026-10-03T02:30:00Z"));
    expect(pedido).toContain("02/10/2026");
    expect(pedido).toContain("en qué quedaron");
    expect(pedido).toContain("<apertura>");
  });
});
