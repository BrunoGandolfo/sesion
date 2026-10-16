// La presentación del turno, en tablas: un estado se dice con una sola
// palabra y un solo color en Hoy, Agenda, el detalle y la ficha.
import { describe, expect, it } from "vitest";

import {
  AGENDADO,
  CANCELADO,
  GRABACION_SIN_TERMINAR,
  NO_VINO,
  NOTA_FALLIDA,
  NOTA_LISTA,
  NOTA_PROCESANDO,
  PAGADO,
  PARA_REVISAR,
  PENDIENTE,
  REALIZADO,
  VER_QUE_PASO,
} from "@/lib/glosario";
import { ESTADOS_TURNO } from "@/lib/constantes-turno";

import {
  cobrarCierraElTurno,
  empezoSinCobrar,
  estadoDelTurno,
  estadoSinPago,
  firmaDelTurno,
  ocupaElHorario,
  pagoDelTurno,
  rotuloDeNota,
  rotuloDelProceso,
  seGrabaEnEsteEstado,
  sePuedeDeshacerCobro,
} from "../presentacion";

const AHORA = new Date("2026-09-16T15:00:00.000Z");
const ANTES = new Date("2026-09-16T13:00:00.000Z");
const DESPUES = new Date("2026-09-16T18:00:00.000Z");

describe("estado del turno con su pago (fila, detalle, puntos del mes)", () => {
  it.each([
    ["programado", "pendiente", AGENDADO, "neutral", "bg-ink-500"],
    ["programado", "pagado", PAGADO, "sage", "bg-sage-500"],
    ["realizado", "pendiente", PENDIENTE, "terracotta", "bg-terracotta-500"],
    ["realizado", "pagado", PAGADO, "sage", "bg-sage-500"],
    ["ausente", "pendiente", NO_VINO, "neutral", "bg-ink-300"],
    ["ausente", "pagado", NO_VINO, "neutral", "bg-ink-300"],
    ["cancelado", "pendiente", CANCELADO, "neutral", "bg-ink-300"],
    ["cancelado", "pagado", CANCELADO, "neutral", "bg-ink-300"],
  ] as const)("%s / %s → %s", (estado, pagoEstado, label, variant, punto) => {
    expect(estadoDelTurno({ estado, pagoEstado })).toEqual({ label, variant, punto });
  });
});

describe("estado sin el pago (columna Estado de la ficha)", () => {
  it.each([
    ["programado", AGENDADO],
    ["realizado", REALIZADO],
    ["ausente", NO_VINO],
    ["cancelado", CANCELADO],
  ] as const)("%s → %s", (estado, label) => {
    expect(estadoSinPago(estado).label).toBe(label);
  });

  it("cada palabra tiene un solo color, la combine quien la combine", () => {
    const colores = new Map<string, string>();
    const anotar = ({ label, variant }: { label: string; variant: string }) => {
      expect(colores.get(label) ?? variant).toBe(variant);
      colores.set(label, variant);
    };
    for (const estado of ESTADOS_TURNO) {
      anotar(estadoSinPago(estado));
      for (const pagoEstado of ["pendiente", "pagado"] as const) {
        anotar(estadoDelTurno({ estado, pagoEstado }));
        for (const fecha of [ANTES, DESPUES]) {
          const pago = pagoDelTurno({ estado, pagoEstado, fecha }, AHORA);
          if (pago) anotar(pago);
        }
      }
    }
  });
});

describe("pago", () => {
  it.each([
    // estado, pago, fecha, columna Pago, ¿se deshace?
    ["realizado", "pagado", ANTES, PAGADO, true],
    ["ausente", "pagado", ANTES, PAGADO, true],
    ["cancelado", "pagado", ANTES, PAGADO, true],
    ["realizado", "pendiente", ANTES, PENDIENTE, false],
    ["programado", "pendiente", ANTES, PENDIENTE, false],
    ["programado", "pendiente", DESPUES, null, false],
    ["ausente", "pendiente", ANTES, null, false],
  ] as const)("%s / %s → %s", (estado, pagoEstado, fecha, columna, deshace) => {
    expect(pagoDelTurno({ estado, pagoEstado, fecha }, AHORA)?.label ?? null).toBe(columna);
    expect(sePuedeDeshacerCobro({ pagoEstado })).toBe(deshace);
  });

  it("cobrar cierra sólo un turno programado", () => {
    expect(ESTADOS_TURNO.filter(cobrarCierraElTurno)).toEqual(["programado"]);
  });

  it("empezó sin cobrar: programado, impago y con la hora ya empezada", () => {
    const t = (estado: string, pagoEstado: string, fecha: Date) => empezoSinCobrar({ estado, pagoEstado, fecha }, AHORA);
    expect(t("programado", "pendiente", ANTES)).toBe(true);
    expect(t("programado", "pendiente", DESPUES)).toBe(false);
    expect(t("programado", "pagado", ANTES)).toBe(false);
    expect(t("realizado", "pendiente", ANTES)).toBe(false);
  });
});

describe("horario y grabación", () => {
  it("ocupan el horario y se graban: programado y realizado", () => {
    expect(ESTADOS_TURNO.filter(ocupaElHorario)).toEqual(["programado", "realizado"]);
    expect(ESTADOS_TURNO.filter(seGrabaEnEsteEstado)).toEqual(["programado", "realizado"]);
  });
});

describe("la nota, con las mismas palabras en todas las pantallas", () => {
  it.each([
    ["aprobada", NOTA_LISTA, false],
    ["revision", PARA_REVISAR, false],
    ["fallida", `${NOTA_FALLIDA} · ${VER_QUE_PASO}`, true],
  ] as const)("%s → %s", (estado, rotulo, fallida) => {
    expect(rotuloDeNota({ id: "s", estado })).toEqual({ rotulo, sesionId: "s", fallida });
  });

  it("sin nota no hay rótulo", () => {
    expect(rotuloDeNota(null)).toBeNull();
    expect(rotuloDeNota({ id: "s", estado: "procesando" })).toBeNull();
  });

  it.each([
    ["subiendo", NOTA_PROCESANDO, "neutral"],
    ["procesando", NOTA_PROCESANDO, "neutral"],
    ["revision", PARA_REVISAR, "sage"],
    ["aprobada", NOTA_LISTA, "sage"],
    ["fallida", NOTA_FALLIDA, "terracotta"],
  ] as const)("chip de la ficha: %s → %s", (estado, label, variant) => {
    expect(rotuloDelProceso(estado, { sinTerminar: false })).toEqual({ label, variant });
  });

  it("una grabación que quedó a medias se dice así, no con el estado", () => {
    expect(rotuloDelProceso("grabando", { sinTerminar: true })).toEqual({
      label: GRABACION_SIN_TERMINAR,
      variant: "terracotta",
    });
  });
});

describe("la firma que falta", () => {
  it.each([
    [{ tipo: "grabar", retomar: false }, true, "en-lugar-de-grabar"],
    [{ tipo: "grabar", retomar: true }, true, "en-lugar-de-grabar"],
    [{ tipo: "escribiendo" }, true, "aviso"],
    [{ tipo: "ninguna" }, true, "aviso"],
    [{ tipo: "grabar", retomar: false }, false, null],
    [{ tipo: "ninguna" }, false, null],
  ] as const)("%o, sin firma=%s → %s", (clinica, sinAutorizacion, firma) => {
    expect(firmaDelTurno(clinica, sinAutorizacion)).toBe(firma);
  });
});
