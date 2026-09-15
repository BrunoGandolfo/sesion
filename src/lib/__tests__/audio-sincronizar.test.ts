import { afterEach, expect, test, vi } from "vitest";
import { sincronizarAudio } from "@/lib/audio/sincronizar";
import type { GrabacionLocal } from "@/lib/audio/almacen";
const local = vi.hoisted(() => ({ indice: 0, inicioMs: 0, iv: "AAAAAAAAAAAAAAAA", bytes: 20, sha256: "a".repeat(64), cifrado: new ArrayBuffer(20) }));
vi.mock("@/lib/audio/almacen", () => ({ leerSegmento: vi.fn(async () => local) }));
const g: GrabacionLocal = { cuenta: "org:usuaria", organizationId: "org", sesionId: "id-recuperado", turnoId: "turno", estado: "cerrada", cantidad: 1, duracionMs: 50_000, pausas: [] };
afterEach(() => vi.unstubAllGlobals());

test.each(["consulta", "reserva", "put", "confirmacion", "cierre"].flatMap(paso => ["antes", "despues"].map(momento => [paso, momento])))("red cortada %s %s: concilia y no duplica", async (paso, momento) => {
  let reservado = false, recibido = false, confirmado = false, cerrado = false, fallo = false, procesamientos = 0, puts = 0;
  const remoto = () => ({ id: g.sesionId, estado: cerrado ? "procesando" : "grabando", duracionAudioSeg: cerrado ? 50 : null, pausas: [], segmentos: reservado ? [{ indice: 0, inicioMs: 0, iv: local.iv, bytes: 20, sha256: local.sha256, confirmado }] : [] });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const operacion = url === "https://r2.test/segmento" ? "put" : url.endsWith("segmentos") ? "reserva" : url.endsWith("confirmar") ? "confirmacion" : url.endsWith("finalizar") ? "cierre" : "consulta";
    // La primera confirmación negativa previa al PUT no consume el fallo.
    const falla = !fallo && operacion === paso && (operacion !== "confirmacion" || recibido);
    if (falla && momento === "antes") { fallo = true; throw new TypeError("corte"); }
    let data: unknown;
    if (operacion === "reserva") { reservado = true; data = { confirmado, url: "https://r2.test/segmento", headers: {} }; }
    else if (operacion === "put") { puts++; expect(init?.body).toBe(local.cifrado); recibido = true; data = {}; }
    else if (operacion === "confirmacion") { confirmado = recibido; data = { confirmado }; }
    else if (operacion === "cierre") { expect(confirmado).toBe(true); if (!cerrado) procesamientos++; cerrado = true; data = remoto(); }
    else data = remoto();
    if (falla && momento === "despues") { fallo = true; throw new TypeError("respuesta perdida"); }
    return Response.json({ data });
  }));
  try { await sincronizarAudio({} as IDBDatabase, g); } catch { /* conserva local y repite */ }
  const resultado = await sincronizarAudio({} as IDBDatabase, g);
  expect(resultado.id).toBe("id-recuperado"); expect(resultado.estado).toBe("procesando");
  expect(procesamientos).toBe(1); expect(puts).toBe(1);
});

test("un contenido remoto distinto detiene el envío y conserva el segmento local", async () => {
  const fetch = vi.fn(async () => Response.json({ data: { id: g.sesionId, estado: "grabando", segmentos: [{ ...local, sha256: "b".repeat(64), confirmado: true }] } }));
  vi.stubGlobal("fetch", fetch);
  await expect(sincronizarAudio({} as IDBDatabase, g)).rejects.toMatchObject({ status: 409 });
  expect(fetch).toHaveBeenCalledOnce();
  expect(local.cifrado.byteLength).toBe(20);
});


test("un cierre ya procesado se reconcilia aunque el worker haya actualizado duración y avisos", async () => {
  const remoto = { id: g.sesionId, estado: "revision", duracionAudioSeg: 49, pausas: [{ inicio: 49800, fin: 50000, siguienteIndice: 1, motivo: "interrupcion" }], segmentos: [{ indice: local.indice, inicioMs: local.inicioMs, bytes: local.bytes, iv: local.iv, sha256: local.sha256, confirmado: true }] };
  const fetch = vi.fn(async (url: string) => { expect(url).toBe(`/api/audio/${g.sesionId}`); return Response.json({ data: remoto }); });
  vi.stubGlobal("fetch", fetch);
  expect(await sincronizarAudio({} as IDBDatabase, g)).toEqual(remoto);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe(`/api/audio/${g.sesionId}`);
});
