import assert from 'node:assert/strict';
import { webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile,mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serve } from './servidor.mjs';

// WebKit GTK no captura: sembrar los archivos REALES de la prueba Chromium en IndexedDB.
// Así se prueba recuperación + descarga con WebKit sin simular soporte de MediaRecorder.
const zipPath = new URL('artefactos/chromium-continua-solape-1000.zip',import.meta.url).pathname;
const unpack = path => JSON.parse(execFileSync('python3',['-c',
  'import zipfile,json,base64,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))',path],{maxBuffer:20*1024*1024}));
const files = unpack(zipPath);
const diagnostic = JSON.parse(Buffer.from(files['diagnostico.json'],'base64'));
const server = await serve(4178);
const profile = await mkdtemp(new URL('artefactos/webkit-descarga-',import.meta.url).pathname);
const browser = await webkit.launchPersistentContext(profile,{acceptDownloads:true,viewport:{width:390,height:844}});
const result = {at:new Date().toISOString(),browserVersion:browser.browser().version(),
  sourceSha256:createHash('sha256').update(await readFile(new URL('index.html',import.meta.url))).digest('hex'),
  storageProfile:'persistente; el contexto efímero falló con UnknownError: Error preparing Blob/File data to be stored in object store',
  scope:'WebKit GTK escritorio: descargas reales; share sustituido para comprobar gesto y File. No es Safari iOS físico.'};
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror',error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:4178');
  await page.waitForFunction(() => prueba.state === 'idle');
  result.mediaRecorder = await page.evaluate(() => typeof MediaRecorder);
  await page.evaluate(async ({diagnostic,files}) => {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('sesion-prueba-segmentos-v1',1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Abrir IndexedDB: '+String(request.error)));
    });
    await new Promise((resolve,reject) => {
      const tx = db.transaction(['meta','segments'],'readwrite',{durability:'strict'});
      tx.oncomplete = resolve; tx.onerror = event => reject(new Error('Sembrar IndexedDB: '+String(event.target.error || tx.error))); tx.onabort = () => reject(new Error('IndexedDB abortado: '+String(tx.error)));
      tx.objectStore('meta').put(diagnostic.run,'run');
      for (const segment of diagnostic.analysis.segments) {
        const name = `segmento-${String(segment.index).padStart(3,'0')}.${segment.mimeType.includes('mp4')?'m4a':'webm'}`;
        const data = Uint8Array.from(atob(files[name]),c => c.charCodeAt(0));
        tx.objectStore('segments').put({...segment,...diagnostic.timing.segments.find(s => s.index===segment.index),
          blob:new Blob([data],{type:segment.mimeType})});
      }
    });
    db.close();
  },{diagnostic,files});
  await page.reload();
  await page.waitForFunction(() => prueba.state === 'recovered' && !document.querySelector('#zip').disabled);
  async function download(selector,name) {
    const event = page.waitForEvent('download'); await page.locator(selector).first().click();
    const file = await event, path = new URL(`artefactos/${name}`,import.meta.url).pathname;
    await file.saveAs(path); assert.equal(await file.failure(),null);
    return {path,name:file.suggestedFilename(),bytes:(await readFile(path)).length};
  }
  result.zip = await download('#zip','webkit-solape.zip');
  const recovered = unpack(result.zip.path);
  assert.ok(recovered['diagnostico.json']);
  for (const [name,data] of Object.entries(files)) if (name !== 'diagnostico.json') assert.equal(recovered[name],data);
  const recoveredDiagnostic = JSON.parse(Buffer.from(recovered['diagnostico.json'],'base64'));
  assert.deepEqual(recoveredDiagnostic.timing.segments,diagnostic.timing.segments);
  assert.equal(recoveredDiagnostic.timing.timeOriginMs,diagnostic.timing.timeOriginMs);
  result.originalAudioAndTimingsPreserved = true;
  result.individual = await download('#files a','webkit-solape-primero.audio');
  result.directLink = await download('#zipLink','webkit-solape-enlace.zip');
  result.recoveredSegments = recoveredDiagnostic.analysis.segments.length;
  result.decodable = recoveredDiagnostic.analysis.segments.map(s => s.decodable);
  result.mobileWidth = await page.evaluate(() => ({width:innerWidth,body:document.body.scrollWidth}));
  // Comprobar la llamada sin await previo; no afirma que la hoja nativa de iOS se probó.
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'canShare',{value:() => true,configurable:true});
    Object.defineProperty(navigator,'share',{configurable:true,value:({files}) => {
      window.shareProbe = {active:navigator.userActivation.isActive,files:files.map(f => ({name:f.name,bytes:f.size,type:f.type,isFile:f instanceof File}))};
      return Promise.resolve();
    }});
  });
  await page.reload();
  await page.waitForFunction(() => prueba.state === 'recovered' && !document.querySelector('#share').disabled);
  await page.click('#share');
  result.shareProbe = await page.evaluate(() => window.shareProbe);
  assert.equal(result.shareProbe.active,true); assert.equal(result.shareProbe.files[0].isFile,true);
  assert.ok(result.shareProbe.files[0].bytes>0); assert.equal(result.shareProbe.files[0].type,'application/zip');
  result.errors = errors; assert.deepEqual(errors,[]);
  result.passed = true;
} finally {await browser.close(); server.close();}
await writeFile(new URL('evidencia/descarga-webkit-solape.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(result);
