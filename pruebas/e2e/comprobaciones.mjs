import assert from 'node:assert/strict';

export async function visible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 7000 });
  return locator;
}

export async function alcanzable(locator) {
  await visible(locator);
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ trial: true, timeout: 7000 });
  const rect = await locator.boundingBox();
  const viewport = locator.page().viewportSize();
  assert(rect && rect.width > 0 && rect.height > 0, 'Control sin área visible');
  assert(rect.x >= -1 && rect.x + rect.width <= viewport.width + 1, 'Control cortado horizontalmente');
}

export async function presentacion(page, { alertasEsperadas = [], estadoError = false } = {}) {
  await page.evaluate(() => document.fonts.ready);
  const problemas = await page.evaluate(() => {
    const errores = [];
    if (document.documentElement.scrollWidth > innerWidth + 2) errores.push('scroll horizontal de página');
    for (const el of document.querySelectorAll('button, a, input, select, textarea, h1, h2')) {
      const r = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      if (!r.width || !r.height || css.visibility === 'hidden' || !el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) continue;
      if (el.closest('[aria-hidden="true"], .sr-only, nextjs-portal')) continue;
      // Una grilla desplazable puede contener controles fuera de su ventana.
      let desplazable = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 2) desplazable = true;
      }
      if (!desplazable && (r.left < -2 || r.right > innerWidth + 2)) errores.push(el.tagName + ': fuera del ancho disponible');
      // No confundir el contenido desplazable de campos y ellipsis intencionales con una rotura.
      if (el.matches('button') && !el.querySelector('.truncate') && el.scrollWidth > el.clientWidth + 3) errores.push('botón con contenido recortado');
    }
    return [...new Set(errores)];
  });
  assert.deepEqual(problemas, [], 'Presentación: ' + problemas.join(', '));
  const texto = await page.locator('body').innerText();
  assert(!/Application error:|Internal Server Error|This page could not be found|^404$/mi.test(texto), 'Pantalla de error del servidor');
  if (!estadoError) assert(!/^\s*(Algo falló|No pudimos (traer|cargar|leer)|Hubo un error|Error al cargar)/mi.test(texto), 'Error visible al cargar la pantalla');
  if (!estadoError) {
    for (const alerta of await page.getByRole('alert').all()) {
      if (await alerta.isVisible()) {
        const texto = (await alerta.innerText()).trim();
        assert(!texto || alertasEsperadas.some(patron => patron.test(texto)), 'Alerta inesperada en pantalla');
      }
    }
  }
}
