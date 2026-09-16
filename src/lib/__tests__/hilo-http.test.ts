import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSessionActor, type SessionActor } from "@/app/api/_lib/auth";
import { autorizarEdicionHilo, responderHilo } from "@/app/api/_lib/hilo-http";
import { ApiError } from "@/app/api/_lib/responses";

// Solo se sustituye la sesión de Next: origen, respuestas y errores son reales.
vi.mock("@/app/api/_lib/auth", () => ({ getSessionActor: vi.fn() }));

const actor: SessionActor = {
  organizationId: "org-propia", userId: "profesional", sesionId: "acceso",
  rol: "titular", nombre: "Ana", email: "ana@example.test",
};
beforeEach(() => {
  vi.mocked(getSessionActor).mockReset();
  vi.mocked(getSessionActor).mockResolvedValue(actor);
});

describe("autorizarEdicionHilo", () => {
  it.each([
    { caso: "URL cuando no hay Host", url: "https://sesion.test/api/hilo", headers: new Headers({ origin: "https://sesion.test" }) },
    { caso: "Host cuando difiere de la URL interna", url: "http://interno:3000/api/hilo", headers: new Headers({ origin: "https://sesion.test", host: "sesion.test" }) },
  ])("autoriza por $caso y devuelve la identidad autenticada", async ({ url, headers }) => {
    const request = new Request(url, { method: "POST", headers });
    await expect(autorizarEdicionHilo(request)).resolves.toEqual(actor);
    expect(getSessionActor).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    { caso: "Origin ajeno aunque Fetch-Site diga same-origin", headers: new Headers({ origin: "https://ajeno.test", "sec-fetch-site": "same-origin" }) },
    { caso: "Origin malformado", headers: new Headers({ origin: "no es una URL" }) },
    { caso: "Fetch-Site cross-site sin Origin", headers: new Headers({ "sec-fetch-site": "cross-site" }) },
  ])("rechaza $caso antes de consultar la sesión", async ({ headers }) => {
    const request = new Request("https://sesion.test/api/hilo", { method: "POST", headers });
    await expect(autorizarEdicionHilo(request)).rejects.toMatchObject({ status: 403, message: "Origen no permitido" });
    expect(getSessionActor).not.toHaveBeenCalled();
  });

  it("un origen propio no reemplaza la sesión: propaga el 401", async () => {
    const error = new ApiError("No autorizado", 401);
    vi.mocked(getSessionActor).mockRejectedValue(error);
    const request = new Request("https://sesion.test/api/hilo", { method: "POST", headers: { origin: "https://sesion.test" } });
    await expect(autorizarEdicionHilo(request)).rejects.toBe(error);
  });
});

describe("responderHilo", () => {
  it("responde JSON con data y prohíbe almacenar la respuesta clínica en caché", async () => {
    const contenido = { version: 3, texto: "Historia clínica sintética" };
    const respuesta = responderHilo(contenido);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toContain("application/json");
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    expect(await respuesta.json()).toEqual({ data: contenido });
  });
});
