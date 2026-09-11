import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('.',import.meta.url);
const hash = createHash('sha256').update(await readFile(new URL('index.html',root))).digest('hex');
const reports = ['chromium-continua-solape-0','chromium-continua-solape-1000',
  'chromium-continua-fin-en-solape','chromium-continua-fin-en-solape-completo','chromium-pausa-pausa-en-solape','chromium-recarga-recarga-solape'];
const observations = [];
for (const name of reports) {
  const r = JSON.parse(await readFile(new URL(`evidencia/${name}.json`,root)));
  assert.equal(r.sourceSha256,hash,name); assert.equal(r.status,'ejecutado',name);
  assert.deepEqual(r.errors,[],name); assert.equal(r.uiError,'',name);
  assert.ok(r.calibration.every(c => c.passed),name);
  const d = r.diagnostic, a = d.analysis;
  assert.equal(a.allDecodable,true,name); assert.equal(d.version,2,name);
  assert.equal(r.zipVerification.crcError,null,name);
  assert.ok(r.zipVerification.entries.includes('diagnostico.json'),name);
  assert.equal(r.zipVerification.entries.length,a.segments.length+1,name);
  for (const [i,s] of a.segments.entries()) assert.equal(r.zipVerification.sizes[i],s.bytes,name);
  assert.equal(r.individualDownload.bytes,a.segments[0].bytes,name);
  assert.equal(r.playbackRemoved,true,name);
  assert.equal(r.overlapChecks.sameStreamTracks,true,name);
  assert.equal(r.overlapChecks.allTimingFinite,true,name);
  assert.equal(r.overlapChecks.maxSimultaneous,r.overlapMs?2:1,name);
  for (const b of d.timing.boundaries) if (b.oldSaved && b.newSaved) {
    const previous = d.timing.segments.find(s => s.index===b.from);
    const next = d.timing.segments.find(s => s.index===b.to);
    assert.equal(b.oldStopCallMs,previous.endWallMs,name); assert.equal(b.newStartCallMs,next.startWallMs,name);
    assert.equal(b.actualOverlapMs,previous.endWallMs-next.startWallMs,name);
  }
  if (name.endsWith('fin-en-solape-completo')) assert.equal(a.trimmed.foundBeeps,4,name);
  if (r.scenario === 'recarga') assert.equal(r.recoveryPreservesFiles,true,name);
  if (name.includes('solape-0') || name.includes('solape-1000')) {
    assert.equal(a.segments.length,3,name); assert.equal(a.expectedBeeps,125,name);
    assert.equal(a.trimmed.foundBeeps,125,name);
    assert.deepEqual(a.identityCheck.duplicatesOutsideOverlap,[],name);
    assert.deepEqual(a.identityCheck.missingIds,[],name); assert.deepEqual(a.identityCheck.unexpectedIds,[],name);
    assert.equal(a.foundBeeps,r.overlapMs?127:125,name);
    assert.equal(a.identityCheck.duplicates.length,r.overlapMs?2:0,name);
  }
  observations.push({name,files:a.segments.length,expected:a.expectedBeeps,raw:a.foundBeeps,
    trimmed:a.trimmed.foundBeeps,boundariesMs:a.trimmed.boundaries.map(b => b.intervalMs),
    boundariesExceeding40ms:a.trimmed.boundaries.filter(b => b.exceeds40ms).length});
}
const webkit = JSON.parse(await readFile(new URL('evidencia/descarga-webkit-solape.json',root)));
assert.equal(webkit.sourceSha256,hash); assert.equal(webkit.passed,true);
assert.equal(webkit.mediaRecorder,'undefined'); assert.equal(webkit.originalAudioAndTimingsPreserved,true);
const result = {at:new Date().toISOString(),sourceSha256:hash,passed:true,reports,observations,
  webkitDownloadsPassed:true,iphonePhysicalTest:'pendiente del dueño'};
await writeFile(new URL('evidencia/verificacion-solape.json',root),JSON.stringify(result,null,2)+'\n');
console.log(result);
