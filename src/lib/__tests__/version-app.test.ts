import { afterEach, expect, it, vi } from "vitest";
import { esRutaPublica } from "../sesion-cookie";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("entrega sólo el identificador público del build, sin caché", async () => {
  vi.stubEnv("NEXT_PUBLIC_VERSION_APP", "build-de-prueba");
  vi.resetModules();
  const { GET, dynamic, maxDuration } = await import("@/app/api/version/route");
  const res = GET();
  expect(await res.json()).toEqual({ data: { version: "build-de-prueba" } });
  expect(res.headers.get("Cache-Control")).toContain("no-store");
  expect(maxDuration).toBe(15);
  expect(dynamic).toBe("force-dynamic");
  expect(esRutaPublica("/api/version")).toBe(true);
  expect(esRutaPublica("/api/version/otra")).toBe(false);
});
