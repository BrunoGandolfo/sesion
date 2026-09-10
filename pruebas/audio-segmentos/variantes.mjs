import { spawnSync } from 'node:child_process';
// Secuenciales: cada corrida dispone del servidor de audio privado durante toda la captura.
const variants = [
  {LABEL:'timeslice20',INTERNAL_TIMESLICE_MS:'20'},
  {LABEL:'60s',SEGMENT_SECONDS:'60',DURATION_SECONDS:'125'},
  {LABEL:'pcm16k',FORCE_MIME:'audio/webm;codecs=pcm',SOURCE_SAMPLE_RATE:'16000',SOURCE_CHANNELS:'1'},
  {LABEL:'12s',SEGMENT_SECONDS:'12',DURATION_SECONDS:'65'},
  {LABEL:'opus16k',FORCE_MIME:'audio/webm;codecs=opus',SOURCE_SAMPLE_RATE:'16000',SOURCE_CHANNELS:'1'}
];
for (const variant of variants) {
  console.log(`\nComparación: ${variant.LABEL}`);
  const result = spawnSync('xvfb-run',['-a','node','pruebas.mjs'],{
    stdio:'inherit',env:{...process.env,GDK_BACKEND:'x11',BROWSERS:'chromium',CASES:'continua',...variant}
  });
  if (result.status !== 0) throw new Error(`No se pudo completar ${variant.LABEL}`);
}
