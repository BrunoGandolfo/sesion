// node pruebas/audio/navegadores.mjs
// Chromium/WebKit reales para IndexedDB, Web Crypto, recarga y Web Locks.
// MediaRecorder y reloj simulados: NO acredita el micrófono de un teléfono.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as esperar } from "node:timers/promises";
import ts from "typescript";
import { chromium, webkit } from "playwright";

const server = createServer(async (req, res) => {
  if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Prueba de audio sintético</title>"); return; }
  try {
    const nombre = path.basename(req.url).replace(/\.js$/, "");
    const fuente = await readFile(`src/lib/audio/${nombre}.ts`, "utf8");
    res.setHeader("Content-Type", "text/javascript");
    res.end(ts.transpileModule(fuente, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const resultados = [];
async function esperarEnPagina(page, fn, arg) {
  const hasta = Date.now() + 15_000;
  while (!await page.evaluate(fn, arg)) {
    if (Date.now() > hasta) throw new Error("La escritura del navegador no terminó");
    await esperar(10);
  }
}
try {
  for (const [nombre, motor] of [["Chromium", chromium], ["WebKit", webkit]]) {
    if (process.env.NAVEGADOR && process.env.NAVEGADOR !== nombre) continue;
    const browser = await motor.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      console.log(nombre, "iniciando");
      await page.goto(url);
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      console.log(nombre, "reloj pausado");
      await page.evaluate(async () => {
        const almacen = await import("/almacen");
        const cifrado = await import("/cifrado");
        const { CapturaAudio } = await import("/captura");
        const db = await almacen.abrirAlmacen();
        const clave = await cifrado.importarClave(btoa("k".repeat(32)));
        const g = { cuenta: "org:cuenta", organizationId: "org", sesionId: "sesion", turnoId: "turno", cantidad: 0, duracionMs: 0, pausas: [], estado: "capturando" };
        await almacen.guardarGrabacion(db, g, true);
        let maxActivos = 0, activos = 0, picoPendiente = 0, pendientes = 0;
        class Recorder extends EventTarget {
          state = "inactive";
          mimeType = "audio/webm;codecs=opus";
          start() { this.state = "recording"; maxActivos = Math.max(maxActivos, ++activos); }
          stop() { this.state = "inactive"; activos--; this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob([new Uint8Array(480000).fill(g.cantidad % 255)]) })); this.dispatchEvent(new Event("stop")); }
        }
        const captura = new CapturaAudio({
          guardar: async (blob, ms, inicioMs) => {
            picoPendiente = Math.max(picoPendiente, ++pendientes);
            const segmento = await cifrado.cifrarSegmento(blob, clave, "org", "sesion", g.cantidad, inicioMs);
            const siguiente = { ...g, cantidad: g.cantidad+1, duracionMs: g.duracionMs+ms };
            await almacen.guardarSegmento(db, siguiente, { ...segmento, cuenta: g.cuenta, sesionId: g.sesionId });
            Object.assign(g, siguiente); pendientes--;
          }, parada: async motivo => { g.estado = "pausada"; window.motivo = motivo; await almacen.guardarGrabacion(db, g); },
          error: mensaje => { window.fallo = mensaje; }, crearRecorder: () => new Recorder(),
        });
        window.prueba = { almacen, db, g, captura, stats: () => ({ maxActivos, picoPendiente }) };
        captura.iniciar({ getTracks: () => [{ stop() {} }] }, 0);
      });
      await page.clock.runFor(60_000);
      console.log(nombre, "primer minuto");
      await esperarEnPagina(page, () => window.prueba.g.cantidad === 1 || window.fallo);
      let transcurrido = 60_000;
      while (transcurrido < 9_000_000) {
        const paso = Math.min(59_000, 9_000_000-transcurrido);
        const antes = await page.evaluate(() => window.prueba.g.cantidad);
        await page.clock.runFor(paso);
        transcurrido += paso;
        if (antes % 30 === 0) console.log(nombre, "segmentos", antes);
        await esperarEnPagina(page, n => window.prueba.g.cantidad > n || window.fallo, antes);
        const fallo = await page.evaluate(() => window.fallo);
        assert.equal(fallo, undefined);
      }
      const larga = await page.evaluate(async () => {
        await window.prueba.captura.drenar();
        return { ...window.prueba.g, ...window.prueba.stats(), motivo: window.motivo };
      });
      assert.equal(larga.duracionMs, 9_000_000);
      assert.equal(larga.maxActivos, 2);
      assert.equal(larga.picoPendiente, 1);
      assert.equal(larga.motivo, "limite");
      await page.reload();
      const recuperada = await page.evaluate(async () => {
        const a = await import("/almacen"); const db = await a.abrirAlmacen();
        const g = await a.buscarGrabacion(db, "org:cuenta", "turno");
        const otra = await a.buscarGrabacion(db, "org:otra", "turno");
        const s = await a.leerSegmento(db, g.cuenta, g.sesionId, 0);
        const segundo = await a.leerSegmento(db, g.cuenta, g.sesionId, 1);
        let piso = false;
        try { await a.guardarGrabacion(db, { ...g, cantidad: 0 }, true); piso = true; } catch { /* unique protege el pendiente */ }
        db.close();
        return { g, otra, piso, bytes: s.cifrado.byteLength, campos: Object.keys(s), inicioMs: s.inicioMs, inicioSegundo: segundo.inicioMs };
      });
      assert.equal(recuperada.g.sesionId, "sesion");
      assert.equal(recuperada.g.duracionMs, 9_000_000);
      assert.equal(recuperada.otra, undefined);
      assert.equal(recuperada.piso, false);
      assert.equal(recuperada.bytes, 480016);
      assert.equal(recuperada.inicioMs, 0);
      assert.equal(recuperada.inicioSegundo, 59000);
      assert.ok(!recuperada.campos.includes("clave"));
      // Web Locks real entre dos pestañas, liberado al cerrar la dueña.
      await page.evaluate(() => { void navigator.locks.request("audio:competencia", () => new Promise(resolve => { window.liberar = resolve; })); });
      await esperarEnPagina(page, () => !!window.liberar);
      const segunda = await context.newPage(); await segunda.goto(url);
      assert.equal(await segunda.evaluate(() => navigator.locks.request("audio:competencia", { ifAvailable: true }, lock => !!lock)), false);
      await page.evaluate(() => window.liberar());
      // Una transacción abortada no deja segmento ni avanza el reloj.
      const atomica = await segunda.evaluate(async () => {
        const a = await import("/almacen"); const db = await a.abrirAlmacen();
        const g = await a.buscarGrabacion(db, "org:cuenta", "turno");
        const tx = db.transaction(["grabaciones", "segmentos"], "readwrite", { durability: "strict" });
        const abortada = new Promise(resolve => { tx.onabort = resolve; });
        tx.objectStore("grabaciones").put({ ...g, cantidad: 999 });
        tx.objectStore("segmentos").add({ cuenta: g.cuenta, sesionId: g.sesionId, indice: 999, cifrado: new ArrayBuffer(16) });
        tx.abort(); await abortada;
        const despues = await a.buscarGrabacion(db, g.cuenta, "turno");
        const s = await a.leerSegmento(db, g.cuenta, g.sesionId, 999); db.close();
        return despues.cantidad === g.cantidad && s === undefined;
      });
      assert.equal(atomica, true);
      resultados.push({ navegador: nombre, minutos: 150, segmentos: larga.cantidad, cifradoYRecarga: true, aislamiento: true, dosPestanas: true, rollback: true, maxRecorders: larga.maxActivos, maxCifradosPendientes: larga.picoPendiente, captura: "simulada; no certifica teléfono" });
      console.log(JSON.stringify(resultados.at(-1)));
      await context.close();
    } finally { await browser.close(); }
  }
} finally { server.close(); }
