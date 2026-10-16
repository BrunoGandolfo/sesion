// El catálogo de errores de la grabación: qué causa lleva a qué texto, y que
// ningún texto del navegador (en inglés, técnico) llegue a la pantalla.
//
// Los mensajes del micrófono son lo único que ve alguien parada frente a una
// paciente con el micrófono que no arranca: "no diste permiso" y "cerrá otras
// apps" mandan a lugares distintos.

import { describe, expect, it } from "vitest";

import * as glosario from "@/lib/glosario";

import { causaDelErrorDeMicrofono, MENSAJE_ERROR_GRABADOR } from "../errores-grabacion";

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
