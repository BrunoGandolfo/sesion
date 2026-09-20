// @vitest-environment jsdom
//
// La lista de sesiones de la ficha. Lo que se protege salió de mirar el uso en
// producción: la lista estaba enterrada debajo de una tarjeta "Hoy" y de un
// resumen abierto, la sesión de hoy se sacaba de la lista (el contador decía
// dos y se veía una), dos sesiones del mismo día tenían el mismo título, y el
// resumen se cortaba a dos líneas sin decirlo.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GRABAR_SESION, PREPARAR_SESION, REVISAR_NOTA, SESION_DE_HOY } from "@/lib/glosario";
import type { SesionClinicaEnsamblada } from "@/hooks/useSesionClinicaPolling";
import type { Turno } from "@/types/domain";

import { SesionesTab } from "../sesiones-tab";

const m = vi.hoisted(() => ({ get: vi.fn<(url: string) => Promise<unknown>>() }));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiGet: m.get,
}));
vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("../turnos-pagos-tab", () => ({ CobrarSheet: () => null }));

const LARGO =
  "Llegó contando que la semana fue más liviana que la anterior. ".repeat(8) + "Y esto es lo último que dice.";

function doc(id: string, fecha: string, extra: Record<string, unknown> = {}) {
  return {
    sesionClinicaId: id, turnoId: `t-${id}`, fecha, duracionMin: 50, duracionAudioSeg: 3000,
    modalidad: "presencial", estado: "aprobada", nota: null, datos: { resumenSesion: `Resumen de ${id}` },
    feedback: null, aprobadaEn: fecha, procesadaEn: fecha, ...extra,
  };
}

// De la más reciente a la más vieja, como las manda el servidor. Dos el 13/9.
const DOCS = [
  doc("hoy", "2026-09-20T11:00:00.000Z", { estado: "revision" }),
  doc("larga", "2026-09-17T13:00:00.000Z", { datos: { resumenSesion: LARGO } }),
  doc("tarde", "2026-09-13T19:00:00.000Z"),
  doc("manana", "2026-09-13T13:00:00.000Z"),
  doc("agosto", "2026-08-30T13:00:00.000Z"),
];

const TURNO_HOY = {
  id: "t-hoy", fecha: new Date("2026-09-20T11:00:00.000Z"), duracion: 50, modalidad: "presencial",
  estado: "realizado", pagoEstado: "pagado", tarifaCobrada: 2200,
} as unknown as Turno;

function servir(sesiones: unknown[], brief: unknown = null) {
  m.get.mockImplementation(async (url: string) => {
    if (url.includes("/documentacion")) return { pacienteId: "p1", totalSesiones: sesiones.length, sesiones, page: 1, totalPages: 1 };
    if (url.includes("/brief")) { if (!brief) throw new Error("sin brief"); return brief; }
    throw new Error(`pedido inesperado: ${url}`);
  });
}

function montar(props: Partial<React.ComponentProps<typeof SesionesTab>> = {}) {
  return render(
    <SesionesTab
      pacienteId="p1" pacienteNombre="Paciente Sintética" turnoHoy={null} sesionHoy={null}
      sesionHoyCargando={false} onTurnoActualizado={() => {}} onAviso={() => {}} {...props}
    />,
  );
}

const filas = () => Array.from(document.querySelectorAll<HTMLElement>("[data-sesion-id]"));
const abrirTodosLosMeses = () =>
  screen.getAllByRole("button", { expanded: false }).filter((b) => /\d{4}/.test(b.textContent ?? "")).forEach((b) => fireEvent.click(b));

beforeEach(() => { m.get.mockReset(); });
afterEach(cleanup);

describe("la lista de sesiones", () => {
  it("es lo primero de la pestaña: nada clínico va antes que su título", async () => {
    servir(DOCS);
    const { container } = montar({ turnoHoy: TURNO_HOY, sesionHoy: { id: "hoy", turnoId: "t-hoy", estado: "revision" } as SesionClinicaEnsamblada });
    await screen.findByText("Resumen de tarde");
    const primero = container.querySelector("h2, [data-sesion-id], [role='alert']");
    expect(primero?.tagName).toBe("H2");
    expect(primero?.textContent).toBe("Sesiones");
  });

  it("muestra cada sesión una vez, la de hoy incluida y destacada adentro, y el contador coincide", async () => {
    servir(DOCS);
    montar({ turnoHoy: TURNO_HOY, sesionHoy: { id: "hoy", turnoId: "t-hoy", estado: "revision" } as SesionClinicaEnsamblada });
    await screen.findByText("Resumen de tarde");
    abrirTodosLosMeses();

    expect(filas().map((f) => f.dataset.sesionId)).toEqual(["hoy", "larga", "tarde", "manana", "agosto"]);
    expect(screen.getByText("5 sesiones")).toBeTruthy();
    // Los meses también suman lo que se ve.
    expect(screen.getByRole("button", { name: /Septiembre 2026\s*·\s*4 sesiones/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Agosto 2026\s*·\s*1 sesión/ })).toBeTruthy();

    // La de hoy: marcada y con su pendiente adentro de la fila.
    const hoy = within(filas()[0]);
    expect(hoy.getByText(SESION_DE_HOY)).toBeTruthy();
    expect(hoy.getByRole("link", { name: REVISAR_NOTA }).getAttribute("href")).toBe("/sesiones/hoy");
    expect(screen.getAllByText(SESION_DE_HOY)).toHaveLength(1);
  });

  it("el turno de hoy sin nota todavía también es una fila de la lista, la primera, y se cuenta", async () => {
    servir(DOCS.slice(1));
    montar({ turnoHoy: TURNO_HOY, sesionHoy: null });
    await screen.findByText("Resumen de tarde");

    const primera = filas().length ? document.querySelector("ul")!.firstElementChild! : null;
    expect(within(primera as HTMLElement).getByText(SESION_DE_HOY)).toBeTruthy();
    expect(within(primera as HTMLElement).getByRole("link", { name: GRABAR_SESION }).getAttribute("href")).toBe("/grabar/t-hoy");
    expect(screen.getByText("5 sesiones")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Septiembre 2026\s*·\s*4 sesiones/ })).toBeTruthy();
  });

  it("dos sesiones del mismo día se distinguen: el título lleva la hora", async () => {
    servir(DOCS);
    montar();
    await screen.findByText("Resumen de tarde");
    const titulos = filas().map((f) => f.querySelector("a")?.textContent);
    expect(titulos).toContain("domingo 13 de septiembre · 16:00");
    expect(titulos).toContain("domingo 13 de septiembre · 10:00");
    expect(new Set(titulos).size).toBe(titulos.length);
  });

  it("el resumen va entero: no se recorta en silencio", async () => {
    servir(DOCS);
    montar();
    const resumen = await screen.findByText(LARGO.trim());
    expect(resumen.className).not.toContain("line-clamp");
    expect(resumen.className).not.toContain("truncate");
  });

  it("cada fila lleva a su nota y avisa cuál se abrió, para poder volver a ella", async () => {
    servir(DOCS);
    const onAbrirSesion = vi.fn();
    montar({ onAbrirSesion });
    await screen.findByText("Resumen de tarde");
    const enlace = within(filas()[2]).getAllByRole("link")[0];
    expect(enlace.getAttribute("href")).toBe("/sesiones/tarde");
    enlace.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(enlace);
    expect(onAbrirSesion).toHaveBeenCalledWith("tarde");
  });

  it("al volver de una nota, el mes de esa sesión está abierto y la fila se trae a la vista", async () => {
    servir(DOCS);
    const traer = vi.fn();
    Element.prototype.scrollIntoView = traer;
    const onVolvio = vi.fn();
    montar({ volverA: "agosto", onVolvio });
    await waitFor(() => expect(onVolvio).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: /Agosto 2026/ }).getAttribute("aria-expanded")).toBe("true");
    expect(traer.mock.instances[0]).toBe(document.getElementById("sesion-agosto"));
  });

  it("'Preparar sesión' está en el renglón del título, cerrado; con prepararAbierto, abierto", async () => {
    const brief = { pacienteId: "p1", propuestaPendiente: false, notaPendiente: false, proximoTurno: null, hiloLongitudinal: null,
      ultimaSesion: { fecha: "2026-09-17T13:00:00.000Z", pendienteAprobacion: false, resumenSesion: "Lo último que pasó.", focoProximaSesion: null, progresoPercibido: null, temas: [], riesgo: { flagsActivos: [], nivel: "ninguno", indicadores: [], notaParaTerapeuta: null } } };
    servir(DOCS, brief);
    const { unmount } = montar();
    const boton = await screen.findByRole("button", { name: PREPARAR_SESION });
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Lo último que pasó.")).toBeNull();
    expect(boton.parentElement?.parentElement?.querySelector("h2")?.textContent).toBe("Sesiones");
    unmount();

    montar({ prepararAbierto: true });
    expect((await screen.findByRole("button", { name: PREPARAR_SESION })).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Lo último que pasó.")).toBeTruthy();
  });
});
