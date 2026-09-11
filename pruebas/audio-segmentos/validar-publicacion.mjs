import { chromium } from 'playwright';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const url = 'https://prueba-audio.vercel.app/';
const response = await fetch(url);
const html = await response.text();
const hash = data => createHash('sha256').update(data).digest('hex');
const result = {at:new Date().toISOString(),url,status:response.status,redirected:response.redirected,
  htmlMatchesLocal:hash(html) === hash(await readFile(new URL('index.html',import.meta.url))),
  sourceSha256:hash(html),headers:Object.fromEntries(['content-type','permissions-policy','cache-control'].map(key => [key,response.headers.get(key)]))};
if (response.status !== 200 || !result.htmlMatchesLocal) throw new Error(JSON.stringify(result));
const browser = await chromium.launch();
await mkdir(new URL('artefactos/',import.meta.url),{recursive:true});
try {
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  const page = await context.newPage(); const errors = []; page.on('pageerror',error => errors.push(String(error)));
  await page.goto(url); await page.waitForFunction(() => prueba.state === 'idle');
  result.browser = await page.evaluate(() => ({secureContext:isSecureContext,state:prueba.state,
    microphoneApi:!!navigator.mediaDevices?.getUserMedia,bodyWidth:document.body.scrollWidth,viewportWidth:innerWidth,
    recordEnabled:!document.querySelector('#record').disabled,overlapDefault:document.querySelector('#overlap').value,playbackRemoved:!document.querySelector('#play'),shareButton:!!document.querySelector('#share'),mime:document.querySelector('#mime').textContent}));
  await page.screenshot({path:new URL('artefactos/publicacion-movil.png',import.meta.url).pathname,fullPage:true});
  result.pageErrors = errors;
  if (errors.length || result.browser.overlapDefault !== '1000' || !result.browser.playbackRemoved || !result.browser.shareButton || result.browser.bodyWidth>result.browser.viewportWidth) throw new Error(JSON.stringify(result));
} finally {await browser.close();}
await writeFile(new URL('evidencia/publicacion-solape.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(result);
