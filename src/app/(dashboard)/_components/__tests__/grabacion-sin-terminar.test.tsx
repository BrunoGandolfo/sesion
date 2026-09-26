// @vitest-environment jsdom
//
// La grabación sin terminar, en pantalla. Una sesión que quedó a medias en
// "grabando" o "subiendo" se veía "Procesando" para siempre y no tenía
// salida. Ahora se nombra —en la fila, en Hoy y en Pendientes— y Pendientes
// ofrece subirla desde el teléfono o descartarla, con confirmación.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

import { SessionRow } from "@/components/ui/session-row";
import { apiPost } from "@/lib/api-client";
import type { GrabacionSinTerminar, PendientesTerapeuta, TurnoConPaciente } from "@/types/domain";

import { accionDe } from "../card-ahora";
import { sesionesEnProceso } from "../datos";
import { Pendientes } from "../pendientes";

vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiPost: vi.fn(),
}));

beforeAll(() => {
  // Confirmar consulta la preferencia de movimiento reducido.
  vi.stubGlobal("matchMedia", () => ({
    matches: true, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  }));
});

afterEach(() => vi.mocked(apiPost).mockReset());

const AHORA = new Date("2026-09-25T15:00:00.000Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

const TURNO: TurnoConPaciente = {
  sesionClinica: null, id: "t1", organizationId: "org", pacienteId: "p1", serieId: null,
  fecha: new Date("2026-09-25T13:00:00.000Z"), duracion: 50, modalidad: "presencial",
  estado: "realizado", pagoEstado: "pagado", pagoMetodo: "efectivo", pagoFecha: null,
  tarifaCobrada: 2200, notas: null,
  creadoEn: new Date("2026-09-01T10:00:00.000Z"), actualizadoEn: new Date("2026-09-01T10:00:00.000Z"),
  paciente: { id: "p1", nombre: "Ana", apellido: "López", telefono: "099111222" },
};

const vacios: PendientesTerapeuta = {
  notasParaRevisar: [],
  sinCobrar: [],
  sinAutorizacion: [],
  totalSinCobrar: { pacientes: 0, sesiones: 0, monto: 0 },
};

const GRABACION: GrabacionSinTerminar = {
  sesionId: "s1",
  turnoId: "t1",
  pacienteId: "p1",
  pacienteNombre: "Ana López",
  fecha: "2026-09-24T15:00:00.000Z",
};

it.each([
  ["subiendo", 31],
  ["grabando", 181],
])("una sesión %s quieta %i min dice 'Grabación sin terminar', no 'Procesando', y lleva a grabar", (estado, minutos) => {
  render(<SessionRow turno={{ ...TURNO, sesionClinica: { id: "s1", estado, actualizadaEn: hace(minutos) } }} ahora={AHORA} />);

  const enlace = screen.getByRole("link", { name: "Grabación sin terminar" });
  expect(enlace.getAttribute("href")).toBe("/grabar/t1");
  expect(screen.queryByText("Procesando")).toBeNull();
});

it.each([
  ["subiendo", 29],
  // Una sesión de 50 min en curso: el servidor no se entera hasta el final.
  ["grabando", 31],
])("una sesión %s quieta %i min todavía no se marca: puede estar en curso", (estado, minutos) => {
  render(<SessionRow turno={{ ...TURNO, sesionClinica: { id: "s1", estado, actualizadaEn: hace(minutos) } }} ahora={AHORA} />);
  expect(screen.queryByText("Grabación sin terminar")).toBeNull();
});

it("Hoy no muestra 'Procesando' para una subida quieta más de 30 min; sí para una reciente", () => {
  const turnos = [
    { ...TURNO, id: "t1", sesionClinica: { id: "s1", estado: "subiendo", actualizadaEn: hace(45) } },
    { ...TURNO, id: "t2", sesionClinica: { id: "s2", estado: "subiendo", actualizadaEn: hace(5) } },
    { ...TURNO, id: "t3", sesionClinica: { id: "s3", estado: "procesando", actualizadaEn: hace(45) } },
  ];
  expect(sesionesEnProceso(turnos, AHORA).map((s) => s.sesionId)).toEqual(["s2", "s3"]);
});

it("la card de Ahora no dice 'escribiendo' de una subida quieta: ofrece grabar, que retoma la copia", () => {
  const turno = { ...TURNO, fecha: new Date("2026-09-25T14:00:00.000Z"), pagoEstado: "pendiente" as const };
  expect(accionDe({ id: "s1", estado: "subiendo", actualizadaEn: hace(5) }, turno, AHORA, false, false)).toEqual({ tipo: "escribiendo" });
  expect(accionDe({ id: "s1", estado: "subiendo", actualizadaEn: hace(45) }, turno, AHORA, false, false)).toMatchObject({
    tipo: "turno",
    grabar: "grabar",
  });
});

it("Pendientes la muestra con el nombre de la paciente y 'Subir desde este teléfono' lleva a grabar", () => {
  render(<Pendientes pendientes={{ ...vacios, grabacionesSinTerminar: [GRABACION] }} />);

  expect(screen.getByText("1 grabación sin terminar")).toBeTruthy();
  expect(screen.getByText("Ana López")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Subir desde este teléfono/ }).getAttribute("href")).toBe("/grabar/t1");
});

it("'Descartar' pide confirmación antes de tocar nada, y al confirmar llama a la ruta y avisa", async () => {
  vi.mocked(apiPost).mockResolvedValue({ resultado: "borrada", conAudio: false });
  const onCambio = vi.fn();
  render(<Pendientes pendientes={{ ...vacios, grabacionesSinTerminar: [GRABACION] }} onCambio={onCambio} />);

  fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
  expect(apiPost).not.toHaveBeenCalled();
  expect(screen.getByText("¿Descartar esta grabación?")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Descartar la grabación" }));
  });

  expect(apiPost).toHaveBeenCalledWith("/api/sesion-clinica/s1/abandonar", {});
  expect(onCambio).toHaveBeenCalledTimes(1);
});

it("cancelar la confirmación no descarta nada", () => {
  render(<Pendientes pendientes={{ ...vacios, grabacionesSinTerminar: [GRABACION] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(apiPost).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Descartar" })).toBeTruthy();
});

it("si la ruta falla, lo dice y no avisa que cambió", async () => {
  vi.mocked(apiPost).mockRejectedValue(new Error("409"));
  const onCambio = vi.fn();
  render(<Pendientes pendientes={{ ...vacios, grabacionesSinTerminar: [GRABACION] }} onCambio={onCambio} />);

  fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Descartar la grabación" }));
  });

  expect(screen.getByRole("alert").textContent).toContain("No se pudo descartar");
  expect(onCambio).not.toHaveBeenCalled();
});
