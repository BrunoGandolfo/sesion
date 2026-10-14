// Unitario — POST /api/pacientes/[id]/lux: el contrato de la ruta. El caso de
// uso se dobla (su comportamiento está en lux-integracion.test.ts); el rastro
// es el de verdad, escrito con un registrarAuditoria doblado.

import { beforeEach, expect, it, vi } from "vitest";

import { POST } from "@/app/api/pacientes/[id]/lux/route";
import { registrarAuditoria } from "@/app/api/_lib/auditoria";
import { abrirConversacion, autorizarPaciente, ErrorProveedorLux, responder } from "@/app/api/_lib/casos-uso/lux/conversar";
import { devolverCupo, reservarCupo } from "@/app/api/_lib/casos-uso/ayuda/reservar-cupo";
import { ApiError } from "@/app/api/_lib/responses";
import type { ResultadoConversacion } from "@/lib/anthropic-mensajes";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/app/api/_lib/auth", () => ({
  getSessionActor: vi.fn().mockResolvedValue({ organizationId: "org", userId: "user" }),
}));
vi.mock("@/app/api/_lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/app/api/_lib/casos-uso/lux/conversar", async (original) => ({
  ...(await original<typeof import("@/app/api/_lib/casos-uso/lux/conversar")>()),
  abrirConversacion: vi.fn(),
  responder: vi.fn(),
  autorizarPaciente: vi.fn(),
}));
vi.mock("@/app/api/_lib/casos-uso/ayuda/reservar-cupo", () => ({ reservarCupo: vi.fn(), devolverCupo: vi.fn() }));

const RESULTADO: ResultadoConversacion = {
  texto: "<citas>\n01/09: \"me voy\"\n</citas>\nTEXTO", tokensEntrada: 10, tokensSalida: 5, cacheLeido: 0, cacheEscrito: 0,
  motivoDeCorte: "end_turn", rondas: 1, llamadas: [],
};
const PROGRESO = { tokensEntrada: 7, tokensSalida: 3, cacheLeido: 0, cacheEscrito: 0, rondas: 1, llamadas: [] };
const conversacion = (fragmentos: string[] = ["<citas>\n01/09: \"me voy\"\n</citas>\n", "**TEXTO**"]) => ({
  flujo: { fragmentos: (async function* () { yield* fragmentos; })(), resultado: Promise.resolve(RESULTADO), cancelar: vi.fn(), progreso: () => PROGRESO },
  material: { notas: 3, transcripciones: ["a", "b"], transcripcionesOmitidas: 0, releidas: [], releidasOmitidas: 0 },
  ejecutor: { leidas: [], aviso: () => null, ejecutar: vi.fn() },
});

const pedir = (cuerpo: unknown, id = "pac-1") => POST(
  new Request(`http://localhost/api/pacientes/${id}/lux`, { method: "POST", body: JSON.stringify(cuerpo) }),
  { params: Promise.resolve({ id }) },
);

async function leer(respuesta: Response) {
  return respuesta.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reservarCupo).mockResolvedValue({ userId: "user", dia: "2026-10-08", ambito: "lux" });
  vi.mocked(autorizarPaciente).mockResolvedValue(undefined);
  vi.mocked(abrirConversacion).mockResolvedValue(conversacion());
  vi.mocked(responder).mockResolvedValue(conversacion());
});

it("sin pregunta ni historial es la apertura: autoriza, reserva cupo de Lux y transmite tal cual", async () => {
  const respuesta = await pedir({});
  expect(respuesta.status).toBe(200);
  expect(respuesta.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  expect(respuesta.headers.get("X-Accel-Buffering")).toBe("no");
  expect(respuesta.headers.get("Cache-Control")).toBe("no-store, no-transform");
  // Sin limpiarMarkdown: las citas y el formato son para la pantalla.
  expect(await leer(respuesta)).toBe("<citas>\n01/09: \"me voy\"\n</citas>\n**TEXTO**");
  expect(autorizarPaciente).toHaveBeenCalledWith(db, "org", "pac-1");
  expect(reservarCupo).toHaveBeenCalledWith(db, "user", expect.any(Date), "lux");
  expect(vi.mocked(autorizarPaciente).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(reservarCupo).mock.invocationCallOrder[0]);
  expect(vi.mocked(reservarCupo).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(abrirConversacion).mock.invocationCallOrder[0]);
  expect(abrirConversacion).toHaveBeenCalledWith({ prisma: db, organizationId: "org", usuarioId: "user", pacienteId: "pac-1" });
  expect(responder).not.toHaveBeenCalled();
  expect(registrarAuditoria).toHaveBeenCalledWith(db, expect.objectContaining({
    accion: "lux.abrir", entidad: "paciente", entidadId: "pac-1",
    detalle: expect.objectContaining({ notas: 3, transcripcionesEnMaterial: 2, largoPregunta: 0 }),
  }));
  expect(devolverCupo).not.toHaveBeenCalled();
});

it("con pregunta responde con el historial y audita lux.pregunta sin el texto", async () => {
  const respuesta = await pedir({ pregunta: "PREGUNTA_SECRETA", historial: [{ rol: "asistente", texto: "hola" }] });
  await leer(respuesta);
  expect(responder).toHaveBeenCalledWith(expect.objectContaining({
    pacienteId: "pac-1", pregunta: "PREGUNTA_SECRETA", historial: [{ rol: "asistente", texto: "hola" }],
  }));
  const evento = vi.mocked(registrarAuditoria).mock.calls[0][1];
  expect(evento).toMatchObject({ accion: "lux.pregunta", detalle: expect.objectContaining({ largoPregunta: 16, turnosHistorial: 1 }) });
  expect(JSON.stringify(evento)).not.toMatch(/PREGUNTA_SECRETA|TEXTO/);
});

it("valida el cuerpo: historial sin pregunta, pregunta larga, campos de más", async () => {
  for (const cuerpo of [
    { historial: [{ rol: "asistente", texto: "hola" }] },
    { pregunta: "x".repeat(2001) },
    { pregunta: "hola", organizationId: "otra" },
    { pregunta: "   " },
  ]) {
    const respuesta = await pedir(cuerpo);
    expect(respuesta.status).toBe(400);
  }
  expect(reservarCupo).not.toHaveBeenCalled();
});

it("una respuesta larga de Lux vuelve entera en el historial; una pregunta vieja larga, no", async () => {
  const larga = "a".repeat(30_000);
  expect((await pedir({ pregunta: "¿y?", historial: [{ rol: "asistente", texto: larga }] })).status).toBe(200);
  expect(responder).toHaveBeenCalledWith(expect.objectContaining({ historial: [{ rol: "asistente", texto: larga }] }));
  expect((await pedir({ pregunta: "¿y?", historial: [{ rol: "usuaria", texto: "b".repeat(2001) }] })).status).toBe(400);
  expect((await pedir({ pregunta: "¿y?", historial: [{ rol: "asistente", texto: "c".repeat(100_001) }] })).status).toBe(400);
});

it("paciente ajeno: 404 sin gastar cupo", async () => {
  vi.mocked(autorizarPaciente).mockRejectedValue(new ApiError("Paciente no encontrado", 404));
  const respuesta = await pedir({});
  expect(respuesta.status).toBe(404);
  expect(reservarCupo).not.toHaveBeenCalled();
});

it("tope de Lux: 429 con su mensaje", async () => {
  vi.mocked(reservarCupo).mockRejectedValue(new ApiError("Por hoy llegaste a las 60 consultas a Lux.", 429));
  const respuesta = await pedir({});
  expect(respuesta.status).toBe(429);
  expect(abrirConversacion).not.toHaveBeenCalled();
});

it("si el caso de uso falla antes de llamar al proveedor (base, validación), devuelve el cupo", async () => {
  for (const error of [new ApiError("Error interno", 500), new ApiError("Escribí una pregunta.", 400)]) {
    vi.mocked(abrirConversacion).mockRejectedValueOnce(error);
    expect((await pedir({})).status).toBe(error.status);
  }
  expect(devolverCupo).toHaveBeenCalledTimes(2);
  expect(devolverCupo).toHaveBeenCalledWith(db, { userId: "user", dia: "2026-10-08", ambito: "lux" });
});

it("con timeout o conexión cortada al llamar al proveedor, contesta 502 y el cupo se queda", async () => {
  vi.mocked(abrirConversacion).mockRejectedValue(new ErrorProveedorLux(false));
  const respuesta = await pedir({});
  expect(respuesta.status).toBe(502);
  expect(devolverCupo).not.toHaveBeenCalled();
});

it("con un error HTTP del proveedor (429, 529…), contesta 502 y devuelve el cupo", async () => {
  vi.mocked(abrirConversacion).mockRejectedValue(new ErrorProveedorLux(true));
  const respuesta = await pedir({});
  expect(respuesta.status).toBe(502);
  expect(devolverCupo).toHaveBeenCalledOnce();
  expect(devolverCupo).toHaveBeenCalledWith(db, { userId: "user", dia: "2026-10-08", ambito: "lux" });
});

const fallida = (fragmentos: string[], error = new Error("se cortó")) => {
  const resultado = Promise.reject(error);
  void resultado.catch(() => {});
  return {
    ...conversacion(),
    flujo: {
      fragmentos: (async function* () { yield* fragmentos; throw error; })(),
      resultado, cancelar: vi.fn(), progreso: () => PROGRESO,
    },
  };
};

it("un corte del stream (sin texto, timeout, herramienta) no devuelve el cupo, antes o después del primer fragmento", async () => {
  for (const fragmentos of [[], ["algo"]]) {
    vi.mocked(abrirConversacion).mockResolvedValueOnce(fallida(fragmentos));
    await expect(leer(await pedir({}))).rejects.toThrow();
  }
  expect(devolverCupo).not.toHaveBeenCalled();
});

it("un corte a mitad deja lux.abrir con interrumpida y lo que se sabe, sin el texto", async () => {
  vi.mocked(abrirConversacion).mockResolvedValueOnce(fallida(["TEXTO_PARCIAL"]));
  await expect(leer(await pedir({}))).rejects.toThrow();
  expect(registrarAuditoria).toHaveBeenCalledTimes(1);
  const evento = vi.mocked(registrarAuditoria).mock.calls[0][1];
  expect(evento).toMatchObject({
    accion: "lux.abrir", entidadId: "pac-1",
    detalle: expect.objectContaining({ interrumpida: true, tokensEntrada: 7, rondas: 1, largoRespuesta: "TEXTO_PARCIAL".length }),
  });
  expect(JSON.stringify(evento)).not.toMatch(/TEXTO_PARCIAL/);
});

it("una respuesta entera no lleva interrumpida", async () => {
  await leer(await pedir({}));
  expect(vi.mocked(registrarAuditoria).mock.calls[0][1].detalle).not.toHaveProperty("interrumpida");
});

it("cancelar a mitad deja lux.pregunta con interrumpida, una sola vez", async () => {
  let soltar!: () => void;
  const esperando = new Promise<void>((resolve) => { soltar = resolve; });
  const cancelar = vi.fn(() => soltar());
  const resultado = Promise.reject(new Error("Conversación cancelada"));
  void resultado.catch(() => {});
  vi.mocked(responder).mockResolvedValueOnce({
    ...conversacion(),
    flujo: {
      fragmentos: (async function* () { yield "primera parte"; await esperando; yield "lo que ya no llega"; })(),
      resultado, cancelar, progreso: () => PROGRESO,
    },
  });
  const respuesta = await pedir({ pregunta: "¿y?" });
  const lector = respuesta.body!.getReader();
  await lector.read();
  await lector.cancel();
  await vi.waitFor(() => expect(registrarAuditoria).toHaveBeenCalledTimes(1));
  expect(cancelar).toHaveBeenCalled();
  expect(vi.mocked(registrarAuditoria).mock.calls[0][1]).toMatchObject({
    accion: "lux.pregunta", detalle: expect.objectContaining({ interrumpida: true, largoRespuesta: "primera parte".length }),
  });
  await new Promise((r) => setTimeout(r, 10));
  expect(registrarAuditoria).toHaveBeenCalledTimes(1);
  expect(devolverCupo).not.toHaveBeenCalled();
});
