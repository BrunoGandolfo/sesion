// @vitest-environment jsdom
//
// La hoja de una paciente con una sola nota aprobada y sin Recorrido
// revisado. En producción salía en tres páginas: cada sección forzaba una
// página nueva. Ahora las secciones fluyen; el PDF de una página lo mide el
// guion de entrega con Chromium (entrega/minimo.pdf), porque jsdom no pagina.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { apiPost } from "@/lib/api-client";

import { periodoDeNotas } from "../cabecera";
import { RecorridoImprimible } from "../recorrido-imprimible";
import { exportacionDePrueba, exportacionMinima } from "./fixture-exportacion";

vi.mock("@/lib/api-client", () => ({ apiPost: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function hoja(datos: ReturnType<typeof exportacionMinima>): Promise<string> {
  vi.mocked(apiPost).mockResolvedValue(datos);
  const { container } = render(<RecorridoImprimible pacienteId="p" />);
  await screen.findByRole("heading", { level: 1, name: "Ana Pérez" });
  return container.querySelector("article")!.outerHTML;
}

describe("hoja mínima", () => {
  it("coincide con su snapshot", async () => {
    await expect(await hoja(exportacionMinima())).toMatchFileSnapshot("./__snapshots__/hoja-minima.html");
  });

  it("con una sola fecha dice el día, no «del X al X»", async () => {
    const html = await hoja(exportacionMinima());
    expect(html).toContain("1 nota aprobada, el 30 de septiembre de 2026");
    expect(html).not.toMatch(/del 30 de septiembre de 2026 al/);
  });

  it("ninguna sección fuerza una página nueva, ni en la hoja mínima ni en la rica", async () => {
    expect(await hoja(exportacionMinima())).not.toMatch(/break-before/);
    cleanup();
    expect(await hoja(exportacionDePrueba())).not.toMatch(/break-before/);
  });
});

describe("el papel", () => {
  // El PDF real lo mide el guion de entrega: lo pide en Carta y sale en A4,
  // así que el tamaño lo pone esta regla y no el navegador.
  const css = readFileSync(join(process.cwd(), "src/app/(impresion)/impresion.css"), "utf8");
  it("es A4, y ninguna regla del papel fuerza página nueva", () => {
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*A4;/);
    expect(css).not.toMatch(/break-before|page-break-before/);
  });
});

describe("periodoDeNotas", () => {
  const s = (...fechas: string[]) => fechas.map((fecha, i) => ({ id: String(i), fecha }));

  it("el mismo día se cuenta en Montevideo, no en UTC", () => {
    // 12:00 y 23:30 de Montevideo del 30: en UTC ya es el 1 de octubre.
    expect(periodoDeNotas(s("2026-09-30T15:00:00.000Z", "2026-10-01T02:30:00.000Z"))).toBe(
      "2 notas aprobadas, el 30 de septiembre de 2026",
    );
    // 22:00 del 29 y 10:00 del 30 en Montevideo: mismo día UTC, distinto día acá.
    expect(periodoDeNotas(s("2026-09-30T01:00:00.000Z", "2026-09-30T13:00:00.000Z"))).toBe(
      "2 notas aprobadas, del 29 de septiembre de 2026 al 30 de septiembre de 2026",
    );
  });

  it("sin notas lo dice", () => {
    expect(periodoDeNotas([])).toBe("Ninguna nota aprobada todavía");
  });
});
