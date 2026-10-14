// @vitest-environment jsdom
// Salir borra lo que el teléfono guarda con nombres de pacientes: el aviso de
// notas y la agenda local para grabar sin señal (/sin-conexion es pública y
// el navegador puede ser compartido). Recién después navega.
import { afterEach, expect, it, vi } from "vitest";

const orden = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/agenda-local", () => ({ olvidarAgendaLocal: async () => { orden.push("agenda"); } }));
vi.mock("@/lib/notas-en-proceso", () => ({ olvidarNotas: () => { orden.push("notas"); } }));

import { salir } from "@/lib/sesion-cliente";

afterEach(() => { vi.unstubAllGlobals(); orden.length = 0; });

it("borra la agenda local antes de navegar, también sin red", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin red")));
  const assign = vi.fn(() => orden.push("navega"));
  vi.stubGlobal("location", { ...window.location, assign });
  await salir("/login");
  expect(orden).toEqual(["notas", "agenda", "navega"]);
  expect(assign).toHaveBeenCalledWith("/login");
});
