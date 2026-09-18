// El grabador REAL en Chromium, con micrófono sintético y una API local: una
// grabación con pausa, doble toque en Reanudar y la página congelada un rato,
// con el hilo trabado 10 s, subida por el camino real (upload-url → PUT → upload-confirmar). Después
// ffprobe/ffmpeg y el contador de cabeceras del worker miran el archivo que
// "llegó a R2". No habla con R2, Neon, Railway ni ningún proveedor.
//
//   node pruebas/grabador-dhh/verificar.mjs     (requiere: npx playwright install chromium, ffmpeg)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, createWriteStream, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const salida = mkdtempSync(path.join(tmpdir(), "grabador-dhh-"));
const recibido = { confirmaciones: {}, urls: {}, bytes: {} };

const apiLocal = {
  name: "api-local",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://local");
      const json = (cuerpo) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(cuerpo)); };
      const leer = () => new Promise((ok) => { const partes = []; req.on("data", (p) => partes.push(p)); req.on("end", () => ok(Buffer.concat(partes))); });
      const m = url.pathname.match(/^\/api\/sesion-clinica\/([^/]+)\/(upload-url|upload-confirmar)$/);
      if (m && req.method === "POST") {
        const cuerpo = JSON.parse((await leer()).toString());
        if (m[2] === "upload-url") {
          recibido.urls[m[1]] = cuerpo;
          return json({ data: { url: `/r2/${m[1]}`, key: `org/${m[1]}/0`, expiraEn: new Date().toISOString(), headers: { "Content-Type": cuerpo.mime } } });
        }
        recibido.confirmaciones[m[1]] = cuerpo;
        return json({ data: { id: m[1], estado: "procesando" } });
      }
      if (url.pathname.startsWith("/r2/") && req.method === "PUT") {
        // A disco en streaming: ni este servidor copia el archivo a memoria.
        const archivo = path.join(salida, url.pathname.slice(4) + ".webm");
        const destino = createWriteStream(archivo);
        req.pipe(destino);
        destino.on("finish", () => { recibido.bytes[url.pathname.slice(4)] = statSync(archivo).size; res.statusCode = 200; res.end(); });
        return;
      }
      next();
    });
  },
};

const vite = await createServer({
  root: path.join(raiz, "pruebas/grabador-dhh"),
  configFile: false,
  logLevel: "error",
  plugins: [apiLocal],
  resolve: { alias: { "@": path.join(raiz, "src") } },
  server: { port: 0, host: "127.0.0.1", fs: { allow: [raiz] } },
  oxc: { jsx: { runtime: "automatic" } },
});
await vite.listen();
const origen = `http://127.0.0.1:${vite.httpServer.address().port}`;
const navegador = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-precise-memory-info"] });

try {
  const page = await navegador.newPage();
  const errores = []; page.on("pageerror", (e) => errores.push(e.message));
  // Cuenta recorders, pause() y resume() reales.
  await page.addInitScript(() => {
    window.cuenta = { recorders: 0, pause: 0, resume: 0, stop: 0 };
    const Original = window.MediaRecorder;
    window.MediaRecorder = class extends Original {
      constructor(...a) { super(...a); window.cuenta.recorders += 1; window.llegadas = []; this.addEventListener("dataavailable", (e) => window.llegadas.push([Math.round(performance.now()), e.data.size])); }
      pause() { window.cuenta.pause += 1; super.pause(); }
      resume() { window.cuenta.resume += 1; super.resume(); }
      stop() { window.cuenta.stop += 1; super.stop(); }
    };
  });
  await page.goto(origen);
  const vista = async () => JSON.parse(await page.textContent("#vista"));
  const reloj = performance.now(); // monotónico: en esta máquina el reloj de pared retrocede

  await page.click("text=Grabar");
  await page.waitForFunction(() => JSON.parse(document.querySelector("#vista").textContent).estado === "grabando");
  await page.waitForTimeout(20_000);

  // Pausa de 5 s y DOBLE TOQUE en Reanudar.
  await page.click("text=Pausar");
  assert.equal((await vista()).estado, "pausado");
  await page.waitForTimeout(5_000);
  await page.dblclick("text=Reanudar", { force: true });
  await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (b.textContent === "Reanudar" || b.textContent === "Pausar") b.click(); });
  const trasDobleToque = await vista();
  assert.equal(trasDobleToque.estado, "grabando", "el doble toque dejó la grabación en pausa");
  await page.waitForTimeout(12_000);

  // La página deja de correr 10 s (el hilo principal ocupado: ni timers ni
  // eventos). El navegador sigue capturando y suelta los chunks juntos al
  // volver. Chromium NO congela con Page.setWebLifecycleState una página que
  // captura micrófono (los chunks siguieron llegando cada segundo): por eso el
  // hueco se fuerza así. Un hueco REAL de audio no se puede fabricar con el
  // micrófono sintético: eso lo cubren las pruebas del hook.
  const antesDeCongelar = await vista();
  await page.evaluate(() => { const fin = Date.now() + 10_000; while (Date.now() < fin) { /* hilo ocupado */ } });
  await page.waitForTimeout(8_000);
  const trasCongelar = await vista();
  assert.equal(trasCongelar.estado, "grabando", "trabar la página cortó la grabación");
  assert.equal(trasCongelar.hueco, null, "inventó un hueco: el audio de ese rato SÍ llegó, en ráfaga");

  await page.click("text=Terminar");
  await page.waitForFunction(() => window.subida.estado === "lista" || window.subida.estado === "fallo", null, { timeout: 60_000 });
  const relojTotalSeg = (performance.now() - reloj) / 1000;
  const subida = await page.evaluate(() => window.subida);
  const cuenta = await page.evaluate(() => window.cuenta);
  assert.equal(subida.estado, "lista", subida.error);

  // ── El archivo que "llegó a R2"
  const archivo = path.join(salida, "sesion-arnes.webm");
  const formato = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=format_name:stream=codec_name,sample_rate", "-of", "json", archivo]).toString());
  const decodificado = execFileSync("ffmpeg", ["-v", "info", "-nostdin", "-i", archivo, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"], encoding: "buffer" });
  void decodificado;
  const tiempos = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", archivo]).toString().trim().split("\n").map(Number);
  const finDeMarcasSeg = tiempos.at(-1);
  let mayorSaltoDeMarcasSeg = 0;
  for (let i = 1; i < tiempos.length; i += 1) mayorSaltoDeMarcasSeg = Math.max(mayorSaltoDeMarcasSeg, tiempos[i] - tiempos[i - 1]);
  // El audio que de verdad hay: muestras decodificadas, sin rellenar saltos.
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-nostdin", "-i", archivo, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], { maxBuffer: 1 << 28 });
  const duracionArchivoSeg = Number((pcm.length / 2 / 16000).toFixed(3));
  const erroresDecodificacion = execFileSync("ffmpeg", ["-v", "error", "-nostdin", "-i", archivo, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  // El MISMO contador que usa el worker antes del ASR.
  const cabeceras = Number(execFileSync("python3", ["-c", "import sys,re; sys.path.insert(0,'processor'); d=open(sys.argv[1],'rb').read(); print(len(re.findall(rb'\\x1a\\x45\\xdf\\xa3.{1,8}?\\x42\\x86', d, re.DOTALL)))", archivo], { cwd: raiz }).toString());

  const confirmacion = recibido.confirmaciones["sesion-arnes"];
  assert.equal(cuenta.recorders, 1, "se abrió más de un MediaRecorder");
  assert.equal(cuenta.pause, 1);
  assert.equal(cuenta.resume, 1, "Reanudar corrió más de una vez");
  assert.equal(cuenta.stop, 1);
  assert.equal(cabeceras, 1, "el archivo subido tiene más de una cabecera EBML");
  assert.equal(erroresDecodificacion, "", "ffmpeg encontró errores al decodificar");
  assert.equal(recibido.bytes["sesion-arnes"], subida.datos.bytes, "no llegó el archivo entero");
  assert.deepEqual(Object.keys(recibido.urls["sesion-arnes"]).sort(), ["mime", "tamanoBytes"], "upload-url no lleva IV ni clave");
  // La duración medida por chunks sigue al audio que hay en el archivo, y NO
  // al reloj. El tramo trabado se acredita por tamaño (es una estimación).
  assert.ok(Math.abs(confirmacion.duracionAudioSeg - duracionArchivoSeg) <= 3, `teléfono ${confirmacion.duracionAudioSeg} s vs archivo ${duracionArchivoSeg} s`);
  assert.ok(relojTotalSeg - confirmacion.duracionAudioSeg >= 4, "la pausa contó como grabación");
  assert.equal(confirmacion.pausas.length, 1);
  assert.deepEqual(confirmacion.diagnostico.eventos.map((e) => e.tipo), ["pausa", "reanudar", "hueco-latido"]);
  assert.ok(confirmacion.diagnostico.eventos[2].ms >= 9_000, "el hueco entre latidos no quedó medido");
  assert.equal(errores.length, 0, errores.join(" | "));

  // ── Dos horas: ~118 MB subidos tal cual, sin copiar a memoria.
  const dosHoras = await page.evaluate(() => window.simularDosHoras());
  assert.equal(recibido.bytes["dos-horas"], dosHoras.bytes);
  assert.ok(dosHoras.mayorTrabaMs < 1000, `la pantalla se trabó ${dosHoras.mayorTrabaMs} ms`);

  const informe = {
    navegador: navegador.version(),
    relojTotalSeg: Number(relojTotalSeg.toFixed(1)),
    cuenta,
    trasDobleToque,
    antesDeCongelar,
    trasCongelar,
    archivo: { bytes: recibido.bytes["sesion-arnes"], formato: formato.format.format_name, codec: formato.streams[0].codec_name, audioDecodificadoSeg: duracionArchivoSeg, finDeMarcasSeg, mayorSaltoDeMarcasSeg: Number(mayorSaltoDeMarcasSeg.toFixed(3)), cabecerasEBML: cabeceras, erroresDecodificacion },
    confirmacion,
    dosHoras,
  };
  writeFileSync(path.join(raiz, "pruebas/grabador-dhh/resultado-chromium.json"), JSON.stringify(informe, null, 2) + "\n");
  console.log(JSON.stringify(informe, null, 2));
} finally {
  await navegador.close();
  await vite.close();
}
