// La sesión del turno, vista desde la grabación: la regla de si todavía
// admite audio y el pedido que la lee, cada uno en un solo lugar
// (src/lib/grabacion-sesion.ts). Antes la regla estaba escrita tres veces y
// el GET cuatro, cada copia con su propio cast.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { estadoSesionSchema } from "@/lib/sesion-clinica/schema";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
}));

import { admiteAudio, leerSesionDelTurno } from "@/lib/grabacion-sesion";

afterEach(() => vi.clearAllMocks());

describe("admiteAudio", () => {
  it.each(estadoSesionSchema.options)("%s", (estado) => {
    // Sólo una grabación a medias admite (más) audio: la que todavía se
    // graba o la que quedó subiendo. Una ya subida, procesada o cerrada, no.
    expect(admiteAudio(estado)).toBe(estado === "grabando" || estado === "subiendo");
  });
});

describe("leerSesionDelTurno", () => {
  it("pide la sesión del turno y devuelve lo que contesta la API", async () => {
    m.get.mockResolvedValueOnce({ id: "s1", estado: "grabando" });
    await expect(leerSesionDelTurno("t1")).resolves.toEqual({ id: "s1", estado: "grabando" });
    expect(m.get).toHaveBeenCalledWith("/api/sesion-clinica?turnoId=t1");
  });

  it("sin sesión todavía devuelve null", async () => {
    m.get.mockResolvedValueOnce(null);
    await expect(leerSesionDelTurno("t1")).resolves.toBeNull();
  });
});

describe("una sola vez cada uno", () => {
  const RAIZ = process.cwd();
  const TERRITORIO = ["src/app/(dashboard)/grabar", "src/components/grabacion", "src/hooks"];

  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) return nombre === "__tests__" ? [] : archivos(ruta);
      return /\.tsx?$/.test(nombre) ? [ruta] : [];
    });
  }
  const fuentes = TERRITORIO.flatMap((d) => archivos(join(RAIZ, d))).map((ruta) => ({ ruta, texto: readFileSync(ruta, "utf8") }));

  it("nadie de la grabación pide la sesión del turno por su cuenta", () => {
    expect(fuentes.filter((f) => f.texto.includes("/api/sesion-clinica?turnoId=")).map((f) => f.ruta)).toEqual([]);
  });

  it("nadie de la grabación reescribe la regla de si admite audio", () => {
    expect(fuentes.filter((f) => f.texto.includes("ESTADOS_SIN_TERMINAR")).map((f) => f.ruta)).toEqual([]);
  });
});
