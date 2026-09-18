// Captura, cifrado e IndexedDB REALES en Chromium. Sólo la API se reemplaza
// por respuestas locales: no llama a R2, ni a proveedores, ni a una base
// clínica. Lo que se prueba acá no se puede probar con dobles:
//
//   1. un solo MediaRecorder para toda la corrida, con entregas de un segundo;
//   2. que cada entrega quede cifrada y durable enseguida;
//   3. que una muerte del proceso (SIGKILL al renderer, sin stop ni pagehide)
//      no pierda más de un segundo, y que al reabrir las entregas entren como
//      piezas sin pedir la clave ni la red;
//   4. que las piezas de una corrida, pegadas, vuelvan a ser EL audio: es lo
//      que hace el worker, y la razón por la que una pieza de adentro no se
//      decodifica sola.
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
  await contexto.route("**/api/audio/**", route => {
    if (route.request().url().endsWith("/clave")) return route.fulfill({ json: { data: { clave: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } } });
    if (route.request().method() === "GET") return route.fulfill({ json: { data: { id: "s", estado: "grabando", segmentos: [] } } });
    return route.fulfill({ status: 503, json: { error: "Red de subida desconectada en esta prueba" } });
  });
  await page.goto(origen);
  await page.evaluate(async () => {
    const almacen = await import("/src/lib/audio/almacen");
    const { Grabadora } = await import("/src/lib/audio/grabadora");
    // Base v2 con un prefijo del grabador anterior: la migración no lo pierde.
    const vieja = await new Promise((resolve, reject) => {
      const r = indexedDB.open("sesion-audio-cifrado", 2);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("grabaciones", { keyPath: ["cuenta", "sesionId"] }).createIndex("turno", ["cuenta", "turnoId"], { unique: true });
        r.result.createObjectStore("segmentos", { keyPath: ["cuenta", "sesionId", "indice"] });
        r.result.createObjectStore("respaldos", { keyPath: ["cuenta", "sesionId"] });
      };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = vieja.transaction(["grabaciones", "respaldos"], "readwrite");
      tx.objectStore("grabaciones").put({ cuenta: "historica", organizationId: "otra", sesionId: "hist", turnoId: "hist", estado: "pausada", cantidad: 0, duracionMs: 0, pausas: [] });
      tx.objectStore("respaldos").put({ cuenta: "historica", sesionId: "hist", indice: 0, inicioMs: 0, iv: "AAAAAAAAAAAAAAAA", bytes: 20, sha256: "a".repeat(64), cifrado: new ArrayBuffer(20), duracionMs: 4000 });
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    vieja.close();
    const db = await almacen.abrirAlmacen();
    await almacen.guardarGrabacion(db, { cuenta: "c", organizationId: "o", sesionId: "s", turnoId: "t", estado: "pausada", cantidad: 0, duracionMs: 0, pausas: [] });
    db.close();
    const eventos = [];
    const Original = window.MediaRecorder;
    let recorders = 0;
    window.MediaRecorder = class extends Original {
      constructor(...args) {
        super(...args);
        window.prueba.stream = args[0];
        window.prueba.recorders = ++recorders;
        this.addEventListener("dataavailable", e => eventos.push({ bytes: e.data.size, ms: Math.round(performance.now()) }));
      }
    };
    const grabadora = new Grabadora("c", "o", "t");
    window.prueba = { grabadora, almacen, eventos, recorders: 0 };
    await grabadora.abrir(); await grabadora.iniciar();
    window.prueba.inicio = performance.now();
  });
  // Cruza la frontera de un minuto: una pieza cerrada y otra en curso.
  await page.waitForTimeout(66_000);
  const antes = await page.evaluate(async () => {
    const { almacen, inicio } = window.prueba;
    const db = await almacen.abrirAlmacen();
    const g = await almacen.buscarGrabacion(db, "c", "t");
    const entregas = await new Promise((resolve, reject) => {
      const q = db.transaction("entregas").objectStore("entregas").getAll();
      q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
    });
    db.close();
    return {
      relojMs: Math.round(performance.now() - inicio),
      recorders: window.prueba.recorders,
      vista: { estado: window.prueba.grabadora.snapshot().grabacion?.estado, error: window.prueba.grabadora.snapshot().error },
      pista: window.prueba.stream.getAudioTracks()[0].readyState,
      entregasRecibidas: window.prueba.eventos.length,
      grabacion: g,
      entregas: entregas.map(e => ({ indice: e.indice, base: e.base, orden: undefined, inicioMs: e.inicioMs, duracionMs: e.duracionMs, continuacion: e.continuacion, bytes: e.bytes, cifradoEsBinario: e.cifrado instanceof ArrayBuffer, claves: Object.keys(e) })),
    };
  });
  // Un solo recorder para toda la corrida: no hay rotación ni solape.
  assert.equal(antes.recorders, 1);
  // La subida está desconectada a propósito: eso muestra un cartel, y la
  // captura tiene que seguir igual.
  assert.equal(antes.vista.estado, "capturando");
  assert.match(antes.vista.error ?? "", /Red de subida desconectada|confirmar el envío/);
  assert.equal(antes.pista, "live");
  // Una pieza cerrada al minuto, y las entregas del tramo en curso guardadas
  // de a una, cifradas, sin claves ni audio en claro en el registro.
  assert.equal(antes.grabacion.cantidad, 1);
  assert.ok(antes.entregas.length >= 4, `entregas durables: ${antes.entregas.length}`);
  assert.ok(antes.entregas.every(e => e.cifradoEsBinario && e.base === 1));
  assert.ok(antes.entregas.every(e => !e.claves.some(k => /clave|chunks|blob|claro/.test(k))));
  assert.ok(antes.entregas.every((e, i) => i === 0 || e.inicioMs > antes.entregas[i - 1].inicioMs));
  // La primera entrega de una pieza que no es la 0 también es continuación.
  assert.ok(antes.entregas.every(e => e.continuacion === true));

  // Crash del renderer, SIN pagehide ni stop. IndexedDB sobrevive en el
  // proceso del navegador. Una recarga prolija no demostraría lo mismo.
  const cdp = await navegador.newBrowserCDPSession();
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const renderers = processInfo.filter(p => p.type === "renderer");
  assert.ok(renderers.length > 0);
  const caida = page.waitForEvent("crash", { timeout: 10_000 });
  for (const renderer of renderers) process.kill(Number(renderer.id), "SIGKILL");
  await caida;
  await page.close();
  page = await contexto.newPage();
  await page.goto(origen);

  const despues = await page.evaluate(async () => {
    const almacen = await import("/src/lib/audio/almacen");
    const { Grabadora } = await import("/src/lib/audio/grabadora");
    const { aadSegmento } = await import("/src/lib/audio/contrato");
    const grabadora = new Grabadora("c", "o", "t");
    await grabadora.abrir();
    const db = await almacen.abrirAlmacen();
    const g = await almacen.buscarGrabacion(db, "c", "t");
    // La clave de ceros y el descifrado existen únicamente en esta prueba.
    const clave = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["decrypt"]);
    const audio = new AudioContext();
    const piezas = [];
    const claros = [];
    for (let i = 0; i < g.cantidad; i++) {
      const s = await almacen.leerSegmento(db, "c", "s", i);
      const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(atob(s.iv), c => c.charCodeAt(0)), additionalData: aadSegmento("o", "s", i) }, clave, s.cifrado);
      claros.push(new Uint8Array(claro));
      piezas.push({ indice: i, inicioMs: s.inicioMs, continuacion: s.continuacion, bytes: s.bytes });
    }
    // Una pieza de adentro de la corrida NO se decodifica sola: no tiene
    // cabecera. Es exactamente por esto que el worker concatena la corrida.
    let solaFalla = false;
    if (claros.length > 1) {
      try { await audio.decodeAudioData(claros[1].slice().buffer); } catch { solaFalla = true; }
    }
    // Pegadas, vuelven a ser el archivo entero.
    const total = new Uint8Array(claros.reduce((n, c) => n + c.length, 0));
    let desplazamiento = 0;
    for (const c of claros) { total.set(c, desplazamiento); desplazamiento += c.length; }
    const corrida = await audio.decodeAudioData(total.buffer);
    const entregasRestantes = await new Promise(resolve => { const q = db.transaction("entregas").objectStore("entregas").count(); q.onsuccess = () => resolve(q.result); });
    // El prefijo v2 se incorpora cuando se abre ESA grabación, no antes.
    const antesDeAbrirla = await almacen.buscarGrabacion(db, "historica", "hist");
    const historica = await almacen.recuperarEntregas(db, antesDeAbrirla);
    const otraCuenta = await almacen.buscarGrabacion(db, "otra", "t");
    // Volver a recuperar no duplica ni mueve el reloj.
    const deNuevo = await almacen.recuperarEntregas(db, g);
    await audio.close(); db.close(); await grabadora.cerrar();
    return {
      grabacion: g, deNuevo, piezas, entregasRestantes, solaFalla,
      duracionCorridaSeg: Number(corrida.duration.toFixed(3)),
      migracionV2: historica && { antes: antesDeAbrirla.cantidad, cantidad: historica.cantidad, duracionMs: historica.duracionMs },
      aislado: otraCuenta === undefined,
      vista: { estado: grabadora.snapshot().grabacion?.estado, mensaje: grabadora.snapshot().mensaje },
    };
  });

  // Las entregas entraron como piezas, sin pedir la clave ni la red.
  assert.ok(despues.grabacion.cantidad > antes.grabacion.cantidad, "las entregas no se incorporaron");
  assert.equal(despues.entregasRestantes, 0);
  assert.equal(despues.grabacion.estado, "interrumpida");
  assert.deepEqual(despues.deNuevo, despues.grabacion, "recuperar dos veces duplicó");
  assert.equal(despues.piezas[0].continuacion, false);
  assert.ok(despues.piezas.slice(1).every(p => p.continuacion === true));
  assert.ok(despues.piezas.every((p, i) => i === 0 || p.inicioMs > despues.piezas[i - 1].inicioMs));
  assert.equal(despues.solaFalla, true, "una pieza de adentro no debería decodificarse sola");
  // El audio rearmado cubre lo grabado hasta un segundo antes de la caída.
  const perdidaSeg = antes.relojMs / 1000 - despues.duracionCorridaSeg;
  assert.ok(perdidaSeg >= 0 && perdidaSeg < 2, `pérdida ante la caída: ${perdidaSeg.toFixed(3)} s`);
  assert.ok(Math.abs(despues.grabacion.duracionMs / 1000 - despues.duracionCorridaSeg) < 2, "el reloj durable y el audio no coinciden");
  // La migración v2→v3 incorpora el prefijo del grabador anterior.
  assert.deepEqual(despues.migracionV2, { antes: 0, cantidad: 1, duracionMs: 4000 });
  assert.equal(despues.aislado, true);
  assert.equal(errores.length, 0, errores.join(" | "));

  console.log(JSON.stringify({
    navegador: navegador.version(),
    antes: { ...antes, entregas: antes.entregas.slice(0, 3), entregasTotales: antes.entregas.length },
    despues,
    perdidaAnteLaCaidaSeg: Number(perdidaSeg.toFixed(3)),
  }, null, 2));
} finally { await navegador.close(); servidor.close(); }
