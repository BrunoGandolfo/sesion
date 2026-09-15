import { beforeEach, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";
import { GET } from "@/app/api/pacientes/[id]/hilo/route";
import { POST } from "@/app/api/pacientes/[id]/hilo/versiones/route";
import { getSessionActor } from "@/app/api/_lib/auth";
import { autorizarTicketSesion } from "@/app/api/_lib/tickets";
import { leerHiloParaWorker, leerRecorrido } from "@/app/api/_lib/casos-uso/hilo/leer";
import { editarHilo } from "@/app/api/_lib/casos-uso/hilo/escribir";
import { ApiError } from "@/app/api/_lib/responses";
import { hiloVacio } from "@/lib/hilo/contenido";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/app/api/_lib/auth", () => ({ getSessionActor: vi.fn() }));
vi.mock("@/app/api/_lib/tickets", () => ({ autorizarTicketSesion: vi.fn() }));
vi.mock("@/app/api/_lib/casos-uso/hilo/leer", () => ({ leerRecorrido: vi.fn(), leerHiloParaWorker: vi.fn() }));
vi.mock("@/app/api/_lib/casos-uso/hilo/escribir", () => ({ editarHilo: vi.fn() }));
const params = { params: Promise.resolve({ id: "paciente" }) };
const url = "https://app.test/api/pacientes/paciente/hilo";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSessionActor).mockResolvedValue({ organizationId: "org", userId: "u" } as Awaited<ReturnType<typeof getSessionActor>>);
});

it("la lectura del worker no pasa por login y exige el ticket de la sesión reclamada", async () => {
  expect(unstable_doesMiddlewareMatch({ config, url: `${url}?format=llm&sesionId=s1` })).toBe(false);
  vi.mocked(autorizarTicketSesion).mockRejectedValueOnce(new ApiError("No autorizado", 401));
  const rechazo = await GET(new Request(`${url}?format=llm&sesionId=s1`), params);
  expect(rechazo.status).toBe(401);
  expect(rechazo.headers.get("location")).toBeNull();
  expect(leerHiloParaWorker).not.toHaveBeenCalled();
  vi.mocked(autorizarTicketSesion).mockResolvedValue({ sesionId: "s1", organizationId: "org", intento: 2 });
  vi.mocked(leerHiloParaWorker).mockResolvedValue({ tipo: "hilo_vigente", pacienteId: "paciente", version: 0, contenido: null });
  const r = await GET(new Request(`${url}?format=llm&sesionId=s1`, { headers: { authorization: "Bearer ticket" } }), params);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("application/json");
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(await r.json()).toEqual({ data: { tipo: "hilo_vigente", pacienteId: "paciente", version: 0, contenido: null } });
  expect(getSessionActor).not.toHaveBeenCalled();
});

it("el formato humano exige sesión y no admite otro formato", async () => {
  vi.mocked(getSessionActor).mockRejectedValue(new ApiError("No autorizado", 401));
  expect((await GET(new Request(url), params)).status).toBe(401);
  expect(leerRecorrido).not.toHaveBeenCalled();
  expect((await GET(new Request(`${url}?format=html`), params)).status).toBe(400);
});

it("las escrituras fuera del proxy siguen rechazando otros orígenes", async () => {
  const r = await POST(new Request(`${url}/versiones`, { method: "POST", headers: { origin: "https://otro.test" }, body: JSON.stringify({ basadaEnVersion: 0, contenido: hiloVacio() }) }), params);
  expect(r.status).toBe(403);
  expect(editarHilo).not.toHaveBeenCalled();
});

it("una edición inválida no llega al caso de uso", async () => {
  const r = await POST(new Request(`${url}/versiones`, { method: "POST", headers: { origin: "https://app.test" }, body: JSON.stringify({ basadaEnVersion: 0, contenido: {} }) }), params);
  expect(r.status).toBe(400);
  expect(editarHilo).not.toHaveBeenCalled();
});
