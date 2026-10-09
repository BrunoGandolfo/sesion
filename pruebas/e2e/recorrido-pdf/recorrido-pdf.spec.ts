// El PDF del Recorrido, paginado por Chromium de verdad: jsdom no pagina, así
// que los snapshots de la hoja no pueden decir cuántas páginas sale ni en
// qué papel. Esto sí:
//
//   - fixture mínimo (una nota, sin Recorrido revisado): 1 página A4;
//   - fixture rico (el del snapshot de la hoja): 6 páginas A4 o menos.
//
// El PDF se pide en CARTA con preferCSSPageSize: si sale A4 (595 × 842 pt) es
// porque lo pide el @page de src/app/(impresion)/impresion.css, no esta
// prueba. Es lo que tiene que pasar en el diálogo del teléfono.
//
// Usa la página real (/pacientes/<id>/recorrido/imprimir), con su layout y
// su sesión: entra con la cuenta de prueba, como el recorrido, y responde
// sólo el POST de exportación con la fixture de los tests de la hoja
// (fixture-exportacion.ts). Nada más se sustituye: no hay arnés.
//
// Corre a mano, como capturas.spec.ts: contra un servidor levantado (local
// con `npm run build && npx next start`, o una rama desplegada) y la cuenta
// de prueba en el entorno. CAPTURAS_URL es la variable con la que
// vitest.config.ts deja entrar los specs de pruebas/e2e.
//
//     CAPTURAS_URL=http://localhost:3000 E2E_USUARIO=… E2E_PASSWORD=… \
//       npx vitest run pruebas/e2e/recorrido-pdf
//
// Deja los PDF en pruebas/e2e/resultados/recorrido-pdf/ (ignorada por Git).
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  exportacionDePrueba,
  exportacionMinima,
} from "../../../src/app/(impresion)/pacientes/[id]/recorrido/imprimir/_components/__tests__/fixture-exportacion";
import { medidasDePaginas } from "./pdf";

const url = process.env.CAPTURAS_URL;
const usuario = process.env.E2E_USUARIO;
const password = process.env.E2E_PASSWORD;
const salida = fileURLToPath(new URL("../resultados/recorrido-pdf/", import.meta.url));

/** A4 en puntos, como lo escribe Chromium (594.96 × 841.92). */
const A4 = "595x842";

// Un id cualquiera: la página no lee al paciente, sólo pide la exportación,
// y esa respuesta la pone la prueba.
const PACIENTE = "00000000-0000-4000-8000-0000000000aa";

describe.skipIf(!url || !usuario || !password)("PDF del Recorrido", () => {
  let browser: Browser;
  let contexto: BrowserContext;

  beforeAll(async () => {
    await mkdir(salida, { recursive: true });
    browser = await chromium.launch();
    contexto = await browser.newContext({
      viewport: { width: 1000, height: 1400 },
      locale: "es-UY",
      timezoneId: "America/Montevideo",
    });
    const page = await contexto.newPage();
    await page.goto(new URL("/login", url).toString());
    await page.getByLabel("Email", { exact: true }).fill(usuario!);
    await page.getByLabel("Contraseña", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
    await page.close();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function pdfDe(nombre: string, exportacion: unknown) {
    const page = await contexto.newPage();
    try {
      // La hoja abre el diálogo de impresión sola cuando termina de dibujar.
      await page.addInitScript(() => { window.print = () => {}; });
      await page.route("**/hilo/exportar", (ruta) =>
        ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: exportacion }) }),
      );
      await page.goto(new URL(`/pacientes/${PACIENTE}/recorrido/imprimir`, url).toString());
      await page.getByRole("heading", { level: 1, name: "Ana Pérez" }).waitFor({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      const archivo = `${salida}${nombre}.pdf`;
      await page.pdf({ path: archivo, format: "Letter", printBackground: true, preferCSSPageSize: true });
      return medidasDePaginas(await readFile(archivo));
    } finally {
      await page.close();
    }
  }

  it("el mínimo sale en una página A4", async () => {
    const paginas = await pdfDe("minimo", exportacionMinima());
    expect(paginas).toEqual([A4]);
  }, 60_000);

  it("el rico sale en seis páginas A4 o menos", async () => {
    const paginas = await pdfDe("rico", exportacionDePrueba());
    expect(paginas.length).toBeGreaterThan(1);
    expect(paginas.length).toBeLessThanOrEqual(6);
    expect(new Set(paginas)).toEqual(new Set([A4]));
  }, 60_000);
});
