import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('.',import.meta.url);
const sourceSha256 = createHash('sha256').update(await readFile(new URL('index.html',root))).digest('hex');
const reports = [];
for (const browser of ['chromium','webkit']) for (const scenario of ['continua','pausa','recarga','segundo-plano']) reports.push(`${browser}-${scenario}`);
for (const label of ['timeslice20','60s','pcm16k','12s','opus16k']) reports.push(`chromium-continua-${label}`);
for (const name of reports) {
  const r = JSON.parse(await readFile(new URL(`evidencia/${name}.json`,root)));
  assert.equal(r.sourceSha256,sourceSha256,`${name}: HTML distinto`);
  assert.ok(r.calibration.every(c => c.passed),`${name}: calibración`);
  if (r.browser === 'webkit') {
    assert.equal(r.status,'bloqueado'); assert.equal(r.preflight.mediaRecorder,'undefined'); continue;
  }
  assert.equal(r.status,'ejecutado',name); assert.equal(r.errors.length,0,name); assert.equal(r.uiError,'',name);
  const a = r.diagnostic.analysis;
  assert.ok(a.allDecodable,name); assert.equal(r.zipVerification.crcError,null,name);
  assert.equal(r.zipVerification.entries.length,a.segments.length+1,name);
  a.segments.forEach((s,i) => {assert.equal(s.index,i+1);assert.equal(r.zipVerification.sizes[i],s.bytes);assert.ok(s.durationSec>0);});
  assert.equal(r.individualDownload.bytes,a.segments[0].bytes,name);
  assert.equal(r.maxScheduledPlaybackGapMs,0,name);
  if (r.scenario === 'recarga') assert.equal(r.recoveryPreservesFiles,true);
  if (r.scenario === 'segundo-plano') {assert.equal(r.visibilityWhileHidden,'hidden');assert.ok(r.visibleAgainAtMs-r.hiddenAtMs>=20000);}
}
const pcm = await readFile(new URL('artefactos/chromium-continua-pcm16k-primero.audio',root));
const pcmHeader = {codecFloatIEEE:pcm.includes(Buffer.from('A_PCM/FLOAT/IEEE')),bitDepth32:pcm.subarray(0,512).includes(Buffer.from([0x62,0x64,0x81,0x20])),bytes:pcm.length};
await writeFile(new URL('evidencia/verificacion.json',root),JSON.stringify({at:new Date().toISOString(),sourceSha256,reportsVerified:reports,pcmHeader},null,2)+'\n');
console.log({reportsVerified:reports.length,sourceSha256,pcmHeader});
