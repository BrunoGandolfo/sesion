import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { presentacion, fechaDePrueba } from './comprobaciones.mjs';

test('el detector acepta una vista sana y rechaza desbordes y errores visibles', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width:390, height:844 } });
    await page.setContent('<button>Guardar</button>');
    await presentacion(page);
    await page.setContent('<button style="width:500px">Guardar</button>');
    await assert.rejects(() => presentacion(page), /Presentación/);
    await page.setContent('<p role="alert">No se pudo guardar</p>');
    await assert.rejects(() => presentacion(page), /Alerta inesperada/);
    await page.setContent('<p>Application error: a client-side exception has occurred</p>');
    await assert.rejects(() => presentacion(page), /Pantalla de error/);
    await page.setContent('<div role="alert">SEÑAL DE RIESGO\nContenido clínico de prueba</div>');
    await presentacion(page, {alertasEsperadas:[/^Señal de riesgo\s/i]});
    await page.setContent('<div role="alert">SEÑAL DE RIESGO\nContenido clínico de prueba</div><p role="alert">No se pudo guardar</p>');
    await assert.rejects(() => presentacion(page, {alertasEsperadas:[/^Señal de riesgo\s/i]}), /Alerta inesperada/);
    await page.setContent('<p role="alert">Enlace vencido</p><p role="alert">Error nuevo</p>');
    await assert.rejects(() => presentacion(page, {alertasEsperadas:[/^Enlace vencido$/]}), /Alerta inesperada/);
    const permitidos = {textosErrorEsperados:[/^No pudimos completar la operación\. Intentá de nuevo\.$/]};
    await page.setContent('<p>No pudimos completar la operación. Intentá de nuevo.</p>');
    await presentacion(page, permitidos);
    await page.setContent('<p>No pudimos completar la operación. Intentá de nuevo.</p><p>Application error: unexpected exception</p>');
    await assert.rejects(() => presentacion(page, permitidos), /Pantalla de error/);
  } finally { await browser.close(); }
});

test('el turno pasado usa el día de Montevideo y cruza el año correctamente', () => {
  assert.equal(fechaDePrueba(new Date('2026-09-16T01:30:00Z')), '2026-09-12');
  assert.equal(fechaDePrueba(new Date('2026-01-02T02:30:00Z')), '2025-12-29');
});
