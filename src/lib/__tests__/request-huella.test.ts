import { describe, expect, it } from "vitest";

import {
  USER_AGENT_MAX,
  huellaDeRequest,
  ipDeRequest,
  userAgentDeRequest,
} from "@/lib/request-huella";

function pedido(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/x", { headers });
}

describe("ipDeRequest", () => {
  it("toma la primera IP de x-forwarded-for, que es la del cliente", () => {
    // Detrás de un proxy el header es "cliente, proxy1, proxy2": las de
    // atrás son la infraestructura, no quien pidió.
    expect(
      ipDeRequest(pedido({ "x-forwarded-for": "190.64.1.2, 10.0.0.1, 10.0.0.2" })),
    ).toBe("190.64.1.2");
  });

  it("recorta los espacios", () => {
    expect(ipDeRequest(pedido({ "x-forwarded-for": "  190.64.1.2  " }))).toBe(
      "190.64.1.2",
    );
  });

  it("cae en x-real-ip cuando no hay forwarded-for", () => {
    expect(ipDeRequest(pedido({ "x-real-ip": "190.64.1.9" }))).toBe("190.64.1.9");
  });

  it("con un x-forwarded-for vacío igual mira x-real-ip", () => {
    expect(
      ipDeRequest(pedido({ "x-forwarded-for": "  ", "x-real-ip": "190.64.1.9" })),
    ).toBe("190.64.1.9");
  });

  it("sin ningún header devuelve null, no una cadena vacía", () => {
    expect(ipDeRequest(pedido({}))).toBeNull();
  });

  it("sin request devuelve null", () => {
    expect(ipDeRequest(null)).toBeNull();
    expect(ipDeRequest(undefined)).toBeNull();
  });
});

describe("userAgentDeRequest", () => {
  it("devuelve el user-agent tal cual cuando entra", () => {
    expect(userAgentDeRequest(pedido({ "user-agent": "Safari/605" }))).toBe(
      "Safari/605",
    );
  });

  it("lo recorta: interesa reconocer el dispositivo, no archivarlo entero", () => {
    const largo = "M".repeat(USER_AGENT_MAX + 50);
    expect(userAgentDeRequest(pedido({ "user-agent": largo }))?.length).toBe(
      USER_AGENT_MAX,
    );
  });

  it("sin header devuelve null", () => {
    expect(userAgentDeRequest(pedido({}))).toBeNull();
  });
});

describe("huellaDeRequest", () => {
  it("devuelve las dos cosas juntas", () => {
    expect(
      huellaDeRequest(
        pedido({ "x-forwarded-for": "190.64.1.2", "user-agent": "Safari/605" }),
      ),
    ).toEqual({ ip: "190.64.1.2", userAgent: "Safari/605" });
  });

  it("con un request sin headers devuelve las dos en null", () => {
    expect(huellaDeRequest(pedido({}))).toEqual({ ip: null, userAgent: null });
  });
});
