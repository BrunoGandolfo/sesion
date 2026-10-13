// @vitest-environment jsdom
// La pantalla que se ve cuando la app se abre sin señal. Debe quedar cierto que:
//   - en /grabar/<turnoId> con el turno en la agenda local, monta el
//     grabador de siempre con ese turno (nombre y hora), dejando grabar;
//   - un turno de mañana se muestra pero no se graba (mismo día);
//   - en cualquier otra ruta, o con un turno que no está guardado, muestra
//     los turnos de hoy con su botón Grabar y el aviso de que no hay señal.
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnoLocal } from "@/lib/agenda-local";
import {
  SIN_CONEXION_AVISO,
  SIN_CONEXION_FRANJA,
  SIN_CONEXION_SIN_TURNOS,
  SIN_CONEXION_TURNO_NO_GUARDADO,
  SIN_CONEXION_TURNO_OTRO_DIA,
} from "@/lib/glosario";
import { instanteMvd } from "@/lib/fechas-montevideo";

const agenda = vi.hoisted(() => ({ turnos: [] as TurnoLocal[] }));
const grabador = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("@/lib/agenda-local", async (original) => {
  const real = await original<typeof import("@/lib/agenda-local")>();
  return {
    ...real,
    buscarTurnoLocal: async (id: string) => agenda.turnos.find((t) => t.turnoId === id) ?? null,
    turnosLocalesDeHoy: async () => agenda.turnos.filter((t) => t.fecha === "2026-10-13"),
  };
});

vi.mock("@/app/(dashboard)/grabar/[turnoId]/_components/grabar-view", () => ({
  GrabarView: (props: Record<string, unknown>) => {
    grabador.props = props;
    return <h1>{String(props.pacienteNombre)}</h1>;
  },
}));

import { SinConexion, turnoDeLaRuta } from "../sin-conexion";

const AHORA = instanteMvd(2026, 9, 13, 10, 0);
const reloj = () => AHORA;

const ANA: TurnoLocal = { turnoId: "t1", pacienteId: "p1", nombreParaMostrar: "Ana Pérez", fecha: "2026-10-13", hora: "15:00" };
const BETO: TurnoLocal = { turnoId: "t2", pacienteId: "p2", nombreParaMostrar: "Beto Gómez", fecha: "2026-10-13", hora: "09:30" };
const MANANA: TurnoLocal = { turnoId: "t3", pacienteId: "p3", nombreParaMostrar: "Carla Ruiz", fecha: "2026-10-14", hora: "11:00" };

function abrir(ruta: string) {
  window.history.replaceState({}, "", ruta);
  return render(<SinConexion reloj={reloj} />);
}

beforeEach(() => {
  agenda.turnos = [BETO, ANA, MANANA];
  grabador.props = null;
});
afterEach(cleanup);

describe("turnoDeLaRuta", () => {
  it("reconoce /grabar/<turno> y nada más", () => {
    expect(turnoDeLaRuta("/grabar/t1")).toBe("t1");
    expect(turnoDeLaRuta("/grabar/t1/")).toBe("t1");
    expect(turnoDeLaRuta("/grabar/nuevo")).toBeNull();
    expect(turnoDeLaRuta("/grabar")).toBeNull();
    expect(turnoDeLaRuta("/pacientes/t1")).toBeNull();
    expect(turnoDeLaRuta("/")).toBeNull();
  });
});

describe("/grabar/<turno> sin señal", () => {
  it("monta el grabador con el turno guardado, dejando grabar", async () => {
    abrir("/grabar/t1");
    expect(await screen.findByRole("heading", { name: "Ana Pérez" })).toBeTruthy();
    expect(grabador.props).toMatchObject({
      turnoId: "t1",
      pacienteId: "p1",
      pacienteNombre: "Ana Pérez",
      horaTexto: "15:00",
      motivoSinGrabar: null,
      autorizacionVigente: true,
      prueba: null,
    });
    expect(screen.getByRole("status").textContent).toBe(SIN_CONEXION_FRANJA);
  });

  it("un turno de mañana no se graba hoy", async () => {
    abrir("/grabar/t3");
    await screen.findByRole("heading", { name: "Carla Ruiz" });
    expect(grabador.props?.motivoSinGrabar).toBe(SIN_CONEXION_TURNO_OTRO_DIA);
  });

  it("un turno que no está guardado lleva a la agenda y lo dice", async () => {
    abrir("/grabar/desconocido");
    expect(await screen.findByText(SIN_CONEXION_TURNO_NO_GUARDADO)).toBeTruthy();
    expect(grabador.props).toBeNull();
    expect(screen.getAllByRole("link", { name: "Grabar" })).toHaveLength(2);
  });
});

describe("cualquier otra ruta sin señal", () => {
  it("muestra los turnos de hoy, por hora, cada uno con Grabar", async () => {
    abrir("/");
    const enlaces = await screen.findAllByRole("link", { name: "Grabar" });
    expect(enlaces.map((a) => a.getAttribute("href"))).toEqual(["/grabar/t2", "/grabar/t1"]);
    expect(screen.getByText("Beto Gómez")).toBeTruthy();
    expect(screen.queryByText("Carla Ruiz")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(SIN_CONEXION_AVISO);
    expect(screen.queryByText(SIN_CONEXION_TURNO_NO_GUARDADO)).toBeNull();
  });

  it("sin turnos guardados lo dice", async () => {
    agenda.turnos = [];
    abrir("/pacientes/p1");
    expect(await screen.findByText(SIN_CONEXION_SIN_TURNOS)).toBeTruthy();
  });
});
