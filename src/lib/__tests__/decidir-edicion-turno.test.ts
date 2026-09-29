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
  efectoEnvioDeEdicion,
  puedeTransicionTurno,
  sePuedeCobrar,
  TRANSICIONES_TURNO,
} from "@/app/api/_lib/domain";
import { ESTADOS_TURNO, type EstadoTurno } from "@/lib/constantes-turno";
import { MENSAJE_NO_REABRIR, MENSAJE_SOLO_PROGRAMADOS } from "@/lib/glosario";

const DIEZ = new Date("2026-10-05T13:00:00.000Z");
const ONCE = new Date("2026-10-05T14:00:00.000Z");

const turno = (estado: EstadoTurno, fecha = DIEZ, duracion = 50) => ({ estado, fecha, duracion });

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

  it("un body vacío no escribe nada", () => {
    for (const estado of ESTADOS_TURNO) expect(decidirEdicionTurno(turno(estado), {})).toEqual({ tipo: "sinCambios" });
  });

  it("mover un programado verifica el intervalo NUEVO y reprograma el aviso", () => {
    expect(decidirEdicionTurno(turno("programado"), { fecha: ONCE, duracion: 90 })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: { inicio: ONCE, duracionMin: 90 },
      efectoEnvio: "reprogramar",
    });
  });

  it("solo la duración verifica con la fecha que ya tenía; el aviso no cambia", () => {
    expect(decidirEdicionTurno(turno("programado"), { duracion: 90 })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: { inicio: DIEZ, duracionMin: 90 },
      efectoEnvio: null,
    });
  });

  it("mandar la misma fecha no verifica ni reprograma", () => {
    expect(decidirEdicionTurno(turno("programado"), { fecha: new Date(DIEZ) })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: null,
      efectoEnvio: null,
    });
  });

  it("notas o modalidad de un turno ya solapado no revalidan la agenda", () => {
    expect(decidirEdicionTurno(turno("programado"), { notas: "x", modalidad: "online" })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: null,
      efectoEnvio: null,
    });
  });

  it("ausente → programado pasa a ocupar: verifica su intervalo y revive el aviso", () => {
    expect(decidirEdicionTurno(turno("ausente"), { estado: "programado" })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: { inicio: DIEZ, duracionMin: 50 },
      efectoEnvio: "revivir",
    });
  });

  it("realizado → programado ya ocupaba: no verifica, pero revive el aviso", () => {
    expect(decidirEdicionTurno(turno("realizado"), { estado: "programado" })).toEqual({
      tipo: "aplicar",
      verificarSolapamiento: null,
      efectoEnvio: "revivir",
    });
  });

  it("cerrar un programado (realizado, ausente o cancelado) apaga el aviso y no verifica", () => {
    for (const estado of ["realizado", "ausente", "cancelado"] as const) {
      expect(decidirEdicionTurno(turno("programado"), { estado })).toEqual({
        tipo: "aplicar",
        verificarSolapamiento: null,
        efectoEnvio: "cancelar",
      });
    }
  });
});

describe("efectoEnvioDeEdicion (con la fila ya escrita)", () => {
  it("si la fila escrita quedó cerrada, cancela aunque se haya pedido mover", () => {
    // La carrera con cobrar: se decidió con un programado y se escribió un
    // turno que cobrar cerró en el medio.
    expect(efectoEnvioDeEdicion(turno("programado"), turno("realizado", ONCE), true)).toBe("cancelar");
  });

  it("reprogramar gana sobre revivir cuando cambian las dos cosas", () => {
    expect(efectoEnvioDeEdicion(turno("ausente"), turno("programado", ONCE), true)).toBe("reprogramar");
  });
});
