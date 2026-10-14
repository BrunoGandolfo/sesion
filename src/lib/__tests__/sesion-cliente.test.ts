// @vitest-environment jsdom
// Salir borra lo que el teléfono guarda con nombres de pacientes: el aviso de
// notas y la agenda local para grabar sin señal (/sin-conexion es pública y
// el navegador puede ser compartido). Recién después navega.
import { afterEach, expect, it, vi } from "vitest";

const orden = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/agenda-local", () => ({
  olvidarAgendaLocal: async () => { orden.push("agenda"); },
  abrirAgendaLocal: async () => { orden.push("reabre"); },
}));
vi.mock("@/lib/notas-en-proceso", () => ({ olvidarNotas: () => { orden.push("notas"); } }));

import { salir } from "@/lib/sesion-cliente";

afterEach(() => { vi.unstubAllGlobals(); orden.length = 0; });

function navegar() {
  const assign = vi.fn(() => orden.push("navega"));
  vi.stubGlobal("location", { ...window.location, assign });
  return assign;
}

it("borra la agenda local antes de navegar y la deja cerrada si el servidor cerró la sesión", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { ok: true } })));
  const assign = navegar();
  await salir("/login");
  expect(orden).toEqual(["notas", "agenda", "navega"]);
  expect(assign).toHaveBeenCalledWith("/login");
});

it.each([
  ["sin red", () => vi.fn().mockRejectedValue(new Error("sin red"))],
  ["con un error del servidor", () => vi.fn().mockResolvedValue(new Response("falló", { status: 500 }))],
])("%s la sesión sigue viva: la agenda se borra pero vuelve a aceptar escrituras", async (_caso, fetch) => {
  vi.stubGlobal("fetch", fetch());
  navegar();
  await salir("/login");
  expect(orden).toEqual(["notas", "agenda", "reabre", "navega"]);
});
