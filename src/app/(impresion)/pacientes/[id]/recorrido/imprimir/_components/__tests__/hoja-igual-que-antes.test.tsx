// @vitest-environment jsdom
//
// La hoja impresa del Recorrido no cambia cuando cambia la pantalla.
//
// HiloContenido y los gráficos se comparten entre la pestaña Recorrido y esta
// hoja. La referencia (__snapshots__/hoja-sin-senal.html) se generó con el
// código de origin/main ee83f7b, ANTES de reordenar la pantalla: si un cambio
// de presentación se cuela en el papel, este test lo dice. La única
// diferencia admitida es la alerta de la última sesión cuando el servidor
// marca una señal (segundo caso).

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { apiPost } from "@/lib/api-client";
import { ULTIMA_SESION_CON_SENAL } from "@/lib/glosario";
import { hiloVacio, type ContenidoHilo, type ResumenVersionHilo } from "@/lib/hilo/contenido";

import { RecorridoImprimible } from "../recorrido-imprimible";

vi.mock("@/lib/api-client", () => ({ apiPost: vi.fn() }));

const S = [
  "7b0c7e0a-1c4e-4d8a-9a51-0f5d7a9b2c11",
  "c3d9a4f2-6b1e-4f7a-8c2d-5e6f7a8b9c01",
  "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
];

const contenido = (resumen: string): ContenidoHilo => ({
  ...hiloVacio(),
  hipotesisDiagnostica: "Ansiedad generalizada con evitación.\n\nSe sostiene la hipótesis inicial.",
  resumenAcumulativo: resumen,
  objetivosTerapeuticos: [
    { id: "11111111-1111-4111-8111-111111111111", descripcion: "Dormir sin medicación", estado: "activo", fechaInicio: "2026-08-01", fechaCierre: null },
    { id: "22222222-2222-4222-8222-222222222222", descripcion: "Volver a manejar", estado: "cerrado", fechaInicio: "2026-08-01", fechaCierre: "2026-09-01" },
  ],
  intervencionesProbadas: [{ tecnica: "validacion", eficaciaPercibida: "alta", sesiones: [S[0], S[1]] }],
  temasRecurrentes: [{ tema: "Trabajo", conteo: 3 }, { tema: "Madre", conteo: 2 }],
  riesgosHistoricos: [{ sesionId: S[1], fecha: "2026-08-20", flag: "autolesion", detalle: "Lo mencionó al pasar" }],
});

const version = (v: Partial<ResumenVersionHilo> & { version: number }): ResumenVersionHilo => ({
  id: `00000000-0000-4000-8000-00000000000${v.version}`,
  basadaEnVersion: null, actor: "profesional", estado: "aplicada", sesionOrigenId: null,
  creadaPorUserId: null, creadaEn: "2026-08-01T15:00:00.000Z", resueltaEn: null,
  resueltaPorUserId: null, propuestaOrigenId: null, ...v,
});

const SIN_FLAGS = { ideacionSuicida: false, autolesion: false, violenciaTerceros: false, sintomasPsicoticos: false, crisisPanico: false };

function exportacion(ultimaConSenal: boolean) {
  const v1 = version({ version: 1, actor: "ia", sesionOrigenId: S[0], resueltaEn: "2026-08-02T12:00:00.000Z" });
  const v2 = version({ version: 2, creadaEn: "2026-08-25T12:00:00.000Z" });
  const fechas = ["2026-08-01T14:00:00.000Z", "2026-08-20T14:00:00.000Z", "2026-09-10T14:00:00.000Z"];
  return {
    paciente: { nombre: "Ana", apellido: "Pérez" },
    nombreProfesional: "Lic. Prueba",
    exportadoEn: "2026-09-16T17:30:00.000Z",
    vigente: { ...v2, contenido: contenido("Primera sesión: llegó derivada.\n\nSegunda sesión: habló del trabajo.\n\nTercera sesión: durmió mejor.") },
    anteriores: [{ ...v1, contenido: contenido("Primera sesión: llegó derivada.") }],
    versiones: [v2, v1],
    sesiones: S.map((id, i) => ({ id, fecha: fechas[i] })),
    progreso: {
      pacienteId: "p", totalSesiones: 3, rango: "todo",
      sesiones: S.map((sesionId, i) => ({
        sesionId, fecha: fechas[i], numero: i + 1,
        intensidadEmocional: 4 + i, alianzaTerapeutica: i === 0 ? "inestable" : "estable",
        temas: ["Trabajo"],
        nivelRiesgo: ultimaConSenal && i === 2 ? "moderado" : "ninguno",
        flagsRiesgo: SIN_FLAGS,
        intervenciones: { validacion: 2, psicoeducacion: 1 },
        observacionIA: "Hubo más silencios que en la sesión anterior.",
        progresoPercibido: "Sin riesgo a la vista; duerme mejor y retomó el trabajo.",
      })),
      temas: [{ tema: "Trabajo", conteo: 3, deTotal: 3, primeraVez: fechas[0], ultimaVez: fechas[2], tendencia: "estable" }],
      riesgos: [],
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function hoja(ultimaConSenal: boolean): Promise<string> {
  vi.mocked(apiPost).mockResolvedValue(exportacion(ultimaConSenal));
  const { container } = render(<RecorridoImprimible pacienteId="p" />);
  await screen.findByRole("heading", { level: 1, name: "Ana Pérez" });
  return container.querySelector("article")!.outerHTML;
}

it("sin señal en la última sesión, la hoja es idéntica a la de antes del cambio de pantalla", async () => {
  await expect(await hoja(false)).toMatchFileSnapshot("./__snapshots__/hoja-sin-senal.html");
});

it("la única diferencia admitida: con señal en la última sesión, el papel muestra la misma alerta que la pantalla", async () => {
  expect(await hoja(false)).not.toContain(ULTIMA_SESION_CON_SENAL);
  cleanup();
  const conSenal = await hoja(true);
  expect(conSenal).toContain(ULTIMA_SESION_CON_SENAL);
  // «Sin riesgo» en el texto no es lo que la enciende: es el nivel que marcó el servidor.
  expect(conSenal).toContain("Sin riesgo a la vista");
});
