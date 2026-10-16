// El catálogo de errores de la grabación: qué causa lleva a qué texto, y que
// ningún texto del navegador (en inglés, técnico) llegue a la pantalla.
//
// Los mensajes del micrófono son lo único que ve alguien parada frente a una
// paciente con el micrófono que no arranca: "no diste permiso" y "cerrá otras
// apps" mandan a lugares distintos.

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import * as glosario from "@/lib/glosario";
import { ErrorSubida } from "@/lib/subida-audio";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
}));

import {
  causaDelErrorDeMicrofono,
  desenlaceDelFallo,
  esRechazoDefinitivo,
  esRechazoDelServidor,
  esSinConexion,
  MENSAJE_ERROR_GRABADOR,
  mensajeParaReintentar,
} from "../errores-grabacion";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("causaDelErrorDeMicrofono", () => {
  it.each([
    ["NotAllowedError", "sin-permiso"],
    ["PermissionDeniedError", "sin-permiso"],
    ["NotFoundError", "sin-microfono"],
    ["DevicesNotFoundError", "sin-microfono"],
    ["NotReadableError", "microfono-ocupado"],
    ["TrackStartError", "microfono-ocupado"],
    ["SecurityError", "bloqueada"],
    ["AbortError", "no-inicio"],
  ] as const)("%s → %s", (nombre, causa) => {
    // Los pares son el mismo caso con el nombre viejo y el nuevo según el
    // navegador: los dos tienen que dar la MISMA causa.
    expect(causaDelErrorDeMicrofono(new DOMException("x", nombre))).toBe(causa);
  });

  it("un Error común del navegador no pasa su mensaje: cae en el genérico", () => {
    expect(causaDelErrorDeMicrofono(new TypeError("Failed to execute 'getUserMedia' on 'MediaDevices'"))).toBe("no-inicio");
    expect(causaDelErrorDeMicrofono(new Error(""))).toBe("no-inicio");
  });

  it("cualquier otra cosa cae en el genérico", () => {
    expect(causaDelErrorDeMicrofono(null)).toBe("no-inicio");
    expect(causaDelErrorDeMicrofono("un string suelto")).toBe("no-inicio");
    expect(causaDelErrorDeMicrofono(undefined)).toBe("no-inicio");
  });
});

describe("MENSAJE_ERROR_GRABADOR", () => {
  it("cada texto sale del glosario", () => {
    const delGlosario = new Set(Object.values(glosario).filter((v) => typeof v === "string"));
    for (const texto of Object.values(MENSAJE_ERROR_GRABADOR)) expect(delGlosario.has(texto)).toBe(true);
  });

  it("dice lo que hay que hacer en cada caso", () => {
    expect(MENSAJE_ERROR_GRABADOR["sin-permiso"]).toContain("No diste permiso");
    expect(MENSAJE_ERROR_GRABADOR["sin-microfono"]).toContain("No encontramos un micrófono");
    expect(MENSAJE_ERROR_GRABADOR["microfono-ocupado"]).toContain("Cerrá otras apps");
    expect(MENSAJE_ERROR_GRABADOR.bloqueada).toContain("bloqueó la grabación");
    expect(MENSAJE_ERROR_GRABADOR.vacia).toBe("No se pudo capturar audio de la sesión.");
  });
});

describe("cómo se lee un error al subir", () => {
  const casos: [string, unknown, { sinRed: boolean; servidor: boolean; definitivo: boolean }][] = [
    ["fetch sin red (TypeError)", new TypeError("Failed to fetch"), { sinRed: true, servidor: false, definitivo: false }],
    ["el PUT a R2 sin red", new ErrorSubida("Fallo de red", "put"), { sinRed: true, servidor: false, definitivo: false }],
    ["un 403 de R2 (URL vencida)", new ErrorSubida("R2 rechazó", "put", 403), { sinRed: false, servidor: false, definitivo: false }],
    ["un 409 al pedir la URL", new ErrorSubida("Ya se cerró", "url", 409), { sinRed: false, servidor: true, definitivo: false }],
    ["un 422 al confirmar", new ErrorSubida("Muy corta", "confirmar", 422), { sinRed: false, servidor: true, definitivo: false }],
    ["un 500 al confirmar", new ErrorSubida("Error interno", "confirmar", 500), { sinRed: false, servidor: false, definitivo: false }],
    ["un 403 al crear la sesión", new ApiClientError("Sin autorización", 403), { sinRed: false, servidor: false, definitivo: true }],
    ["un 409 al crear el turno", new ApiClientError("Otro estado", 409), { sinRed: false, servidor: false, definitivo: true }],
    ["un 500 al crear la sesión", new ApiClientError("Error interno", 500), { sinRed: false, servidor: false, definitivo: false }],
    ["un abort", new DOMException("x", "AbortError"), { sinRed: false, servidor: false, definitivo: false }],
  ];

  it.each(casos)("%s", (_caso, error, esperado) => {
    expect(esSinConexion(error)).toBe(esperado.sinRed);
    expect(esRechazoDelServidor(error)).toBe(esperado.servidor);
    expect(esRechazoDefinitivo(error)).toBe(esperado.definitivo);
  });

  it("el teléfono sin red manda, sea cual sea el error", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(esSinConexion(new ApiClientError("Error interno", 500))).toBe(true);
  });
});

describe("mensajeParaReintentar", () => {
  it.each([
    ["sin red, con copia", new TypeError("Failed to fetch"), true, glosario.GRABACION_SIN_CONEXION],
    ["sin red, sin copia", new TypeError("Failed to fetch"), false, glosario.GRABACION_SIN_CONEXION_SIN_COPIA],
    ["R2, con copia", new ErrorSubida("R2 rechazó", "put", 403), true, glosario.AUDIO_NO_GUARDADO],
    ["R2, sin copia", new ErrorSubida("R2 rechazó", "put", 403), false, glosario.AUDIO_NO_GUARDADO_SIN_COPIA],
    ["la API, con copia", new ApiClientError("Error interno", 500), true, "Error interno"],
    ["la API, sin copia", new ApiClientError("Error interno", 500), false, `Error interno ${glosario.COPIA_NO_GUARDADA}`],
  ] as const)("%s", (_caso, error, copia, esperado) => {
    expect(mensajeParaReintentar(error, copia)).toBe(esperado);
  });
});

describe("desenlaceDelFallo", () => {
  const CON_COPIA = { turno: "t1", sesionId: "s1", copiaEnTelefono: true };

  it("sin red: se reintenta, y la sesión vuelve a grabando si llegó a existir", async () => {
    await expect(desenlaceDelFallo(new TypeError("Failed to fetch"), CON_COPIA)).resolves.toEqual({
      fase: "no-guardado", mensaje: glosario.GRABACION_SIN_CONEXION, volverAGrabando: true,
    });
    await expect(desenlaceDelFallo(new TypeError("Failed to fetch"), { ...CON_COPIA, sesionId: null })).resolves.toMatchObject({ volverAGrabando: false });
    expect(m.get).not.toHaveBeenCalled();
  });

  it("el servidor rechazó crear la sesión: se dice lo que contestó, sin reintento", async () => {
    const error = new ApiClientError("Sin autorización", 403);
    await expect(desenlaceDelFallo(error, { ...CON_COPIA, sesionId: null })).resolves.toEqual({
      fase: "rechazada", mensaje: "Sin autorización", volverAGrabando: false,
    });
  });

  it.each([
    ["la sesión ya no admite audio", { id: "s1", estado: "fallida" }, "rechazada"],
    ["la sesión desapareció", null, "rechazada"],
    ["la sesión sigue en grabando", { id: "s1", estado: "grabando" }, "no-guardado"],
  ] as const)("un 409 del servidor cuando %s", async (_caso, sesion, fase) => {
    m.get.mockResolvedValueOnce(sesion);
    const desenlace = await desenlaceDelFallo(new ErrorSubida("Ya se cerró", "url", 409), CON_COPIA);
    expect(desenlace.fase).toBe(fase);
    expect(m.get).toHaveBeenCalledWith("/api/sesion-clinica?turnoId=t1");
  });

  it("si no se puede leer la sesión después de un 409, se reintenta", async () => {
    m.get.mockRejectedValueOnce(new Error("sin red"));
    await expect(desenlaceDelFallo(new ErrorSubida("No llegó", "confirmar", 409), CON_COPIA)).resolves.toEqual({
      fase: "no-guardado", mensaje: glosario.AUDIO_NO_GUARDADO, volverAGrabando: true,
    });
  });
});
