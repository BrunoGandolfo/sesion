import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ayuda/route";
import { registrarAuditoria } from "@/app/api/_lib/auditoria";
import { responderAyudaStreaming } from "@/app/api/_lib/casos-uso/responder-ayuda";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/app/api/_lib/auth", () => ({
  getSessionActor: vi.fn().mockResolvedValue({ organizationId: "org", userId: "user" }),
}));
vi.mock("@/app/api/_lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/app/api/_lib/casos-uso/responder-ayuda", () => ({
  ACCION_AYUDA: "ayuda.pregunta", ENTIDAD_AYUDA: "usuario",
  LARGO_MAX_PREGUNTA: 600, MAX_TURNOS_HISTORIAL: 6,
  assertBajoElTope: vi.fn(), responderAyudaStreaming: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

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
  expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
    detalle: expect.objectContaining({ largoRespuesta: texto.length, modelo: "claude-sonnet-5" }),
  }));
});
