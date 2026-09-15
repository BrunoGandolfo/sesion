import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ayuda/route";
import { registrarAuditoria } from "@/app/api/_lib/auditoria";
import { responderAyudaStreaming } from "@/app/api/_lib/casos-uso/responder-ayuda";
import { reservarCupo, devolverCupo } from "@/app/api/_lib/casos-uso/ayuda/reservar-cupo";
import { ApiError } from "@/app/api/_lib/responses";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/app/api/_lib/auth", () => ({
  getSessionActor: vi.fn().mockResolvedValue({ organizationId: "org", userId: "user" }),
}));
vi.mock("@/app/api/_lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/app/api/_lib/casos-uso/responder-ayuda", () => ({
  ACCION_AYUDA: "ayuda.pregunta", ENTIDAD_AYUDA: "usuario",
  LARGO_MAX_PREGUNTA: 600, MAX_TURNOS_HISTORIAL: 6,
  responderAyudaStreaming: vi.fn(),
}));
vi.mock("@/app/api/_lib/casos-uso/ayuda/reservar-cupo", () => ({ reservarCupo: vi.fn(), devolverCupo: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reservarCupo).mockReset();
  vi.mocked(responderAyudaStreaming).mockReset();
  vi.mocked(reservarCupo).mockResolvedValue({ userId: "user", dia: "2026-09-01" });
});

it("entrega texto limpio antes de completar el proveedor y audita su largo limpio", async () => {
  let continuar!: () => void;
  const espera = new Promise<void>((resolve) => { continuar = resolve; });
  vi.mocked(responderAyudaStreaming).mockResolvedValue({
    fragmentos: (async function* () {
      yield "Hola *";
      await espera;
      yield "*Mariana*";
      yield "* cómo";
      yield "*";
    })(),
    resultado: espera.then(() => ({
      texto: "Hola **Mariana** cómo*", tokensEntrada: 2, tokensSalida: 3,
      cacheLeido: 0, cacheEscrito: 0, motivoDeCorte: "end_turn" as const,
    })),
    cancelar: vi.fn(),
  });
  const respuesta = await POST(new Request("http://localhost/api/ayuda", {
    method: "POST", body: JSON.stringify({ pregunta: "¿Cómo hago?" }),
  }));
  expect(respuesta.headers.get("Cache-Control")).toBe("no-store, no-transform");
  expect(vi.mocked(reservarCupo).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(responderAyudaStreaming).mock.invocationCallOrder[0]);
  expect(respuesta.headers.get("X-Accel-Buffering")).toBe("no");
  const lector = respuesta.body!.getReader();
  const decoder = new TextDecoder();
  const primero = await lector.read();
  expect(decoder.decode(primero.value)).toBe("Hola ");
  expect(registrarAuditoria).not.toHaveBeenCalled();
  continuar();
  let texto = decoder.decode(primero.value);
  while (true) {
    const siguiente = await lector.read();
    if (siguiente.done) break;
    texto += decoder.decode(siguiente.value);
  }
  expect(texto).toBe("Hola Mariana cómo*");
  expect(devolverCupo).not.toHaveBeenCalled();
  expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
    detalle: expect.objectContaining({ largoRespuesta: texto.length, modelo: "claude-sonnet-5" }),
  }));
});

const pedir = () => POST(new Request("http://localhost/api/ayuda", { method: "POST", body: JSON.stringify({ pregunta: "¿Cómo hago?" }) }));

it("con el cupo agotado responde 429 sin llamar al proveedor", async () => {
  vi.mocked(reservarCupo).mockRejectedValue(new ApiError("Tope diario", 429));
  expect((await pedir()).status).toBe(429);
  expect(responderAyudaStreaming).not.toHaveBeenCalled();
});

it("devuelve la reserva si el proveedor falla antes de abrir el stream", async () => {
  vi.mocked(responderAyudaStreaming).mockRejectedValue(new ApiError("Proveedor caído", 502));
  expect((await pedir()).status).toBe(502);
  expect(devolverCupo).toHaveBeenCalledTimes(1);
});

it.each([false, true])("fallo durante el stream (con fragmento=%s) devuelve solo si no hubo fragmentos", async conFragmento => {
  vi.mocked(responderAyudaStreaming).mockResolvedValue({
    fragmentos: (async function* () { if (conFragmento) yield "Hola"; throw new Error("corte"); })(),
    resultado: new Promise(() => {}), cancelar: vi.fn(),
  });
  await expect((await pedir()).text()).rejects.toThrow("corte");
  expect(devolverCupo).toHaveBeenCalledTimes(conFragmento ? 0 : 1);
});

it("cancelar conserva la reserva aunque todavía no haya fragmentos", async () => {
  const cancelar = vi.fn();
  vi.mocked(responderAyudaStreaming).mockResolvedValue({
    fragmentos: (async function* () { await new Promise(() => {}); yield ""; })(),
    resultado: new Promise(() => {}), cancelar,
  });
  const respuesta = await pedir();
  await respuesta.body!.cancel();
  expect(cancelar).toHaveBeenCalledTimes(1);
  expect(devolverCupo).not.toHaveBeenCalled();
});
