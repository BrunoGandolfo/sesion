// La decisión de editar un turno y la tabla de transiciones, sin base.
//
// actualizarTurno (casos-uso/turnos.ts) toma el lock, relee y aplica lo que
// decide decidirEdicionTurno; la tabla TRANSICIONES_TURNO es la que usan
// también cobrar y cancelar la serie. Los tests de integración
// (solapamiento-turnos, crear-serie-turno, cobrar-turno) prueban el caso de
// uso contra la base; acá, la regla.
import { describe, expect, it } from "vitest";

import {
  decidirEdicionTurno,
  puedeTransicionTurno,
  sePuedeCobrar,
  TRANSICIONES_TURNO,
} from "@/app/api/_lib/domain";
import { ESTADOS_TURNO, type EstadoTurno } from "@/lib/constantes-turno";
import { MENSAJE_NO_REABRIR, MENSAJE_SOLO_PROGRAMADOS, MENSAJE_TURNO_PAGADO } from "@/lib/glosario";

const DIEZ = new Date("2026-10-05T13:00:00.000Z");
const ONCE = new Date("2026-10-05T14:00:00.000Z");

const turno = (estado: EstadoTurno, fecha = DIEZ, duracion = 50, pagoEstado = "pendiente") => ({ estado, fecha, duracion, pagoEstado });

describe("TRANSICIONES_TURNO", () => {
  it("solo un programado se edita, se cierra al cobrar y entra al cancelar la serie", () => {
    for (const op of ["editarDatos", "cobrarCierra", "cancelarSerie"] as const) {
      expect(ESTADOS_TURNO.filter((e) => puedeTransicionTurno(op, e)), op).toEqual(["programado"]);
    }
  });

  it("el estado se cambia desde cualquiera menos cancelado", () => {
    expect(ESTADOS_TURNO.filter((e) => !puedeTransicionTurno("cambiarEstado", e))).toEqual(["cancelado"]);
  });

  it("cobrar cierra como realizado y cancelar la serie deja cancelado", () => {
    expect(TRANSICIONES_TURNO.cobrarCierra.hacia).toBe("realizado");
    expect(TRANSICIONES_TURNO.cancelarSerie.hacia).toBe("cancelado");
  });

  it("sePuedeCobrar sigue la tabla: realizado sí; programado solo con la hora llegada", () => {
    const pendiente = (estado: EstadoTurno) => ({ estado, pagoEstado: "pendiente", fecha: DIEZ });
    expect(sePuedeCobrar(pendiente("realizado"), DIEZ)).toBe(true);
    expect(sePuedeCobrar(pendiente("programado"), ONCE)).toBe(true);
    expect(sePuedeCobrar(pendiente("programado"), new Date(DIEZ.getTime() - 1))).toBe(false);
    expect(sePuedeCobrar(pendiente("ausente"), ONCE)).toBe(false);
    expect(sePuedeCobrar(pendiente("cancelado"), ONCE)).toBe(false);
    expect(sePuedeCobrar({ ...pendiente("realizado"), pagoEstado: "pagado" }, ONCE)).toBe(false);
  });
});

describe("decidirEdicionTurno", () => {
  it("un cancelado no se reabre, ni siquiera a cancelado", () => {
    for (const estado of ESTADOS_TURNO) {
      expect(decidirEdicionTurno(turno("cancelado"), { estado })).toEqual({ tipo: "rechazo", mensaje: MENSAJE_NO_REABRIR });
    }
  });

  it("fecha, duración, modalidad o notas solo en un programado", () => {
    for (const estado of ["realizado", "ausente", "cancelado"] as const) {
      for (const cambios of [{ fecha: ONCE }, { duracion: 60 as const }, { modalidad: "online" as const }, { notas: "x" }, { notas: null }]) {
        expect(decidirEdicionTurno(turno(estado), cambios)).toEqual({ tipo: "rechazo", mensaje: MENSAJE_SOLO_PROGRAMADOS });
      }
    }
  });

  it("el rechazo por reabrir va antes que el de datos", () => {
    expect(decidirEdicionTurno(turno("cancelado"), { estado: "programado", notas: "x" })).toEqual({
      tipo: "rechazo",
      mensaje: MENSAJE_NO_REABRIR,
    });
  });

  it("un turno pagado no cambia de estado: primero se deshace el cobro", () => {
    for (const desde of ["programado", "realizado", "ausente"] as const) {
      for (const hacia of ESTADOS_TURNO.filter((e) => e !== desde)) {
        expect(decidirEdicionTurno(turno(desde, DIEZ, 50, "pagado"), { estado: hacia }), `${desde}→${hacia}`).toEqual({
          tipo: "rechazo",
          mensaje: MENSAJE_TURNO_PAGADO,
        });
      }
    }
  });

  it("un pagado acepta el mismo estado que ya tiene (marcar realizado otra vez no rompe)", () => {
    expect(decidirEdicionTurno(turno("realizado", DIEZ, 50, "pagado"), { estado: "realizado" })).toMatchObject({ tipo: "aplicar" });
  });

  it("sin cobrar, el estado se sigue cambiando como antes", () => {
    expect(decidirEdicionTurno(turno("realizado"), { estado: "cancelado" })).toMatchObject({ tipo: "aplicar" });
  });

  it("un body vacío no escribe nada", () => {
    for (const estado of ESTADOS_TURNO) expect(decidirEdicionTurno(turno(estado), {})).toEqual({ tipo: "sinCambios" });
  });

  it("mover un programado verifica el intervalo NUEVO", () => {
    expect(decidirEdicionTurno(turno("programado"), { fecha: ONCE, duracion: 90 })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: { inicio: ONCE, duracionMin: 90 },
    });
  });

  it("solo la duración verifica con la fecha que ya tenía", () => {
    expect(decidirEdicionTurno(turno("programado"), { duracion: 90 })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: { inicio: DIEZ, duracionMin: 90 },
    });
  });

  it("mandar la misma fecha no verifica", () => {
    expect(decidirEdicionTurno(turno("programado"), { fecha: new Date(DIEZ) })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: null,
    });
  });

  it("notas o modalidad de un turno ya solapado no revalidan la agenda", () => {
    expect(decidirEdicionTurno(turno("programado"), { notas: "x", modalidad: "online" })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: null,
    });
  });

  it("ausente → programado pasa a ocupar: verifica su intervalo", () => {
    expect(decidirEdicionTurno(turno("ausente"), { estado: "programado" })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: { inicio: DIEZ, duracionMin: 50 },
    });
  });

  it("realizado → programado ya ocupaba: no verifica", () => {
    expect(decidirEdicionTurno(turno("realizado"), { estado: "programado" })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: null,
    });
  });

  it("cerrar un programado (realizado, ausente o cancelado) no verifica", () => {
    for (const estado of ["realizado", "ausente", "cancelado"] as const) {
      expect(decidirEdicionTurno(turno("programado"), { estado })).toEqual({
        tipo: "aplicar",
        verificarSolapamiento: null,
      });
    }
  });
});
