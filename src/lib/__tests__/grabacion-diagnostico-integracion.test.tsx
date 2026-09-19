// @vitest-environment jsdom
//
// El diagnóstico del grabador, por el camino REAL de punta a punta:
//
//   el hook del grabador arma la grabación  →  subirAudio arma el body del
//   POST  →  la RUTA upload-confirmar lo valida y lo audita  →  la fila de
//   eventos_auditoria en Postgres.
//
// Existe porque el 19/9 las cinco primeras grabaciones reales llegaron con
// {"ok":true,"bytes":…,"duracionAudioSeg":…} y NADA del diagnóstico: el hook
// lo armaba, el schema lo aceptaba, la ruta se lo pasaba a la auditoría… y
// `detalleSeguro` lo descartaba por ser un objeto anidado. Cada pieza tenía su
// prueba y ninguna prueba cruzaba las piezas. Ésta las cruza, con la base de
// verdad. Sólo se doblan el micrófono, R2 y la cookie de sesión.

import { act, renderHook } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { TIPOS_EVENTO_GRABACION } from "@/lib/sesion-clinica/schema";

import { conectarArea2, crearOrg, crearSesion, limpiarOrg, type BaseArea2, type Org } from "./estados-fixtures";

const estado = vi.hoisted(() => ({ base: null as unknown as BaseArea2, actor: { organizationId: "", userId: "" } }));

vi.mock("@/lib/db", () => ({ get db() { return estado.base.db; } }));
vi.mock("@/app/api/_lib/auth", async (original) => ({
  ...(await original<typeof import("@/app/api/_lib/auth")>()),
  getSessionActor: async () => estado.actor,
}));
vi.mock("@/lib/r2", () => ({
  r2Configurado: () => true,
  almacenAudio: {
    firmarSubida: async (key: string) => ({ url: `https://r2.local/${key}`, expiraEn: new Date(Date.now() + 3_600_000) }),
    existe: async () => ({ existe: true, bytes: 40 }),
  },
}));
vi.mock("@/lib/grabacion-storage", () => ({
  guardarChunk: vi.fn(async () => {}),
  guardarPausas: vi.fn(async () => {}),
  iniciarSesionGrabacion: vi.fn(async () => {}),
  limpiarGrabacion: vi.fn(async () => {}),
  recuperarGrabacionPendiente: vi.fn(async () => null),
}));

let org: Org;
let recorder: RecorderFalso;

class RecorderFalso {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((evento: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { RecorderFalso.registrar(this); }
  static registrar(instancia: RecorderFalso) { recorder = instancia; }
  static isTypeSupported() { return true; }
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["aa"]) }); this.onstop?.(); }
}

beforeAll(() => { estado.base = conectarArea2(); });
afterAll(async () => { await estado.base.prisma.$disconnect(); });

beforeEach(async () => {
  org = await crearOrg(estado.base.prisma);
  estado.actor = { organizationId: org.orgId, userId: org.userId };
  vi.stubGlobal("MediaRecorder", RecorderFalso);
  const pista = { stop() {}, onended: null, onmute: null, onunmute: null };
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [pista], getTracks: () => [pista] }) } });
  // El PUT a R2: lo único que no existe acá.
  vi.stubGlobal("XMLHttpRequest", class {
    status = 200; upload = {}; onload: (() => void) | null = null;
    open() {} setRequestHeader() {} send() { queueMicrotask(() => this.onload?.()); }
  });
  // fetch entrega cada pedido a la RUTA de verdad.
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const m = /^\/api\/sesion-clinica\/([^/]+)\/(upload-url|upload-confirmar)$/.exec(url);
    if (!m) throw new Error(`pedido inesperado: ${url}`);
    const ruta = m[2] === "upload-url"
      ? await import("@/app/api/sesion-clinica/[id]/upload-url/route")
      : await import("@/app/api/sesion-clinica/[id]/upload-confirmar/route");
    return ruta.POST(new Request(`http://local${url}`, init), { params: Promise.resolve({ id: m[1] }) });
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await limpiarOrg(estado.base.prisma, org?.orgId);
});

const visibilidad = (valor: "hidden" | "visible") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => valor });
  document.dispatchEvent(new Event("visibilitychange"));
};

test("lo que pasó en el teléfono queda en eventos_auditoria.detalle, sin texto libre", async () => {
  const { useGrabador } = await import("@/components/grabacion/GrabadorSesion");
  const { subirAudio } = await import("@/hooks/useGrabacionSesion");
  const { sesionId, turnoId } = await crearSesion(estado.base.prisma, org, { estado: "grabando", audio: false });

  let subida: Promise<unknown> | null = null;
  const { result } = renderHook(() =>
    useGrabador({ claveGrabacion: turnoId, onError: () => {}, onListo: (datos) => { subida = subirAudio(sesionId, datos); } }),
  );

  // Una grabación como la de cualquier sesión: graba, pausa, cambia de
  // pestaña y vuelve, sigue, termina. Sólo el calendario y el latido son falsos (un chunk
  // por segundo, para pasar el mínimo de 10 s); los timers y la base, reales.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const grabar = async (chunks: number) => {
    for (let i = 0; i < chunks; i += 1) {
      await act(async () => { vi.advanceTimersByTime(1000); recorder.ondataavailable?.({ data: new Blob(["audio"]) }); });
    }
  };
  await act(async () => { await result.current.iniciar(turnoId); });
  await grabar(12);
  act(() => result.current.pausar());
  await esperar(900); // la guarda de doble toque
  act(() => result.current.reanudar());
  act(() => visibilidad("hidden"));
  act(() => visibilidad("visible"));
  act(() => result.current.anotar("wakelock-soltado"));
  await grabar(3);
  await esperar(900);
  act(() => result.current.terminar());
  vi.useRealTimers();
  expect(subida, "el hook no entregó la grabación").not.toBeNull();
  await subida;

  const eventos = await estado.base.prisma.eventoAuditoria.findMany({ where: { entidadId: sesionId, accion: "sesion.subir_audio_fin" } });
  expect(eventos).toHaveLength(1);
  const detalle = eventos[0].detalle as Record<string, unknown>;

  expect(detalle.ok).toBe(true);
  expect(detalle.diagnosticoChunks).toBe(16);
  expect(detalle.diagnosticoBytes).toBeGreaterThan(0);
  const lineas = detalle.diagnostico as string[];
  expect(Array.isArray(lineas)).toBe(true);
  expect(detalle.diagnosticoEventos).toBe(lineas.length);
  expect(lineas.map((l) => l.split(" ")[1])).toEqual(["pausa", "reanudar", "oculta", "visible", "wakelock-soltado"]);
  // Sin texto libre ni contenido clínico: hora ISO, tipo de la lista cerrada y, a lo sumo, milisegundos.
  const tipos = TIPOS_EVENTO_GRABACION.join("|");
  for (const linea of lineas) expect(linea).toMatch(new RegExp(`^\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z (${tipos})( \\d+)?$`));
  for (const valor of Object.values(detalle)) expect(valor === null || typeof valor !== "object" || Array.isArray(valor)).toBe(true);

  const sesion = await estado.base.prisma.sesionClinica.findUniqueOrThrow({ where: { id: sesionId } });
  expect(sesion.estado).toBe("procesando");
});

test("un teléfono que parpadeó mucho: más de veinte eventos llegan enteros, en tandas", async () => {
  const { diagnosticoParaAuditoria } = await import("@/app/api/_lib/casos-uso/audio");
  const { detalleSeguro } = await import("@/app/api/_lib/auditoria-pura");
  const eventos = Array.from({ length: 47 }, (_, i) => ({ t: new Date(1_789_000_000_000 + i * 1000).toISOString(), tipo: i % 2 ? "visible" as const : "oculta" as const }));

  // Pasa por el MISMO saneador que usa registrarAuditoria.
  const detalle = detalleSeguro({ ok: true, ...diagnosticoParaAuditoria({ eventos, chunks: 7000, bytes: 115_000_000 }) })!;

  expect(detalle.diagnosticoEventos).toBe(47);
  const todas = [...(detalle.diagnostico as string[]), ...(detalle.diagnostico2 as string[]), ...(detalle.diagnostico3 as string[])];
  expect(todas).toHaveLength(47);
  expect(todas[46]).toBe(`${eventos[46].t} oculta`);
});
