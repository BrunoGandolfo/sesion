import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  esAbort,
} from "@/lib/api-client";

function respuestaJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api-client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("apiGet", () => {
    it("desenvuelve { data } y pide sin cache", async () => {
      fetchMock.mockResolvedValue(respuestaJson({ data: { id: "p1" } }));

      const paciente = await apiGet<{ id: string }>("/api/pacientes/p1");

      expect(paciente).toEqual({ id: "p1" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/pacientes/p1");
      expect(init.method).toBe("GET");
      expect(init.cache).toBe("no-store");
    });

    it("pasa el signal a fetch", async () => {
      fetchMock.mockResolvedValue(respuestaJson({ data: null }));
      const controller = new AbortController();

      await apiGet("/api/config", { signal: controller.signal });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBe(controller.signal);
    });

    it("404 lanza ApiClientError con el status y el mensaje del body", async () => {
      fetchMock.mockResolvedValue(
        respuestaJson({ error: "Paciente no encontrado" }, 404),
      );

      const error = await apiGet("/api/pacientes/nope").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiClientError);
      const apiError = error as ApiClientError;
      expect(apiError.status).toBe(404);
      expect(apiError.message).toBe("Paciente no encontrado");
      expect(apiError.mensaje).toBe("Paciente no encontrado");
      expect(apiError.esNoEncontrado).toBe(true);
      expect(apiError.esNoAutorizado).toBe(false);
      expect(apiError.details).toBeUndefined();
    });

    it("500 sin body JSON lanza con mensaje genérico en español", async () => {
      fetchMock.mockResolvedValue(
        new Response("Internal Server Error", { status: 500 }),
      );

      const error = await apiGet("/api/dashboard").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiClientError);
      const apiError = error as ApiClientError;
      expect(apiError.status).toBe(500);
      expect(apiError.message).toBe(
        "No pudimos completar la operación. Intentá de nuevo.",
      );
    });

    it("401 marca esNoAutorizado", async () => {
      fetchMock.mockResolvedValue(respuestaJson({ error: "No autorizado" }, 401));

      const error = await apiGet("/api/config").catch((e: unknown) => e);

      expect((error as ApiClientError).esNoAutorizado).toBe(true);
      expect((error as ApiClientError).esNoEncontrado).toBe(false);
    });

    it("un validationError trae details en error.details", async () => {
      const details = {
        formErrors: [],
        fieldErrors: { nombre: ["Falta el nombre"] },
      };
      fetchMock.mockResolvedValue(
        respuestaJson({ error: "Datos inválidos", details }, 400),
      );

      const error = await apiPost("/api/pacientes", { nombre: "" }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ApiClientError);
      const apiError = error as ApiClientError;
      expect(apiError.status).toBe(400);
      expect(apiError.message).toBe("Datos inválidos");
      expect(apiError.details).toEqual(details);
    });

    it("AbortError se propaga tal cual, sin envolver", async () => {
      const abort = new DOMException("The operation was aborted.", "AbortError");
      fetchMock.mockRejectedValue(abort);

      const error = await apiGet("/api/config").catch((e: unknown) => e);

      expect(error).toBe(abort);
      expect(error).not.toBeInstanceOf(ApiClientError);
      expect(esAbort(error)).toBe(true);
    });
  });

  describe("apiPost / apiPatch / apiDelete", () => {
    it("POST manda Content-Type JSON y el body serializado", async () => {
      fetchMock.mockResolvedValue(
        respuestaJson({ data: { id: "h1", termino: "gurí" } }, 201),
      );

      const creado = await apiPost<{ id: string }>("/api/hot-words", {
        termino: "gurí",
        scope: "global",
      });

      expect(creado).toEqual({ id: "h1", termino: "gurí" });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/hot-words");
      expect(init.method).toBe("POST");
      expect(init.cache).toBe("no-store");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(init.body).toBe(JSON.stringify({ termino: "gurí", scope: "global" }));
    });

    it("PATCH usa el método y serializa el body", async () => {
      fetchMock.mockResolvedValue(respuestaJson({ data: { activo: false } }));

      await apiPatch("/api/hot-words/h1", { activo: false });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("PATCH");
      expect(init.body).toBe(JSON.stringify({ activo: false }));
    });

    it("DELETE sin body manda body undefined y desenvuelve la respuesta", async () => {
      fetchMock.mockResolvedValue(respuestaJson({ data: { id: "h1" } }));

      const borrado = await apiDelete<{ id: string }>("/api/hot-words/h1");

      expect(borrado).toEqual({ id: "h1" });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("DELETE");
      expect(init.body).toBeUndefined();
    });

    it("un 409 en POST lanza ApiClientError con el mensaje del body", async () => {
      fetchMock.mockResolvedValue(
        respuestaJson({ error: "Hot word duplicado" }, 409),
      );

      const error = await apiPost("/api/hot-words", { termino: "x" }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as ApiClientError).status).toBe(409);
      expect((error as ApiClientError).message).toBe("Hot word duplicado");
    });
  });

  describe("esAbort", () => {
    it("reconoce un Error con name AbortError (fetch de Node)", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      expect(esAbort(error)).toBe(true);
    });

    it("no reconoce otros errores ni valores sueltos", () => {
      expect(esAbort(new Error("otra cosa"))).toBe(false);
      expect(esAbort(new ApiClientError("x", 500))).toBe(false);
      expect(esAbort(null)).toBe(false);
      expect(esAbort("AbortError")).toBe(false);
    });
  });
});
