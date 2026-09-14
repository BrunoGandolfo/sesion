import { afterEach, expect, it, vi } from "vitest";

import { solicitarRecuperacion } from "@/app/api/_lib/casos-uso/recuperar-cuenta";
import { POST } from "@/app/api/cuenta/recuperar/route";

const trabajo = vi.hoisted(() => ({ despues: [] as (() => Promise<void>)[] }));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => trabajo.despues.push(callback) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/cuenta-recuperacion-db", () => ({ repositorioRecuperacion: () => ({}) }));
vi.mock("@/app/api/_lib/casos-uso/recuperar-cuenta", () => ({ solicitarRecuperacion: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); trabajo.despues = []; });

it("misma respuesta para cuenta real, inexistente, limitada y fallo del correo; el trabajo va después y con la huella", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let cuerpo: string | undefined;
  for (const caso of ["real", "inexistente", "limitada", "sin-clave"]) {
    vi.mocked(solicitarRecuperacion).mockImplementation(async () => { if (caso === "sin-clave") throw Error("sin clave"); });
    const res = await POST(new Request("https://sesionapp.app/api/cuenta/recuperar", {
      method: "POST", headers: { "x-forwarded-for": "203.0.113.7" }, body: JSON.stringify({ email: `${caso}@example.test` }),
    }));
    expect(res.status).toBe(200);
    const texto = await res.text(); cuerpo ??= texto; expect(texto).toBe(cuerpo);
    expect(solicitarRecuperacion).not.toHaveBeenCalled();
    await trabajo.despues.pop()!();
    expect(vi.mocked(solicitarRecuperacion).mock.calls[0][1]).toMatchObject({ huella: { ip: "203.0.113.7" } });
    vi.mocked(solicitarRecuperacion).mockClear();
  }
});

it("JSON inválido también devuelve el cuerpo neutro", async () => {
  const res = await POST(new Request("https://sesionapp.app/api/cuenta/recuperar", { method: "POST", body: "{" }));
  expect(res.status).toBe(200); expect(trabajo.despues).toHaveLength(0);
});
