// Las lecturas y reglas del formulario de agendar, sin pantalla.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import { agregarDiasMvd } from "@/lib/fechas-montevideo";
import { ALGO_FALLO, TARIFA_SIN_CARGAR } from "@/lib/glosario";

import {
  coincide,
  crearPacienteRapido,
  leerPropuesta,
  mensajeDeCreacion,
  separarNombre,
  tarifaUsable,
} from "../nuevo-turno-datos";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: api.get,
  apiPost: api.post,
}));

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe("separarNombre", () => {
  it("la última palabra es el apellido", () => {
    expect(separarNombre("  Ana María   Pérez ")).toEqual({ nombre: "Ana María", apellido: "Pérez" });
  });
  it("con una sola palabra no hay apellido", () => {
    expect(separarNombre("Ana")).toEqual({ nombre: "Ana", apellido: "" });
    expect(separarNombre("   ")).toEqual({ nombre: "", apellido: "" });
  });
});

describe("coincide", () => {
  const p = { nombre: "Lucía", apellido: "Fernández" };
  it("busca en el nombre completo, sin mayúsculas", () => {
    expect(coincide(p, "cía fer")).toBe(true);
    expect(coincide(p, "pérez")).toBe(false);
  });
  it("una búsqueda vacía muestra a todas", () => {
    expect(coincide(p, "  ")).toBe(true);
  });
});

describe("tarifaUsable", () => {
  it("es la regla del servidor: entera y mayor a cero", () => {
    expect(tarifaUsable(1500)).toBe(true);
    expect(tarifaUsable(0)).toBe(false);
    expect(tarifaUsable(null)).toBe(false);
  });
});

describe("leerPropuesta", () => {
  const ahora = new Date("2026-10-06T12:00:00Z");

  it("sin turnos no propone nada", async () => {
    api.get.mockResolvedValue([]);
    expect(await leerPropuesta("p1", new AbortController().signal, ahora)).toBeNull();
  });

  it("propone una semana después del último turno, ya en el futuro", async () => {
    api.get.mockResolvedValue([{ fecha: "2026-09-01T13:00:00Z" }, { fecha: "2026-09-29T13:00:00Z" }]);
    const signal = new AbortController().signal;
    const propuesta = await leerPropuesta("p1", signal, ahora);
    expect(propuesta?.toISOString()).toBe(agregarDiasMvd(new Date("2026-09-29T13:00:00Z"), 7).toISOString());
    const [url, opciones] = api.get.mock.calls[0];
    expect(url).toContain("pacienteId=p1");
    expect(opciones).toEqual({ signal });
  });
});

describe("crearPacienteRapido", () => {
  const base = { nombreYApellido: "Ana Pérez", telefono: " 099 ", tarifaDefault: 1500 };

  it("pide nombre y apellido, teléfono y una tarifa usable antes de llamar a la API", async () => {
    await expect(crearPacienteRapido({ ...base, nombreYApellido: "Ana" })).rejects.toThrow("Ingresá nombre y apellido");
    await expect(crearPacienteRapido({ ...base, telefono: "  " })).rejects.toThrow("Ingresá el teléfono");
    await expect(crearPacienteRapido({ ...base, tarifaDefault: 0 })).rejects.toThrow(TARIFA_SIN_CARGAR);
    await expect(crearPacienteRapido({ ...base, tarifaDefault: null })).rejects.toThrow(TARIFA_SIN_CARGAR);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("crea con la tarifa del consultorio y devuelve el id", async () => {
    api.post.mockResolvedValue({ id: "nueva" });
    expect(await crearPacienteRapido(base)).toBe("nueva");
    expect(api.post).toHaveBeenCalledWith("/api/pacientes", {
      nombre: "Ana",
      apellido: "Pérez",
      telefono: "099",
      tarifa: 1500,
      notas: null,
    });
  });
});

describe("mensajeDeCreacion", () => {
  it("dice el texto de la API o de la validación, o el genérico", () => {
    expect(mensajeDeCreacion(new ApiClientError("Ya existe", 409))).toBe("Ya existe");
    expect(mensajeDeCreacion(new Error("Ingresá el teléfono"))).toBe("Ingresá el teléfono");
    expect(mensajeDeCreacion("raro")).toBe(ALGO_FALLO);
  });
});
