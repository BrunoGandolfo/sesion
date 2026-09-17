// Captura, cifrado e IndexedDB REALES. Solo la API se reemplaza por un servidor
// local de prueba: no llama a R2, proveedores ni a una base clínica.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";
import { chromium } from "playwright";

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Captura sintética local</title>"); return; }
    if (!/^\/src\/lib\/audio\/[a-z-]+$/.test(url.pathname)) { res.writeHead(404).end(); return; }
    const codigo = await readFile(path.join(raiz, url.pathname + ".ts"), "utf8");
    res.setHeader("Content-Type", "text/javascript");
    res.end(ts.transpileModule(codigo, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  } catch (e) { res.writeHead(500).end(String(e)); }
});
await new Promise(resolve => servidor.listen(0, "127.0.0.1", resolve));
const origen = "http://127.0.0.1:" + servidor.address().port;
const navegador = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
try {
  const contexto = await navegador.newContext();
  let page = await contexto.newPage();
  const errores = []; page.on("pageerror", e => errores.push(e.message));
  // No simula persistencia: solo evita hablar con una API externa.
  await contexto.route("**/api/audio/**", route => {
    if (route.request().url().endsWith("/clave")) return route.fulfill({ json: { data: { clave: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } } });
    if (route.request().method() === "GET") return route.fulfill({ json: { data: { id: "s", estado: "grabando", segmentos: [] } } });
    return route.fulfill({ status: 503, json: { error: "Red de subida desconectada en esta prueba" } });
  });
  await page.goto(origen);
  await page.evaluate(async () => {
    const almacen = await import("/src/lib/audio/almacen");
    const { Grabadora } = await import("/src/lib/audio/grabadora");
    // Migra la base local v1 sin borrar las grabaciones existentes.
    const vieja = await new Promise((resolve, reject) => {
      const r = indexedDB.open("sesion-audio-cifrado", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("grabaciones", { keyPath: ["cuenta", "sesionId"] }).createIndex("turno", ["cuenta", "turnoId"], { unique: true });
        r.result.createObjectStore("segmentos", { keyPath: ["cuenta", "sesionId", "indice"] });
      };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await almacen.guardarGrabacion(vieja, { cuenta: "historica", organizationId: "otra", sesionId: "hist", turnoId: "hist", estado: "pausada", cantidad: 0, duracionMs: 0, pausas: [] });
    vieja.close();
    const db = await almacen.abrirAlmacen();
    await almacen.guardarGrabacion(db, { cuenta: "c", organizationId: "o", sesionId: "s", turnoId: "t", estado: "pausada", cantidad: 0, duracionMs: 0, pausas: [] });
    db.close();
    const eventos = [];
    const Original = window.MediaRecorder;
    let numero = 0;
    window.MediaRecorder = class extends Original {
      constructor(...args) { super(...args); window.prueba.stream = args[0]; const indice = numero++; this.addEventListener("dataavailable", e => eventos.push({ indice, bytes: e.data.size, ms: performance.now() })); }
    };
    const grabadora = new Grabadora("c", "o", "t");
    window.prueba = { grabadora, almacen, eventos };
    await grabadora.abrir(); await grabadora.iniciar();
    window.prueba.inicio = performance.now();
  });
  // Cruza la rotación de 60 s. El prefijo nuevo debe conservar su cabecera
  // propia y el primer segmento no puede quedar duplicado por el respaldo.
  await page.waitForTimeout(62_500);
  const antes = await page.evaluate(async () => {
    const { almacen, inicio } = window.prueba;
    const db = await almacen.abrirAlmacen();
    const g = await almacen.buscarGrabacion(db, "c", "t");
    const r = await new Promise((resolve, reject) => {
      const q = db.transaction("respaldos").objectStore("respaldos").get(["c", "s"]);
      q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
    });
    db.close();
    return { relojMs: performance.now() - inicio, vista: window.prueba.grabadora.snapshot(), fuente: { pista: window.prueba.stream.getAudioTracks()[0].readyState, sintetica: "dispositivo de prueba de Chromium" }, eventos: window.prueba.eventos.slice(-8), grabacion: g, respaldo: r && { indice: r.indice, duracionMs: r.duracionMs, inicioMs: r.inicioMs, bytes: r.bytes, cifrado: r.cifrado instanceof ArrayBuffer, claves: Object.keys(r) } };
  });
  console.log(JSON.stringify({ antes }, null, 2));
  assert.equal(antes.grabacion.cantidad, 1);
  assert.equal(antes.respaldo.indice, 1);
  assert.equal(antes.respaldo.cifrado, true);
  assert.ok(!antes.respaldo.claves.some(k => /clave|chunks|blob|claro/.test(k)));
  assert.ok(antes.relojMs - antes.grabacion.duracionMs - antes.respaldo.duracionMs < 1600);
  // Crash del renderer, SIN pagehide ni stop. IndexedDB sobrevive en el
  // proceso del navegador. Una recarga prolija no demostraría lo mismo.
  const cdp = await navegador.newBrowserCDPSession();
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const renderers = processInfo.filter(p => p.type === "renderer");
  assert.ok(renderers.length > 0);
  const caida = page.waitForEvent("crash", { timeout: 10_000 });
  // Solo procesos del navegador aislado que acabamos de lanzar.
  for (const renderer of renderers) process.kill(Number(renderer.id), "SIGKILL");
  await caida;
  console.log("Renderer caído sin stop; abriendo otra pestaña del mismo contexto.");
  await page.close();
  page = await contexto.newPage();
  await page.goto(origen);
  const despues = await page.evaluate(async () => {
    const almacen = await import("/src/lib/audio/almacen");
    const { Grabadora } = await import("/src/lib/audio/grabadora");
    const { aadSegmento } = await import("/src/lib/audio/contrato");
    const grabadora = new Grabadora("c", "o", "t"); await grabadora.abrir();
    const db = await almacen.abrirAlmacen();
    const g = await almacen.buscarGrabacion(db, "c", "t");
    // La clave de ceros y el descifrado existen únicamente en esta prueba.
    const clave = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["decrypt"]);
    const audio = new AudioContext(); const segmentos = [];
    for (let i = 0; i < g.cantidad; i++) {
      const s = await almacen.leerSegmento(db, "c", "s", i);
      const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(atob(s.iv), c => c.charCodeAt(0)), additionalData: aadSegmento("o", "s", i) }, clave, s.cifrado);
      const decodificado = await audio.decodeAudioData(claro);
      segmentos.push({ indice: i, inicioMs: s.inicioMs, duracion: decodificado.duration, bytes: s.bytes });
    }
    const otraCuenta = await almacen.buscarGrabacion(db, "otra", "t");
    const historica = await almacen.buscarGrabacion(db, "historica", "hist");
    // Si consolidar aborta, ni el respaldo ni el reloj durable se pierden.
    const ultimo = await almacen.leerSegmento(db, "c", "s", 1);
    await almacen.guardarRespaldo(db, { ...ultimo, indice: 2, duracionMs: 1000 });
    let aborto = false;
    try { await almacen.guardarSegmento(db, { ...g, cantidad: 3 }, ultimo); }
    catch { aborto = true; }
    const trasAborto = await almacen.buscarGrabacion(db, "c", "t");
    const respaldoTrasAborto = await new Promise(resolve => { const r = db.transaction("respaldos").objectStore("respaldos").get(["c", "s"]); r.onsuccess = () => resolve(r.result); });
    // Retira únicamente esta fixture, que usó una cabecera de AAD de otro índice.
    await new Promise((resolve, reject) => { const tx = db.transaction("respaldos", "readwrite"); tx.objectStore("respaldos").delete(["c", "s"]); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    const deNuevo = await almacen.recuperarRespaldo(db, g);
    const respaldos = await new Promise(resolve => { const r = db.transaction("respaldos").objectStore("respaldos").count(); r.onsuccess = () => resolve(r.result); });
    await audio.close(); db.close(); await grabadora.cerrar();
    return { grabacion: g, deNuevo, segmentos, respaldos, migracionConserva: historica?.sesionId === "hist", abortoAtomico: aborto && trasAborto.cantidad === g.cantidad && respaldoTrasAborto.indice === 2, aislado: otraCuenta === undefined, vista: grabadora.snapshot() };
  });
  assert.equal(despues.grabacion.estado, "interrumpida");
  assert.equal(despues.grabacion.cantidad, 2);
  assert.deepEqual(despues.deNuevo, despues.grabacion);
  assert.equal(despues.respaldos, 0);
  assert.equal(despues.aislado, true);
  assert.equal(despues.migracionConserva, true);
  assert.equal(despues.abortoAtomico, true);
  assert.ok(despues.segmentos[0].duracion > 58);
  assert.ok(despues.segmentos[1].duracion > 1);
  assert.ok(despues.segmentos[1].inicioMs >= 59_000);
  assert.equal(errores.length, 0);
  console.log(JSON.stringify({ navegador: navegador.version(), antes, despues }, null, 2));
} finally { await navegador.close(); servidor.close(); }
