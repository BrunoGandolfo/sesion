// @vitest-environment jsdom
//
// C5: la fila del turno de hoy en la ficha ofrece lo mismo que la fila de
// Hoy y de Agenda, la card de Ahora y el detalle del turno: la acción
// clínica sale de accionClinicaDe y la firma que falta, de firmaDelTurno
// (components/turno/presentacion.ts). Antes tenía su propio if/else: una
// nota fallida caía en un "Ver" genérico y, sin la autorización firmada,
// ofrecía Grabar igual.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  COBRAR,
  FALTA_AUTORIZACION,
  FIRMAR_AUTORIZACION,
  GRABACION_SIN_TERMINAR,
  GRABAR_SESION,
  NOTA_FALLIDA,
  REVISAR_NOTA,
  VER_NOTA,
  VER_QUE_PASO,
} from "@/lib/glosario";
import type { SesionClinicaEnsamblada } from "@/hooks/useSesionClinicaPolling";
import type { Turno } from "@/types/domain";

import { GrupoDeMes, type Hoy } from "../filas-sesion";

vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

const HACE_UNA_HORA = new Date(Date.now() - 60 * 60 * 1000);

function turno(extra: Partial<Turno> = {}): Turno {
  return {
    id: "t", organizationId: "org", pacienteId: "p", serieId: null, fecha: HACE_UNA_HORA,
    duracion: 50, modalidad: "presencial", estado: "realizado", tarifaCobrada: 2000,
    pagoEstado: "pendiente", pagoMetodo: null, pagoFecha: null, notas: null,
    creadoEn: HACE_UNA_HORA, actualizadoEn: HACE_UNA_HORA, ...extra,
  } as Turno;
}

function sesion(estado: string, actualizadaEn = new Date().toISOString()): SesionClinicaEnsamblada {
  return {
    id: "s", turnoId: "t", estado, duracionAudioSeg: null, nota: null, datosEstructurados: null,
    feedback: null, modeloASR: null, modeloLLM: null, procesadoEn: null, aprobadoEn: null,
    error: null, actualizadaEn,
  } as SesionClinicaEnsamblada;
}

function montar(t: Turno, s: SesionClinicaEnsamblada | null, extra: Partial<Hoy> = {}) {
  const hoy: Hoy = {
    turno: t, sesion: s, cargando: false, paciente: "Lucía Prueba", onCobrar: vi.fn(), ...extra,
  };
  render(
    <GrupoDeMes
      grupo={{ clave: "m", titulo: "Hoy", filas: [{ tipo: "hoy", clave: "h", fecha: t.fecha, turno: t }] }}
      abiertoPorDefecto
      hoy={hoy}
    />,
  );
  return hoy;
}

const enlace = (nombre: string | RegExp) => screen.queryByRole("link", { name: nombre });

describe("la fila del turno de hoy", () => {
  it("sin sesión ofrece grabar", () => {
    montar(turno({ estado: "programado" }), null);
    expect(enlace(new RegExp(GRABAR_SESION))?.getAttribute("href")).toBe("/grabar/t");
  });

  it("con la grabación en curso, sigue grabando", () => {
    montar(turno(), sesion("grabando"));
    expect(enlace(new RegExp(GRABAR_SESION))).not.toBeNull();
  });

  it("una grabación que quedó a medias se dice así y se retoma", () => {
    montar(turno(), sesion("grabando", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()));
    expect(screen.getByText(GRABACION_SIN_TERMINAR)).toBeTruthy();
    expect(enlace(new RegExp(GRABAR_SESION))?.getAttribute("href")).toBe("/grabar/t");
  });

  it("mientras se escribe no hay nada que tocar", () => {
    montar(turno(), sesion("procesando"));
    expect(enlace(new RegExp(GRABAR_SESION))).toBeNull();
    expect(enlace(REVISAR_NOTA)).toBeNull();
  });

  it("una nota escrita se revisa", () => {
    montar(turno(), sesion("revision"));
    expect(enlace(REVISAR_NOTA)?.getAttribute("href")).toBe("/sesiones/s");
  });

  it("aprobada y sin cobrar: Cobrar", () => {
    const hoy = montar(turno(), sesion("aprobada"));
    fireEvent.click(screen.getByRole("button", { name: COBRAR }));
    expect(hoy.onCobrar).toHaveBeenCalled();
  });

  it("aprobada y cobrada: Ver nota", () => {
    montar(turno({ pagoEstado: "pagado" }), sesion("aprobada"));
    expect(enlace(VER_NOTA)?.getAttribute("href")).toBe("/sesiones/s");
  });

  it("una nota fallida lleva a ver qué pasó, con las palabras de la fila de Hoy", () => {
    montar(turno(), sesion("fallida"));
    expect(enlace(`${NOTA_FALLIDA} · ${VER_QUE_PASO}`)?.getAttribute("href")).toBe("/sesiones/s");
  });
});

describe("la firma que falta", () => {
  it("va en lugar de Grabar", () => {
    const onAutorizar = vi.fn();
    montar(turno({ estado: "programado" }), null, { sinAutorizacion: true, onAutorizar });
    expect(enlace(new RegExp(GRABAR_SESION))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: FIRMAR_AUTORIZACION }));
    expect(onAutorizar).toHaveBeenCalled();
  });

  it("si no hay nada que grabar, se avisa al lado", () => {
    montar(turno(), sesion("revision"), { sinAutorizacion: true, onAutorizar: vi.fn() });
    expect(enlace(REVISAR_NOTA)).not.toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(FALTA_AUTORIZACION) })).toBeTruthy();
  });
});
