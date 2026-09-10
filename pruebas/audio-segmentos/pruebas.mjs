import { chromium, webkit } from 'playwright';
import { serve } from './servidor.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { platform, release, tmpdir } from 'node:os';

// Se ejecuta en Linux bajo Xvfb + Openbox. Chromium se inicia sin las modificaciones de
// foco/visibilidad y de throttling de Playwright; Playwright lo controla por CDP noDefaults.
// No se falsifica document.hidden ni se adelantan los relojes.
const root = new URL('.',import.meta.url);
const artifactPath = resolve('artefactos');
await mkdir(artifactPath,{recursive:true});
await mkdir(new URL('evidencia/',root),{recursive:true});
const matrix = process.env.CASES ? process.env.CASES.split(',') : ['continua','pausa','recarga','segundo-plano'];
const engines = process.env.BROWSERS ? process.env.BROWSERS.split(',') : ['chromium','webkit'];
const segmentSeconds = Number(process.env.SEGMENT_SECONDS || 10);
const durationSeconds = Number(process.env.DURATION_SECONDS || 65);
const suffix = process.env.LABEL ? `-${process.env.LABEL}` : '';
const internalTimesliceMs = Number(process.env.INTERNAL_TIMESLICE_MS || 0);
const forcedMimeType = process.env.FORCE_MIME || null;
const sourceSampleRate = Number(process.env.SOURCE_SAMPLE_RATE || 0);
const sourceChannels = Number(process.env.SOURCE_CHANNELS || 0);
const port = Number(process.env.PORT || 4177), debugPort = Number(process.env.DEBUG_PORT || 9230);
const baseUrl = `http://127.0.0.1:${port}`;
const server = await serve(port);
const wm = platform() === 'linux' ? spawn('openbox',[],{stdio:'ignore'}) : null;
if (wm) await new Promise(r => setTimeout(r,700));
let pulse;
if (platform() === 'linux' && process.env.SYSTEM_AUDIO !== '1') {
  // Dispositivo de salida virtual dedicado. No depende del puente de sonido de WSLg
  // ni cambia el volumen, las fuentes o el servidor de audio de las otras aplicaciones.
  const pulsePath = await mkdtemp(`${tmpdir()}/prueba-audio-pulse-`);
  pulse = spawn('pulseaudio',['-n','--daemonize=no','--use-pid-file=no','--exit-idle-time=-1',
    '--load=module-null-sink sink_name=prueba_audio rate=48000 channels=2',
    `--load=module-native-protocol-unix socket=${pulsePath}/native auth-anonymous=1`],
    {stdio:'ignore',env:{...process.env,PULSE_RUNTIME_PATH:pulsePath,PULSE_STATE_PATH:pulsePath}});
  for (let i = 0; i < 40; i++) {try {await access(`${pulsePath}/native`);break;} catch {await new Promise(r => setTimeout(r,100));}}
  await access(`${pulsePath}/native`);
  process.env.PULSE_SERVER = `unix:${pulsePath}/native`;
}
const sourceSha256 = createHash('sha256').update(await readFile(new URL('index.html',root))).digest('hex');
const pkg = JSON.parse(await readFile(new URL('node_modules/playwright/package.json',root)));
const sleep = ms => new Promise(r => setTimeout(r,Math.max(0,ms)));

async function launch(name) {
  if (name === 'webkit') {
    const browser = await webkit.launch({headless:false,env:{...process.env,GDK_BACKEND:'x11'}});
    return {browser,context:await browser.newContext({viewport:{width:1100,height:850},acceptDownloads:true}),close:() => browser.close()};
  }
  const profile = await mkdtemp(`${artifactPath}/perfil-`);
  const child = spawn(chromium.executablePath(),['--no-sandbox','--no-first-run','--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let browser;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true}); break; }
    catch { await sleep(200); }
  }
  if (!browser) { child.kill(); throw new Error('Chromium no abrió el puerto de control.'); }
  return {browser,context:browser.contexts()[0],close:async () => {await browser.close();child.kill();}};
}
async function calibration(page) {
  return page.evaluate(() => {
    const rate = 48000, original = new Float32Array(rate*4);
    for (let i = 0; i < original.length; i++) {
      const phase = (i/rate)%1;
      if (phase >= .5 && phase < .58) original[i] = .6*Math.sin(2*Math.PI*1000*i/rate);
    }
    const buffer = pcm => ({sampleRate:rate,length:pcm.length,getChannelData:() => pcm});
    return [-80,-40,0,40,80].map(delta => {
      const cut = rate*2, change = Math.round(delta*rate/1000);
      const pcm = new Float32Array(original.length+change);
      pcm.set(original.subarray(0,cut));
      pcm.set(original.subarray(cut + Math.max(0,-change)),cut + Math.max(0,change));
      const beeps = prueba.detectBeeps([buffer(pcm)]);
      const actualIntervalMs = (beeps[2].onsetSec-beeps[1].onsetSec)*1000;
      return {insertedMs:delta,expectedIntervalMs:1000+delta,actualIntervalMs,found:beeps.length,
        passed:Math.abs(actualIntervalMs-(1000+delta)) < 1 && beeps.length === 4};
    });
  });
}

async function runCase(name,scenario) {
  const env = await launch(name);
  const result = {browser:name,scenario,startedAt:new Date().toISOString(),durationSeconds,segmentSeconds,
    playwrightVersion:pkg.version,browserVersion:env.browser.version(),os:`${platform()} ${release()}`,sourceSha256,
    headless:false,launchMode:name === 'chromium' ? 'Chrome nativo + CDP noDefaults:true' : 'Playwright WebKit GTK',errors:[]};
  result.audioOutput = pulse ? 'PulseAudio privado, null sink, 48000 Hz' : 'Servidor de audio del sistema';
  result.internalTimesliceMs = internalTimesliceMs || null;
  result.variant = {forcedMimeType,sourceSampleRate:sourceSampleRate || null,sourceChannels:sourceChannels || null};
  try {
    const page = await env.context.newPage();
    if (forcedMimeType || sourceSampleRate || sourceChannels) await page.addInitScript(options => {
      if (options.forcedMimeType && window.MediaRecorder) {
        const OriginalRecorder = window.MediaRecorder;
        window.MediaRecorder = class extends OriginalRecorder {
          constructor(stream,settings) {super(stream,{...settings,mimeType:options.forcedMimeType});}
        };
      }
      if ((options.sourceSampleRate || options.sourceChannels) && window.AudioContext) {
        const OriginalContext = window.AudioContext;
        window.AudioContext = class extends OriginalContext {
          constructor(settings) {super({...settings,...(options.sourceSampleRate ? {sampleRate:options.sourceSampleRate} : {})});}
          createMediaStreamDestination() {
            const destination = super.createMediaStreamDestination();
            if (options.sourceChannels) destination.channelCount = options.sourceChannels;
            return destination;
          }
        };
      }
    },{forcedMimeType,sourceSampleRate,sourceChannels});
    if (internalTimesliceMs) await page.addInitScript(ms => {
      if (!window.MediaRecorder) return;
      const start = MediaRecorder.prototype.start;
      MediaRecorder.prototype.start = function() {return start.call(this,ms);};
    },internalTimesliceMs);
    page.on('pageerror',error => result.errors.push(String(error)));
    await page.goto(baseUrl);
    await page.bringToFront();
    await page.waitForFunction(() => ['idle','error'].includes(window.prueba?.state));
    result.preflight = await page.evaluate(() => ({mediaRecorder:typeof MediaRecorder,audioContext:typeof AudioContext,
      visibility:document.visibilityState,error:document.querySelector('#error').textContent,
      strictStorageReady:prueba.state === 'idle',...prueba.diagnostic().environment}));
    result.calibration = await calibration(page);
    if (result.calibration.some(r => !r.passed)) throw new Error('Falló la calibración del detector.');
    if (result.preflight.mediaRecorder !== 'function' || !result.preflight.supportedMimes.length) {
      result.status = 'bloqueado'; result.blocker = 'Este binario no expone MediaRecorder; no se inició la fuente ni la captura.';
      console.log(`${name} ${scenario}: BLOQUEADO (${result.preflight.mediaRecorder})`);
      return result;
    }
    let downloadSession;
    if (name === 'chromium') {
      downloadSession = await env.browser.newBrowserCDPSession();
      await downloadSession.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:artifactPath,eventsEnabled:true});
    }
    async function saveDownload(selector,destination) {
      if (!downloadSession) {
        const event = page.waitForEvent('download',{timeout:15000}); await page.locator(selector).first().click();
        const download = await event; await download.saveAs(destination);
        return {name:download.suggestedFilename(),failure:await download.failure()};
      }
      // noDefaults conserva el destino de descargas del navegador. Escuchar su evento CDP
      // evita confundir una descarga válida con la ausencia del evento administrado por Playwright.
      let begun, completed; const progress = new Map();
      const began = new Promise(resolve => {begun = resolve;});
      const done = new Promise(resolve => {completed = resolve;});
      let guid;
      const onBegin = event => {guid = event.guid; begun(event); if (progress.get(guid) === 'completed') completed();};
      const onProgress = event => {progress.set(event.guid,event.state); if (event.guid === guid && event.state === 'completed') completed();};
      downloadSession.on('Browser.downloadWillBegin',onBegin); downloadSession.on('Browser.downloadProgress',onProgress);
      let timer;
      try {
        const timeout = new Promise((_,reject) => {timer = setTimeout(() => reject(new Error('La descarga no terminó en 15 s')),15000);});
        await page.locator(selector).first().click();
        const event = await Promise.race([began,timeout]); await Promise.race([done,timeout]);
        const data = await readFile(`${artifactPath}/${event.guid}`); await writeFile(destination,data);
        return {name:event.suggestedFilename,failure:null,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
      } finally {
        clearTimeout(timer); downloadSession.off('Browser.downloadWillBegin',onBegin); downloadSession.off('Browser.downloadProgress',onProgress);
      }
    }
    await page.selectOption('#source','synthetic'); await page.fill('#seconds',String(segmentSeconds));
    if (process.env.CODEC) await page.selectOption('#codec',process.env.CODEC);
    await page.click('#record');
    await page.waitForFunction(() => prueba.state === 'recording',{},{timeout:15000});
    const initial = await page.evaluate(() => prueba.snapshot());
    const start = performance.now()-initial.wallRecordedMs;
    const at = seconds => sleep(start+seconds*1000-performance.now());
    console.log(`${name} ${scenario}: capturando ${durationSeconds} s; segmentos ${segmentSeconds} s`);
    if (scenario === 'pausa') {
      await at(27.5); await page.click('#pause');
      await page.waitForFunction(() => prueba.state === 'paused');
      result.pauseStartedAtMs = performance.now()-start;
      await sleep(5000);
      await page.click('#pause'); await page.waitForFunction(() => prueba.state === 'recording');
      result.resumedAtMs = performance.now()-start;
      console.log(`${name}: pausa realizada (${Math.round(result.resumedAtMs-result.pauseStartedAtMs)} ms)`);
    } else if (scenario === 'recarga') {
      await at(35);
      result.beforeReload = await page.evaluate(() => ({snapshot:prueba.snapshot(),segments:prueba.segments}));
      await page.reload();
      await page.waitForFunction(() => prueba.state === 'recovered');
      result.afterReload = await page.evaluate(() => ({state:prueba.state,segments:prueba.segments,diagnostic:prueba.diagnostic()}));
      result.recoveryPreservesFiles = JSON.stringify(result.beforeReload.segments) === JSON.stringify(result.afterReload.segments);
      console.log(`${name}: recarga realizada; recuperados ${result.afterReload.segments.length} archivos`);
    } else if (scenario === 'segundo-plano') {
      await at(20);
      const other = await env.context.newPage();
      await other.goto(`${baseUrl}/blank`); await other.bringToFront();
      await page.waitForFunction(() => document.visibilityState === 'hidden',{},{polling:100,timeout:5000});
      result.hiddenAtMs = performance.now()-start;
      result.visibilityWhileHidden = await page.evaluate(() => document.visibilityState);
      await sleep(20000);
      await page.bringToFront();
      await page.waitForFunction(() => document.visibilityState === 'visible');
      result.visibleAgainAtMs = performance.now()-start;
      await other.close();
      console.log(`${name}: segundo plano real ${Math.round(result.visibleAgainAtMs-result.hiddenAtMs)} ms`);
    }
    await at(durationSeconds);
    if (scenario !== 'recarga') {
      await page.click('#finish');
      await page.waitForFunction(() => prueba.state === 'finished' && prueba.diagnostic().analysis !== null,{},{timeout:30000});
    }
    result.finishedAt = new Date().toISOString(); result.elapsedWindowMs = performance.now()-start;
    result.diagnostic = await page.evaluate(() => prueba.diagnostic());
    result.uiError = await page.locator('#error').textContent();
    result.status = 'ejecutado';
    if (result.diagnostic.analysis.allDecodable) {
      await page.click('#play');
      await page.waitForFunction(() => prueba.diagnostic().events.some(e => e.type === 'playback-scheduled'));
      result.playback = await page.evaluate(() => prueba.diagnostic().events.filter(e => e.type === 'playback-scheduled').at(-1));
      result.maxScheduledPlaybackGapMs = Math.max(0,...result.playback.starts.slice(1).map((s,i) => Math.abs(s.start-(result.playback.starts[i].start+result.playback.starts[i].duration))*1000));
      await page.click('#stopPlay');
    }
    const zipPath = `${artifactPath}/${name}-${scenario}${suffix}.zip`;
    result.zipDownload = await saveDownload('#zip',zipPath);
    result.zipVerification = JSON.parse(execFileSync('python3',['-c',
      'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"crcError":z.testzip(),"entries":z.namelist(),"sizes":[i.file_size for i in z.infolist()]}))',zipPath]).toString());
    result.individualDownload = await saveDownload('#files button',`${artifactPath}/${name}-${scenario}${suffix}-primero.audio`);
    await page.screenshot({path:`${artifactPath}/${name}-${scenario}${suffix}.png`,fullPage:true});
    const a = result.diagnostic.analysis;
    console.log(`${name} ${scenario}: ${a.segments.length} archivos; ${a.foundBeeps}/${a.expectedBeeps} pitidos; fronteras ${a.boundaries.map(b => b.intervalMs).join(', ')} ms`);
  } catch(error) { result.status = 'error'; result.errors.push(String(error)); console.log(`${name} ${scenario}: ERROR ${error}`); }
  finally { await env.close(); }
  return result;
}

try {
  for (const name of engines) for (const scenario of matrix) {
    const result = await runCase(name,scenario);
    await writeFile(new URL(`evidencia/${name}-${scenario}${suffix}.json`,root),JSON.stringify(result,null,2)+'\n');
  }
} finally {server.close();wm?.kill();pulse?.kill();}
