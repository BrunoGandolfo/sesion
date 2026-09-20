// Unitario: la máquina de estados como entidad de dominio.
import { describe, expect, it } from "vitest";

import { limiteReclamo } from "@/app/api/_lib/casos-uso/sesion/reclamar";
import { whereTransicion } from "@/app/api/_lib/casos-uso/sesion/transicion";
import {
  backoffSesionMs,
  esHuerfana,
  ESTADO_TERMINAL,
  ESTADOS_EN_PIPELINE,
  ESTADOS_SESION,
  keyAudio,
  LISTA_OPERACIONES,
  OPERACIONES,
  prefijoAudio,
} from "@/lib/sesion-clinica/estados";

/**
 * Sanidad de la tabla: todo estado no terminal tiene al menos una salida (a
 * otro estado o borrada). Vivía en estados.ts como `estadosSinSalida()`, pero
 * no es comportamiento de la app —nadie la llamaba en producción—, sino la
 * forma de esta afirmación. Vive donde se afirma.
 */
function estadosSinSalida(): string[] {
  return ESTADOS_SESION.filter(
    (estado) =>
      estado !== ESTADO_TERMINAL &&
      !LISTA_OPERACIONES.some(
        (op) => op.desde.includes(estado) && op.hacia !== "mismo" && op.hacia !== estado,
      ),
  );
}

describe("tabla de transiciones", () => {
  it("todo estado no terminal tiene una salida", () => {
    expect(estadosSinSalida()).toEqual([]);
  });

  it("aprobada es terminal: ninguna operación la saca de ahí", () => {
    const desdeAprobada = LISTA_OPERACIONES.filter((op) => op.desde.includes("aprobada"));
    expect(ESTADO_TERMINAL).toBe("aprobada");
    expect(desdeAprobada.map((op) => op.nombre)).toEqual(["reintentar_feedback"]);
    expect(desdeAprobada.every((op) => op.hacia === "mismo")).toBe(true);
  });

  it("no existe descartar: reprocesar sale de revision sin borrar y eliminar sólo de fallida", () => {
    expect("descartar" in OPERACIONES).toBe(false);
    expect(OPERACIONES.reprocesar).toEqual({ actor: "usuaria", desde: ["revision"], hacia: "procesando" });
    expect(OPERACIONES.eliminar).toEqual({ actor: "usuaria", desde: ["fallida"], hacia: "borrada" });
  });

  it("la única entrada a procesando desde la grabación es audio_listo", () => {
    const entradas = LISTA_OPERACIONES.filter(
      (op) => op.hacia === "procesando" && op.desde.some((d) => d === "grabando" || d === "subiendo"),
    );
    expect(entradas.map((op) => op.nombre)).toEqual(["audio_listo"]);
  });

  it("Para vos se puede pedir de nuevo en revision y en aprobada", () => {
    expect(OPERACIONES.reintentar_feedback.desde).toEqual(["revision", "aprobada"]);
  });

  it("procesando está en el pipeline; revision y fallida no", () => {
    expect(ESTADOS_EN_PIPELINE.has("procesando")).toBe(true);
    expect(ESTADOS_EN_PIPELINE.has("revision")).toBe(false);
    expect(ESTADOS_EN_PIPELINE.has("fallida")).toBe(false);
  });
});

describe("whereTransicion", () => {
  it("lleva id, organización y estado de partida", () => {
    expect(whereTransicion({ operacion: "aprobar", sesionId: "s", organizationId: "o" })).toEqual({
      id: "s",
      organizationId: "o",
      estado: "revision",
    });
  });

  it("las operaciones del worker exigen el intento", () => {
    expect(() => whereTransicion({ operacion: "resultado_nota", sesionId: "s", organizationId: "o" })).toThrow(
      /intento/,
    );
    expect(
      whereTransicion({ operacion: "resultado_nota", sesionId: "s", organizationId: "o", intento: 3 }),
    ).toEqual({ id: "s", organizationId: "o", estado: "procesando", intento: 3 });
  });

  it("varios estados de partida van como IN", () => {
    expect(whereTransicion({ operacion: "abandonar", sesionId: "s", organizationId: "o" }).estado).toEqual({
      in: ["grabando", "subiendo"],
    });
  });
});

describe("límite del reclamo", () => {
  it("es 1 por defecto y nunca pasa del tope", () => {
    expect(limiteReclamo(null)).toBe(1);
    expect(limiteReclamo("")).toBe(1);
    expect(limiteReclamo("0")).toBe(1);
    expect(limiteReclamo("x")).toBe(1);
    expect(limiteReclamo("3")).toBe(3);
    expect(limiteReclamo("50")).toBe(5);
  });
});

describe("key del audio", () => {
  it("se calcula de organización, sesión e índice; nunca viene de un payload", () => {
    expect(prefijoAudio("org", "ses")).toBe("org/ses/");
    expect(keyAudio("org", "ses", 3)).toBe("org/ses/3");
    expect(keyAudio("org", "ses", 3)).toBe(keyAudio("org", "ses", 3));
  });
});

describe("huérfanas y backoff", () => {
  const ahora = new Date("2026-09-14T12:00:00Z");
  it("una subida de hace 5 horas es huérfana; una de hace 5 minutos no", () => {
    expect(esHuerfana({ estado: "subiendo", actualizadaEn: new Date("2026-09-14T07:00:00Z") }, ahora)).toBe(true);
    expect(esHuerfana({ estado: "subiendo", actualizadaEn: new Date("2026-09-14T11:55:00Z") }, ahora)).toBe(false);
    expect(esHuerfana({ estado: "fallida" }, ahora)).toBe(true);
    expect(esHuerfana({ estado: "procesando", actualizadaEn: new Date(0) }, ahora)).toBe(false);
  });

  it("el backoff crece y se estabiliza", () => {
    const esperas = [1, 2, 3, 4, 5, 6, 20].map(backoffSesionMs);
    for (let i = 1; i < esperas.length; i += 1) expect(esperas[i]).toBeGreaterThanOrEqual(esperas[i - 1]);
    expect(backoffSesionMs(1)).toBe(60_000);
  });
});
