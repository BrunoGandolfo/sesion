import { webkit } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  await page.goto('https://prueba-audio.vercel.app/');
  await page.waitForFunction(() => prueba.state === 'idle');
  const result = {at:new Date().toISOString(),browserVersion:browser.version(),headless:true,
    ...await page.evaluate(() => ({mediaRecorder:typeof MediaRecorder,secureContext:isSecureContext,...prueba.diagnostic().environment}))};
  await writeFile(new URL('evidencia/webkit-capacidad-sin-ventana.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(result);
} finally {await browser.close();}
