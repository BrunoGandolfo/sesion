// Las lecturas, mutaciones y reglas del vocabulario, sin pantalla.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";

import {
  crearHotWord,
  filtrarPorTermino,
  importarHotWords,
  infoCategoria,
  mensajeAlAgregar,
  terminosDeTexto,
  tituloScope,
  type HotWord,
} from "../hot-words-datos";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiPost: api.post,
}));

beforeEach(() => {
  api.post.mockReset();
  api.post.mockResolvedValue({});
});

const termino = (t: string): HotWord => ({ id: t, termino: t, categoria: null, activo: true, scope: "global" });

describe("filtrarPorTermino", () => {
  const items = [termino("Transferencia"), termino("gurí")];
  it("filtra sin mayúsculas y con la búsqueda recortada", () => {
    expect(filtrarPorTermino(items, "  TRANS ").map((i) => i.id)).toEqual(["Transferencia"]);
  });
  it("sin búsqueda devuelve la misma lista", () => {
    expect(filtrarPorTermino(items, " ")).toBe(items);
  });
});

describe("terminosDeTexto", () => {
  it("separa por coma y por renglón, sin vacíos", () => {
    expect(terminosDeTexto("transferencia, encuadre\n\ngurí ,\n Lacan")).toEqual([
      "transferencia",
      "encuadre",
      "gurí",
      "Lacan",
    ]);
  });
});

describe("infoCategoria y tituloScope", () => {
  it("una categoría vieja o nula cae en Otro", () => {
    expect(infoCategoria(null).value).toBe("otro");
    expect(infoCategoria("vieja").value).toBe("otro");
    expect(infoCategoria("termino_clinico").variant).toBe("sage");
  });
  it("el título dice de quién es el vocabulario", () => {
    expect(tituloScope("global")).toBe("Vocabulario global");
    expect(tituloScope("profesional")).toBe("Vocabulario propio");
    expect(tituloScope("paciente", "Ana")).toBe("Vocabulario de Ana");
    expect(tituloScope("paciente")).toBe("Vocabulario del paciente");
  });
});

describe("mensajeAlAgregar", () => {
  it("409 es 'ya existe'; otro error de la API dice su motivo; uno de red, un texto propio", () => {
    expect(mensajeAlAgregar(new ApiClientError("Duplicado", 409))).toBe("Este término ya existe");
    expect(mensajeAlAgregar(new ApiClientError("Muy largo", 400))).toBe("Muy largo");
    expect(mensajeAlAgregar(new TypeError("Failed to fetch"))).toBe(
      "No pudimos agregar el término. Intentá de nuevo.",
    );
  });
});

describe("mutaciones", () => {
  it("el alta manda pacienteId null cuando no hay", async () => {
    await crearHotWord({ termino: "gurí", categoria: "modismo_rioplatense", scope: "profesional", pacienteId: undefined });
    expect(api.post).toHaveBeenCalledWith("/api/hot-words", {
      termino: "gurí",
      categoria: "modismo_rioplatense",
      scope: "profesional",
      pacienteId: null,
    });
  });

  it("la carga masiva manda un item completo por término, con pacienteId solo en scope paciente", async () => {
    await importarHotWords({ terminos: ["a", "b"], categoria: "otro", scope: "global", pacienteId: "p1" });
    expect(api.post).toHaveBeenLastCalledWith("/api/hot-words", {
      hotWords: [
        { termino: "a", scope: "global", categoria: "otro", pacienteId: null },
        { termino: "b", scope: "global", categoria: "otro", pacienteId: null },
      ],
    });
    await importarHotWords({ terminos: ["a"], categoria: "otro", scope: "paciente", pacienteId: "p1" });
    expect(api.post).toHaveBeenLastCalledWith("/api/hot-words", {
      hotWords: [{ termino: "a", scope: "paciente", categoria: "otro", pacienteId: "p1" }],
    });
  });
});
