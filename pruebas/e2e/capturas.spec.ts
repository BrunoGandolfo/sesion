// Capturas de pantalla para el cierre de cada tarea de frontend
// (.claude/skills/diseno-sesion/SKILL.md): la misma pantalla a 390 y 1280 px.
//
// Hoy sólo /login, que no necesita sesión. Las pantallas con sesión entran
// cuando haya una usuaria E2E propia para esto; mientras tanto, el recorrido
// (npm run e2e) ya pasa por ellas a los mismos dos anchos.
//
// Corre con vitest y la librería `playwright` que ya están en el repo, sin
// @playwright/test. Sin CAPTURAS_URL el bloque se omite: `npm test` lo
// recolecta como a cualquier *.spec.ts y no tiene que abrir un navegador.
//
//     CAPTURAS_URL=http://localhost:3000 npx vitest run pruebas/e2e/capturas.spec.ts
//
// Deja los PNG en pruebas/e2e/resultados/capturas/ (ignorada por Git).
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.CAPTURAS_URL;
const salida = fileURLToPath(new URL("./resultados/capturas/", import.meta.url));

// Los mismos anchos y altos que el recorrido (pruebas/e2e/README.md).
const ANCHOS = [
  { ancho: 390, alto: 844 },
  { ancho: 1280, alto: 900 },
] as const;

const PANTALLAS = [{ nombre: "login", ruta: "/login" }] as const;

describe.skipIf(!url)("capturas sin sesión", () => {
  let browser: Browser;

  beforeAll(async () => {
    await mkdir(salida, { recursive: true });
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  for (const { nombre, ruta } of PANTALLAS) {
    for (const { ancho, alto } of ANCHOS) {
      it(`${ruta} a ${ancho} px`, async () => {
        const context = await browser.newContext({
          viewport: { width: ancho, height: alto },
          locale: "es-UY",
          timezoneId: "America/Montevideo",
          // Quieto, para que dos corridas den la misma imagen.
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          const respuesta = await page.goto(new URL(ruta, url).toString(), { waitUntil: "load" });
          expect(respuesta?.status(), `${ruta} respondió`).toBeLessThan(400);
          await page.evaluate(() => document.fonts.ready);
          const archivo = `${salida}${nombre}-${ancho}.png`;
          await page.screenshot({ path: archivo, fullPage: true });
          console.log(`captura: ${archivo}`);
        } finally {
          await context.close();
        }
      }, 120_000);
    }
  }
});
