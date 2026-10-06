// La lista de pacientes sin pantalla: qué se pide, qué vacío se muestra y
// dónde vuelve una paciente cuya reactivación falló.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PacienteConDeuda } from "@/types/domain";

const m = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiGet: m.get, apiPatch: m.patch }));

import {
  conPaciente,
  leerPacientes,
  leerTarifaDefault,
  reactivarPaciente,
  tipoDeVacio,
} from "../pacientes-datos";

const paciente = (nombre: string, apellido: string) =>
  ({ id: `${nombre}-${apellido}`, nombre, apellido }) as PacienteConDeuda;

beforeEach(() => {
  m.get.mockReset();
  m.patch.mockReset();
});

describe("leerPacientes", () => {
  it("pide el segmento y la búsqueda sin espacios, y pasa el signal", async () => {
    m.get.mockResolvedValue([]);
    const signal = new AbortController().signal;
    await leerPacientes({ segment: "archivados", query: "  ana ", signal });
    expect(m.get).toHaveBeenCalledWith("/api/pacientes?activo=false&q=ana", { signal });
  });

  it("sin búsqueda no manda q", async () => {
    m.get.mockResolvedValue([]);
    await leerPacientes({ segment: "activos", query: "   " });
    expect(m.get.mock.calls[0][0]).toBe("/api/pacientes?activo=true");
  });
});

describe("leerTarifaDefault", () => {
  it("devuelve la tarifa de Tu consultorio", async () => {
    m.get.mockResolvedValue({ tarifaDefault: 1800 });
    expect(await leerTarifaDefault()).toBe(1800);
  });

  it("sin configuración no sugiere tarifa", async () => {
    m.get.mockRejectedValue(new Error("caída"));
    expect(await leerTarifaDefault()).toBeNull();
  });
});

it("reactivar es un PATCH con activo: true", async () => {
  m.patch.mockResolvedValue({});
  await reactivarPaciente("p1");
  expect(m.patch).toHaveBeenCalledWith("/api/pacientes/p1", { activo: true });
});

it("conPaciente la devuelve a su lugar por apellido", () => {
  const lista = [paciente("Ana", "Álvarez"), paciente("Eva", "Pérez")];
  expect(conPaciente(lista, paciente("Luz", "Gómez")).map((p) => p.apellido)).toEqual([
    "Álvarez",
    "Gómez",
    "Pérez",
  ]);
});

describe("tipoDeVacio", () => {
  it("con pacientes no hay vacío", () => {
    expect(tipoDeVacio(2, "x", "activos")).toBeNull();
  });
  it("una búsqueda sin resultados gana a los segmentos", () => {
    expect(tipoDeVacio(0, "ana", "archivados")).toBe("search");
  });
  it("sin búsqueda depende del segmento", () => {
    expect(tipoDeVacio(0, " ", "activos")).toBe("noPatients");
    expect(tipoDeVacio(0, "", "archivados")).toBe("noArchived");
  });
});
