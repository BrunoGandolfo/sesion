// Unitario: la máquina de estados como entidad de dominio.
import { describe, expect, it } from "vitest";

import { LIMITE_SEGUNDOS } from "@/lib/grabacion-captura";

import { limiteReclamo } from "@/app/api/_lib/casos-uso/sesion/reclamar";
import { whereTransicion } from "@/app/api/_lib/casos-uso/sesion/transicion";
import {
  backoffSesionMs,
  esHuerfana,
  esGrabacionSinTerminar,
  UMBRAL_GRABANDO_SIN_TERMINAR_MS,
  UMBRAL_HUERFANA_HORAS,
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
      estado !== "aprobada" &&
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
  it("una subida de hace más de 7 días es huérfana; una de 6 días o de 5 horas no (el teléfono todavía puede subirla)", () => {
    expect(UMBRAL_HUERFANA_HORAS).toBe(168);
    expect(esHuerfana({ estado: "subiendo", actualizadaEn: new Date("2026-09-07T11:59:00Z") }, ahora)).toBe(true);
    expect(esHuerfana({ estado: "grabando", actualizadaEn: new Date("2026-09-08T12:00:00Z") }, ahora)).toBe(false);
    expect(esHuerfana({ estado: "subiendo", actualizadaEn: new Date("2026-09-14T07:00:00Z") }, ahora)).toBe(false);
    expect(esHuerfana({ estado: "fallida" }, ahora)).toBe(true);
    expect(esHuerfana({ estado: "procesando", actualizadaEn: new Date(0) }, ahora)).toBe(false);
  });

  it("grabación sin terminar: subiendo con más de 30 min quieta; 29 min todavía no", () => {
    const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);
    expect(esGrabacionSinTerminar({ estado: "subiendo", actualizadaEn: hace(31).toISOString() }, ahora)).toBe(true);
    expect(esGrabacionSinTerminar({ estado: "subiendo", actualizadaEn: hace(29) }, ahora)).toBe(false);
    expect(esGrabacionSinTerminar({ estado: "procesando", actualizadaEn: hace(600) }, ahora)).toBe(false);
    expect(esGrabacionSinTerminar({ estado: "grabando" }, ahora)).toBe(false);
    expect(esGrabacionSinTerminar(null, ahora)).toBe(false);
  });

  it("grabando: mientras se graba nada llega al servidor, así que espera el tope de grabación más 30 min", () => {
    const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);
    expect(UMBRAL_GRABANDO_SIN_TERMINAR_MS).toBe(LIMITE_SEGUNDOS * 1000 + 30 * 60_000);
    // Una sesión de 50 min en curso: quieta desde el minuto cero.
    expect(esGrabacionSinTerminar({ estado: "grabando", actualizadaEn: hace(31) }, ahora)).toBe(false);
    expect(esGrabacionSinTerminar({ estado: "grabando", actualizadaEn: hace(179) }, ahora)).toBe(false);
    expect(esGrabacionSinTerminar({ estado: "grabando", actualizadaEn: hace(181) }, ahora)).toBe(true);
  });

  it("el backoff crece y se estabiliza", () => {
    const esperas = [1, 2, 3, 4, 5, 6, 20].map(backoffSesionMs);
    for (let i = 1; i < esperas.length; i += 1) expect(esperas[i]).toBeGreaterThanOrEqual(esperas[i - 1]);
    expect(backoffSesionMs(1)).toBe(60_000);
  });
});

describe("el sondeo de la UI usa los estados de la tabla", () => {
  it("ESTADOS_ACTIVOS es ESTADOS_EN_PIPELINE, y es el conjunto que estaba escrito a mano", async () => {
    const { ESTADOS_ACTIVOS } = await import("@/hooks/useSesionClinicaPolling");
    expect(ESTADOS_ACTIVOS).toBe(ESTADOS_EN_PIPELINE);
    expect([...ESTADOS_EN_PIPELINE].sort()).toEqual(["grabando", "procesando", "subiendo"]);
  });
});
