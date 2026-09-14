import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { visible, alcanzable, presentacion } from './comprobaciones.mjs';

const argumento = process.argv.slice(2).find(a => a.startsWith('--url='));
if (!argumento || !process.env.E2E_USUARIO || !process.env.E2E_PASSWORD) {
  console.error('Uso: E2E_USUARIO y E2E_PASSWORD en el entorno; npm run e2e -- --url=https://...');
  process.exit(2);
}
const destino = new URL(argumento.slice(6));
assert(['https:', 'http:'].includes(destino.protocol), 'URL HTTP(S) requerida');
assert(!destino.username && !destino.password && !destino.search && destino.pathname === '/', 'Pasá solo el origen, sin credenciales, ruta ni query');
const origen = destino.origin;
const inicio = Date.now();
const salida = fileURLToPath(new URL('./resultados/', import.meta.url));
await mkdir(salida, { recursive: true });
const resultado = { origen, fecha: new Date().toISOString(), pasos: [], omitidos: [], restauracion: null };
const redactar = s => String(s).split(process.env.E2E_PASSWORD).join('[contraseña]').split(process.env.E2E_USUARIO).join('[usuario]');
const marca = 'E2E-' + Date.now().toString(36);
const creados = [];
let configuracionPendiente;
let browser, context, page, cobro, permiso, pantalla = 'inicio', ancho = 1280;
const errores = [];
const pendientes = new Set();
let terminando = false;
// 240 s de recorrido + hasta 50 s reservados para restaurar configuración y datos propios.
const limite = setTimeout(() => { void finalizar(new Error('El recorrido superó 240 segundos')); }, 240_000);
const limiteDuro = setTimeout(() => { console.error('FALLO: agotados 290 s; revisá la restauración informada.'); process.exit(1); }, 290_000);

const boton = (nombre, root = page) => root.getByRole('button', { name: nombre, exact: true }).filter({ visible: true }).first();
const dialogo = () => page.getByRole('dialog').filter({ visible: true }).first();
async function esperar(condicion, mensaje, ms = 7000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (await condicion()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(mensaje);
}
async function estable() {
  await page.waitForTimeout(400);
  await esperar(() => pendientes.size === 0, 'La pantalla sigue esperando respuestas', 10000);
  await page.waitForTimeout(250);
}
async function paso(nombre, hacer, opciones) {
  assert(!terminando, 'Recorrido interrumpido');
  pantalla = nombre;
  const t = Date.now();
  await hacer();
  await estable();
  assert.deepEqual(errores.splice(0), [], 'Error de navegador o petición no permitida');
  await presentacion(page, opciones);
  resultado.pasos.push({ pantalla: nombre, ancho, segundos: +((Date.now() - t) / 1000).toFixed(2) });
  console.log('OK ' + ancho + ' · ' + nombre);
}
async function ir(ruta) {
  const r = await page.goto(origen + ruta, { waitUntil: 'domcontentloaded' });
  assert(r?.ok(), 'Página no disponible: ' + ruta + ' HTTP ' + r?.status());
}
async function get(ruta) {
  // Las lecturas auxiliares eligen registros existentes; los recorridos usan controles de la UI.
  const r = await context.request.get(origen + ruta, { timeout: 7000 });
  assert(r.ok(), 'Lectura de preparación falló: ' + ruta + ' HTTP ' + r.status());
  const json = await r.json();
  assert(Object.hasOwn(json, 'data'), 'Cambió el contrato de lectura: ' + ruta);
  return json.data;
}
async function escribir(metodo, ruta, validar, accion, registrar = () => {}) {
  assert(!permiso, 'No superponer escrituras');
  const actual = { metodo, ruta, validar, usada: false };
  permiso = actual;
  try {
    const [r] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === ruta && r.request().method() === metodo, {timeout:12000}),
      accion(),
    ]);
    assert(actual.usada, 'La petición no pasó por el permiso esperado');
    assert(r.ok(), metodo + ' ' + ruta + ': HTTP ' + r.status());
    const json = await r.json();
    assert(json.data, 'Respuesta sin datos: ' + ruta);
    await registrar(json.data, json);
    return json.data;
  } finally { permiso = null; }
}
async function patchReal(ruta, data) {
  const r = await context.request.patch(origen + ruta, {data, timeout:7000});
  assert(r.ok(), 'Restauración/preparación: PATCH ' + ruta + ' HTTP ' + r.status());
  return (await r.json()).data;
}
async function restaurarConfig() {
  if (!configuracionPendiente) return;
  const {antes, despues} = configuracionPendiente;
  const actual = await get('/api/config');
  if (actual.templateRecordatorio !== antes) {
    assert.equal(actual.templateRecordatorio, despues, 'La configuración cambió fuera del recorrido; no se pisa');
    await patchReal('/api/config', {templateRecordatorio:antes});
  }
  assert.equal((await get('/api/config')).templateRecordatorio, antes, 'El recordatorio no volvió al texto original');
  configuracionPendiente = null;
  resultado.configuracionRestaurada = true;
}
async function limpiarPacientes() {
  for (const creado of creados) {
    // Una respuesta perdida no debe dejar un alta huérfana: recuperar por su marca única.
    if (!creado.id) {
      const candidatos = await get('/api/pacientes?activo=true&q=' + encodeURIComponent(creado.apellido));
      const coinciden = candidatos.filter(p => p.apellido === creado.apellido && p.notas === marca);
      assert(coinciden.length <= 1, 'Más de un paciente con la marca de esta ejecución');
      creado.id = coinciden[0]?.id;
      if (!creado.id) continue;
    }
    let ficha = await get('/api/pacientes/' + creado.id);
    assert.equal(ficha.paciente.apellido, creado.apellido, 'La marca del paciente cambió; no se modifica');
    for (const t of ficha.turnos) {
      assert.equal(t.notas, marca, 'El paciente recibió un turno ajeno al recorrido');
      if (t.pagoEstado === 'pagado') {
        const r = await context.request.delete(origen + '/api/turnos/' + t.id + '/cobrar', {timeout:7000});
        assert(r.ok(), 'No se pudo deshacer el pago de prueba');
      }
      if (t.estado !== 'cancelado') await patchReal('/api/turnos/' + t.id, {estado:'cancelado'});
    }
    if (ficha.paciente.activo) await patchReal('/api/pacientes/' + creado.id, {activo:false});
    ficha = await get('/api/pacientes/' + creado.id);
    assert.equal(ficha.paciente.activo, false, 'Paciente de prueba todavía activo');
    assert(ficha.turnos.every(t => t.estado === 'cancelado' && t.pagoEstado === 'pendiente'), 'Quedó un turno/pago de prueba sin limpiar');
    creado.limpio = true;
  }
  resultado.datosDePrueba = creados.map(p => ({id:p.id, marca:p.apellido, archivado:p.limpio === true}));
}
async function guardarCaptura() {
  if (!page || page.isClosed()) return;
  await page.screenshot({ path: salida + 'fallo.png', timeout: 4000, mask: [
    page.locator('input, textarea, [contenteditable="true"]'),
    page.getByText(process.env.E2E_USUARIO, { exact: true }),
  ] });
}
function pago(t) {
  return Object.fromEntries(['id', 'estado', 'pagoEstado', 'pagoMetodo', 'pagoFecha', 'tarifaCobrada'].map(k => [k, t[k]]));
}
async function leerCobro() {
  const ficha = await get('/api/pacientes/' + cobro.pacienteId);
  const turno = ficha.turnos.find(t => t.id === cobro.antes.id);
  assert(turno, 'No se encuentra el turno de prueba');
  return pago(turno);
}
async function restaurar() {
  if (!cobro?.intentado) return;
  let actual = await leerCobro();
  if (JSON.stringify(actual) !== JSON.stringify(cobro.antes)) {
    // Si otra persona cambió el pago, no deshacer su trabajo.
    assert(actual.estado === cobro.antes.estado && actual.tarifaCobrada === cobro.antes.tarifaCobrada && actual.pagoEstado === 'pagado' && actual.pagoMetodo === 'efectivo', 'El pago cambió fuera de la prueba; requiere revisión manual');
    if (cobro.despues) assert.equal(actual.pagoFecha, cobro.despues.pagoFecha, 'Otro cobro reemplazó al de la prueba');
    else assert(Date.parse(actual.pagoFecha) >= cobro.iniciado - 1000, 'El pago no corresponde a esta ejecución');
    const r = await context.request.delete(origen + '/api/turnos/' + cobro.antes.id + '/cobrar', { timeout: 7000 });
    assert(r.ok(), 'No se pudo revertir el cobro: HTTP ' + r.status());
    actual = await leerCobro();
  }
  assert.deepEqual(actual, cobro.antes, 'El pago no volvió a su estado anterior');
  resultado.restauracion = { verificada: true, turnoId: cobro.antes.id };
  cobro.intentado = false;
}
async function finalizar(error) {
  if (terminando) return;
  terminando = true;
  clearTimeout(limite);
  if (error) {
    resultado.error = { pantalla, ancho, mensaje: redactar(error.message) };
    if (errores.length) resultado.erroresNavegador = errores.map(redactar);
    await guardarCaptura().catch(() => {});
  }
  await page?.close().catch(() => {});
  for (const [nombre, tarea] of [['pago',restaurar],['configuracion',restaurarConfig],['pacientes',limpiarPacientes]]) {
    try { await tarea(); }
    catch (e) {
      (resultado.erroresDeLimpieza ??= []).push({tarea:nombre,mensaje:redactar(e.message)});
      error ??= e;
    }
  }
  resultado.datosDePrueba = creados.map(p => ({id:p.id, turnoId:p.turnoId, marca:p.apellido, archivado:p.limpio === true}));
  resultado.segundos = +((Date.now() - inicio) / 1000).toFixed(2);
  resultado.ok = !error;
  await writeFile(salida + 'resultado.json', JSON.stringify(resultado, null, 2) + '\n');
  await browser?.close().catch(() => {});
  clearTimeout(limiteDuro);
  console.log((error ? 'FALLO' : 'VERDE') + ' · ' + resultado.segundos + ' s · pruebas/e2e/resultados/resultado.json');
  if (error) console.error(redactar(error.message));
  if (resultado.erroresDeLimpieza?.length) console.error('ATENCIÓN: revisar el turno ' + (cobro?.antes.id ?? marca) + '; la reversión NO quedó confirmada.');
  process.exitCode = error ? 1 : 0;
}
process.once('SIGINT', () => { void finalizar(new Error('Interrumpido; se intentó limpiar configuración, pago y pacientes')); });
process.once('SIGTERM', () => { void finalizar(new Error('Interrumpido; se intentó limpiar configuración, pago y pacientes')); });

async function publicas() {
  await paso('Entrada', async () => {
    await ir('/login');
    await visible(page.getByLabel('Email', { exact: true }));
    await visible(page.getByLabel('Contraseña', { exact: true }));
    await alcanzable(boton('Entrar'));
    await visible(page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }));
  });
  await paso('Recuperación, sin enviar correo', async () => {
    await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
    await visible(page.getByLabel('Email', { exact: true }));
    await alcanzable(page.locator('button[type="submit"]').filter({ visible: true }).first());
  });
  await paso('Invitación sin token', async () => {
    await ir('/registro');
    await visible(page.getByText('Este enlace venció o ya se usó.', { exact: true }).first());
    await visible(page.getByRole('link', { name: /entrar|entrada/i }).first());
  }, {alertasEsperadas: [/^Este enlace venció o ya se usó\.[\s\S]*Pedile otro a quien te invitó$/]});
  await paso('Restablecer sin token', async () => {
    await ir('/restablecer');
    await visible(page.getByText(/enlace|link/i).first());
  }, {alertasEsperadas: [/^Este enlace venció o ya se usó\. Pedí uno nuevo\.$/]});
  await paso('Términos', async () => {
    await ir('/terminos');
    await visible(page.getByRole('heading', { name: /términos/i }).first());
  });
}

async function pacientes() {
  const prueba = {apellido:marca + '-' + ancho};
  creados.push(prueba);
  await paso('Pacientes y búsqueda vacía', async () => {
    await page.getByRole('link', { name: 'Pacientes', exact: true }).filter({ visible: true }).first().click();
    await visible(page.getByRole('heading', { name: 'Pacientes', exact: true }));
    const buscar = page.getByRole('textbox', { name: /buscar/i });
    await buscar.fill('E2E_SIN_COINCIDENCIAS_947361');
    await visible(page.getByText(/no encontramos|no hay resultados|sin resultados|ningún paciente/i).first());
    await buscar.fill('');
  });
  await paso('Pacientes archivados', async () => {
    await page.getByRole('tab', { name: 'Archivados', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Archivados', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Activos', exact: true }).click();
  });
  await paso('Alta real: validar, guardar y releer', async () => {
    await boton('Nuevo paciente').click();
    const d = dialogo();
    await visible(d.getByRole('heading', { name: 'Nuevo paciente' }));
    await boton('Crear paciente', d).click();
    await visible(d.getByText('Ingresá el nombre', { exact: true }));
    await visible(d.getByText('Ingresá el apellido', { exact: true }));
    await visible(d.getByText('Ingresá el teléfono', { exact: true }));
    await d.getByLabel('Nombre', { exact: true }).fill('Prueba E2E');
    await d.getByLabel('Apellido', { exact: true }).fill(prueba.apellido);
    await d.getByLabel('Teléfono', { exact: true }).fill('+12025550123');
    await d.getByLabel('Email (opcional)', { exact: true }).fill('invalido');
    await d.getByLabel('Tarifa por sesión', { exact: true }).fill('-1');
    await boton('Crear paciente', d).click();
    await visible(d.getByText('Email inválido', { exact: true }));
    await visible(d.getByText('La tarifa debe ser mayor a 0', { exact: true }));
    await d.getByLabel('Email (opcional)', { exact: true }).fill('prueba@example.invalid');
    await d.getByLabel('Tarifa por sesión', { exact: true }).fill('1500');
    await d.getByLabel('Notas (opcional)', {exact:true}).fill(marca);
    if (ancho === 390) await page.setViewportSize({ width: 390, height: 500 });
    await alcanzable(boton('Crear paciente', d));
    await escribir('POST', '/api/pacientes', body => {
      assert.equal(body.nombre, 'Prueba E2E'); assert.equal(body.apellido, prueba.apellido); assert.equal(body.notas, marca);
    }, () => boton('Crear paciente', d).click(), paciente => {prueba.id = paciente.id;});
    await d.waitFor({state:'hidden'});
    prueba.paciente = (await get('/api/pacientes/' + prueba.id)).paciente;
    assert.equal(prueba.paciente.apellido, prueba.apellido);
    assert.equal(prueba.paciente.tarifa, 1500);
    if (ancho === 390) await page.setViewportSize({ width: 390, height: 844 });
  });
  return prueba;
}

async function agenda(prueba) {
  await paso('Agenda: día y navegación', async () => {
    await page.getByRole('link', { name: 'Agenda', exact: true }).filter({ visible: true }).first().click();
    await visible(page.getByRole('heading', { name: 'Agenda', exact: true }));
    await boton('Anterior').click();
    await boton('Siguiente').click();
    await boton('Hoy').click();
  });
  if (ancho === 1280) for (const modo of ['Semana', 'Mes', 'Día']) {
    await paso('Agenda: ' + modo, async () => {
      const tab = page.getByRole('tab', { name: modo, exact: true });
      await tab.click(); assert.equal(await tab.getAttribute('aria-selected'), 'true');
    });
  } else await paso('Agenda móvil: abrir y cerrar el mes', async () => {
    const desplegar = page.locator('button[aria-controls="agenda-mes-mobile"]');
    await desplegar.click(); await visible(page.locator('#agenda-mes-mobile'));
    await desplegar.click();
  });
  await paso('Agendar real: guardar turno pasado sin recordatorio', async () => {
    await boton('Agendar').click();
    const d = dialogo();
    await visible(d.getByLabel('Paciente', { exact: true }));
    await boton('Agendar', d).click();
    await visible(d.getByText('Elegí un paciente', { exact: true }));
    await d.getByLabel('Paciente', { exact: true }).fill(prueba.apellido);
    await d.getByRole('option').filter({ hasText: prueba.apellido }).first().click();
    const fecha = new Date(Date.now() - 3 * 86400000).toISOString().slice(0,10);
    const desde = fecha + 'T00:00:00-03:00';
    const hasta = fecha + 'T23:59:59-03:00';
    const ocupados = await get('/api/turnos?desde=' + encodeURIComponent(desde) + '&hasta=' + encodeURIComponent(hasta));
    const hora = Array.from({length:24},(_,i) => (8 + Math.floor(i/2)).toString().padStart(2,'0') + (i%2 ? ':30' : ':00')).find(h => {
      const inicio = Date.parse(fecha + 'T' + h + ':00-03:00');
      return ocupados.every(t => !['programado','realizado'].includes(t.estado) || inicio + 50*60000 <= Date.parse(t.fecha) || inicio >= Date.parse(t.fecha) + t.duracion*60000);
    });
    assert(hora, 'No hay un hueco de prueba en el día pasado elegido');
    await d.getByLabel('Fecha', { exact: true }).fill(fecha);
    await d.getByLabel('Hora', { exact: true }).fill(hora);
    await d.getByLabel('Notas (opcional)', {exact:true}).fill(marca);
    if (ancho === 390) await page.setViewportSize({ width: 390, height: 500 });
    await alcanzable(boton('Agendar', d));
    await escribir('POST', '/api/turnos', body => {
      assert.equal(body.pacienteId, prueba.id); assert.equal(body.notas, marca);
      assert(Date.parse(body.fecha) < Date.now(), 'No crear turnos futuros: podrían generar SMS');
    }, () => boton('Agendar', d).click(), (turno,json) => {
      prueba.turnoId = turno.id;
      assert.equal(json.recordatorio, null, 'Se programó un recordatorio inesperado');
    });
    await d.waitFor({state:'hidden'});
    const guardado = (await get('/api/pacientes/' + prueba.id)).turnos.find(t => t.id === prueba.turnoId);
    assert(guardado && guardado.notas === marca && guardado.estado === 'programado', 'El turno no quedó guardado');
    if (ancho === 390) await page.setViewportSize({ width: 390, height: 844 });
  });
}

async function ficha(datos, prueba) {
  await paso('Ficha: sesiones', async () => {
    await ir('/pacientes/' + datos.paciente.id);
    await visible(page.getByRole('tab', { name: 'Sesiones', exact: true }));
    await visible(page.locator('a[href="/sesiones/' + datos.sesion.sesionClinicaId + '"]'));
  }, {alertasEsperadas:[/^Señal de riesgo\s/i]});
  await paso('Ficha: Recorrido', async () => {
    await page.getByRole('tab', { name: 'Recorrido', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name:'Recorrido', exact:true }).getAttribute('aria-selected'), 'true');
    await visible(page.getByText(/El hilo|Todavía no|primera sesión/i).filter({visible:true}).first());
  });
  await paso('Ficha: datos, autorización y pagos', async () => {
    await page.getByRole('tab', { name: 'Ficha', exact: true }).click();
    await visible(page.getByText('Teléfono', { exact: true }).first());
    await boton(/^Turnos y pagos/).click();
    await visible(page.getByText(/min$/).first());
    await visible(boton('Archivar paciente'));
  });
  await paso('Editar paciente de prueba: guardar y releer', async () => {
    await ir('/pacientes/' + prueba.id);
    await boton('Editar datos').click();
    const d = dialogo();
    await visible(d.getByLabel('Nombre', { exact: true }));
    await d.getByLabel('Nombre', {exact:true}).fill('Prueba E2E editada');
    if (ancho === 390) await page.setViewportSize({width:390,height:500});
    await alcanzable(boton('Guardar cambios', d));
    await escribir('PATCH', '/api/pacientes/' + prueba.id, body => {
      assert.equal(body.nombre, 'Prueba E2E editada'); assert.equal(body.apellido, prueba.apellido);
    }, () => boton('Guardar cambios', d).click());
    await d.waitFor({state:'hidden'});
    assert.equal((await get('/api/pacientes/' + prueba.id)).paciente.nombre, 'Prueba E2E editada');
    if (ancho === 390) await page.setViewportSize({width:390,height:844});
  });
  await paso('Nota aprobada', async () => {
    await ir('/sesiones/' + datos.sesion.sesionClinicaId);
    await visible(page.getByText('Nota guardada', { exact: true }).first());
    await visible(page.getByRole('tab', { name: 'Para vos', exact:true }));
  }, {alertasEsperadas:[/^Señal de riesgo\s/i]});
  await paso('Para vos', async () => {
    await page.getByRole('tab', { name: 'Para vos', exact:true }).click();
    await visible(page.getByText(/Para vos/, { exact: true }).first());
    await visible(page.getByRole('tab', { name: 'Nota clínica', exact:true }));
  });
}

async function configuracion() {
  await paso('Tu consultorio: secciones y vista previa', async () => {
    await ir('/config');
    for (const texto of ['Vos', 'Vocabulario', 'Cuenta']) await visible(page.getByText(texto, { exact: true }).first());
    await visible(page.getByLabel('Nombre', { exact: true }));
    await visible(page.getByRole('region', { name: 'Vista previa del SMS' }));
    await visible(page.getByText('Cambiar contraseña', {exact:true}).first());
  });
  await paso('Vocabulario: abrir las listas', async () => {
    for (const nombre of ['De todas tus sesiones','Tuyo']) {
      const b = boton(new RegExp('^' + nombre)); await b.click(); assert.equal(await b.getAttribute('aria-expanded'), 'true');
    }
  });
  await paso('Cuenta: contraseña inválida sin envío', async () => {
    await boton('Cambiar contraseña').click();
    await page.getByLabel('Contraseña actual', {exact:true}).fill('valor-de-prueba');
    await page.getByLabel('Contraseña nueva', {exact:true}).fill('otra-clave-de-prueba');
    await page.getByLabel('Repetila', {exact:true}).fill('no-coincide');
    await boton('Cambiar contraseña').click();
    await visible(page.getByText('Las dos contraseñas nuevas no coinciden.', {exact:true}));
    await boton('Cancelar').click();
  });
  await paso('Recordatorio real: guardar, releer y restaurar', async () => {
    const actual = await get('/api/config');
    assert.equal(actual.templateRecordatorio, actual.templateRecordatorio.trim(), 'La plantilla no admite restauración exacta con este contrato');
    configuracionPendiente = {antes:actual.templateRecordatorio, despues:'Prueba ' + marca + ' {{nombre}}'};
    const editor = page.locator('[contenteditable="true"]').first();
    await visible(editor);
    await escribir('PATCH', '/api/config', body => {
      assert.deepEqual(Object.keys(body), ['templateRecordatorio']);
      assert.equal(body.templateRecordatorio, configuracionPendiente.despues);
    }, () => editor.fill(configuracionPendiente.despues));
    await visible(page.getByText('Guardado.', { exact: true }).first());
    assert.equal((await get('/api/config')).templateRecordatorio, configuracionPendiente.despues);
    await restaurarConfig();
    await ir('/config');
  });
}

async function ayuda() {
  await paso('Lupita: abrir, preguntar y cerrar', async () => {
    await boton('Lupita').click();
    const d = dialogo();
    const pregunta = d.getByRole('textbox');
    await visible(pregunta);
    if (ancho === 390) await page.setViewportSize({ width: 390, height: 500 });
    const preguntas = ancho === 1280 ? ['cómo cobro', 'qué pasa si se corta la grabación'] : ['cómo archivo una paciente'];
    for (const texto of preguntas) {
    await pregunta.fill(texto);
    const enviar = d.locator('button[type="submit"]');
    await alcanzable(enviar);
    const mensajes = d.getByRole('log').locator('p').filter({hasText:'Lupita:'});
    const anteriores = await mensajes.count();
    const respuesta = page.waitForResponse(r => new URL(r.url()).pathname === '/api/ayuda' && r.request().method() === 'POST', { timeout: 30000 });
    await enviar.click();
    const r = await respuesta; assert(r.ok(), 'Lupita respondió HTTP ' + r.status());
    await esperar(async () => await mensajes.count() === anteriores + 1 && (await mensajes.last().innerText()).length > 30, 'Lupita no mostró una respuesta nueva', 30000);
    // El formulario vuelve a habilitarse solo cuando la app terminó de leer el stream.
    // Network.requestfinished puede quedar pendiente aunque el lector ya haya cerrado.
    await pregunta.fill('Comprobar disponibilidad, sin enviar');
    await esperar(() => enviar.isEnabled(), 'Lupita no terminó su respuesta', 30000);
    await pregunta.fill('');
    assert.equal(await d.getByRole('alert').count(), 0, 'Lupita mostró un error');
    }
    await boton('Cerrar', d).click();
    if (ancho === 390) await page.setViewportSize({ width: 390, height: 844 });
  });
}

async function cobrarYDeshacer(prueba) {
  assert(prueba.turnoId);
  await patchReal('/api/turnos/' + prueba.turnoId, {estado:'realizado'});
  const datos = {deuda:await get('/api/pacientes/' + prueba.id)};
  await paso('Cobrar y deshacer: base restituida', async () => {
    await ir('/pacientes/' + datos.deuda.paciente.id);
    await page.getByRole('tab', { name: 'Ficha', exact: true }).click();
    await boton(/^Turnos y pagos/).click();
    const filas = page.locator('li').filter({ has: page.getByRole('button', { name: 'Cobrar', exact: true }) });
    // El orden de la lista es por fecha descendente. Elegir un turno ya realizado evita cambiar su estado al cobrar.
    const ordenados = datos.deuda.turnos.filter(t => t.estado === 'realizado' && t.pagoEstado === 'pendiente').sort((a,b) => Date.parse(b.fecha) - Date.parse(a.fecha));
    const elegido = ordenados.find(t => t.pagoMetodo === null && t.pagoFecha === null && t.tarifaCobrada > 0);
    assert(elegido, 'Falta un turno realizado, sin cobrar y con datos de pago vacíos');
    const fila = filas.nth(ordenados.indexOf(elegido));
    cobro = { pacienteId: datos.deuda.paciente.id, antes: pago(elegido), intentado: false };
    assert.deepEqual(await leerCobro(), cobro.antes, 'El turno cambió desde la preparación');
    await fila.getByRole('button', { name: 'Cobrar', exact: true }).click();
    await alcanzable(boton('Efectivo', dialogo()));
    cobro.iniciado = Date.now(); cobro.intentado = true;
    const respuesta = page.waitForResponse(r => new URL(r.url()).pathname === '/api/turnos/' + elegido.id + '/cobrar' && r.request().method() === 'POST');
    await boton('Efectivo', dialogo()).click();
    assert((await respuesta).ok(), 'Falló el cobro');
    cobro.despues = await leerCobro();
    assert.equal(cobro.despues.pagoEstado, 'pagado');
    await dialogo().waitFor({ state: 'hidden' });
    // La fila sigue en el mismo índice del historial, ahora con Deshacer.
    const todas = page.locator('li').filter({ has: page.getByText(/min$/) });
    const totalOrdenados = [...datos.deuda.turnos].sort((a,b) => Date.parse(b.fecha) - Date.parse(a.fecha));
    const filaPagada = todas.nth(totalOrdenados.findIndex(t => t.id === elegido.id));
    await filaPagada.getByRole('button', { name: 'Deshacer cobro', exact: true }).click();
    const deshecho = page.waitForResponse(r => new URL(r.url()).pathname === '/api/turnos/' + elegido.id + '/cobrar' && r.request().method() === 'DELETE');
    await filaPagada.getByRole('button', { name: 'Deshacer el cobro', exact: true }).click();
    assert((await deshecho).ok(), 'Falló Deshacer cobro');
    await restaurar();
  });
}

async function preparar() {
  const lista = (await get('/api/pacientes?activo=true')).sort((a,b) => Date.parse(b.ultimaSesion || 0) - Date.parse(a.ultimaSesion || 0));
  assert(lista.length, 'La cuenta necesita pacientes inventados');
  let paciente, sesion;
  // Sin IDs ni nombres fijos; hasta 40 pacientes, cuatro lecturas simultáneas.
  for (let i = 0; i < Math.min(lista.length, 40) && !sesion; i += 4) {
    const lote = await Promise.all(lista.slice(i, i + 4).map(async p => {
      const [f, docs] = await Promise.all([get('/api/pacientes/' + p.id), get('/api/pacientes/' + p.id + '/documentacion?page=1&limit=10')]);
      return { f, docs };
    }));
    for (const { f, docs } of lote) {
      const aprobada = docs.sesiones.find(s => s.estado === 'aprobado' && s.datosEstructurados?.feedbackTerapeuta);
      if (!sesion && aprobada) { paciente = f.paciente; sesion = aprobada; }
    }
  }
  assert(sesion, 'La cuenta necesita una nota aprobada con Para vos para recorrer esas pantallas');
  return { paciente, sesion };
}

try {
  browser = await chromium.launch({ headless: true, handleSIGINT:false, handleSIGTERM:false });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-UY', timezoneId: 'America/Montevideo', serviceWorkers: 'block' });
  context.setDefaultTimeout(7000); context.setDefaultNavigationTimeout(15000);
  await context.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url()); const metodo = r.method();
    if (terminando && !['GET','HEAD','OPTIONS'].includes(metodo)) return route.abort();
    if (['GET','HEAD','OPTIONS'].includes(metodo)) return route.continue();
    if (u.origin === origen && u.pathname === '/api/auth/callback/credentials' && metodo === 'POST') {
      const body = new URLSearchParams(r.postData());
      if (body.get('email') !== process.env.E2E_USUARIO || body.get('password') !== process.env.E2E_PASSWORD) {
        errores.push('El formulario de ingreso no envió los valores del entorno');
        return route.abort();
      }
      return route.continue();
    }
    if (u.origin === origen && ['/api/ayuda','/api/csp-report'].includes(u.pathname) && metodo === 'POST') return route.continue();
    if (u.origin === origen && permiso && !permiso.usada && metodo === permiso.metodo && u.pathname === permiso.ruta) {
      try { permiso.validar(r.postDataJSON()); permiso.usada = true; return route.continue(); }
      catch (e) { errores.push('Formulario: ' + e.message); return route.abort(); }
    }
    if (u.origin === origen && cobro?.intentado && ['POST','DELETE'].includes(metodo) && u.pathname === '/api/turnos/' + cobro.antes.id + '/cobrar') return route.continue();
    errores.push('Escritura bloqueada: ' + metodo + ' ' + u.pathname);
    return route.abort('blockedbyclient');
  });
  page = await context.newPage();
  page.on('pageerror', e => errores.push(redactar(e.message)));
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/') && r.method() === 'GET') pendientes.add(r); });
  page.on('requestfinished', r => pendientes.delete(r));
  page.on('requestfailed', r => { pendientes.delete(r); if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) errores.push('Petición fallida: ' + new URL(r.url()).pathname); });
  page.on('response', r => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/api/')) errores.push('HTTP ' + r.status() + ' ' + new URL(r.url()).pathname); });
  await publicas();
  ancho = 390; await page.setViewportSize({width:390,height:844}); await publicas();
  await paso('Ingreso con la cuenta de prueba', async () => {
    await ir('/login');
    await estable();
    await page.getByLabel('Email', { exact: true }).fill(process.env.E2E_USUARIO);
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_PASSWORD);
    await boton('Entrar').click();
    await esperar(async () => new URL(page.url()).pathname === '/' || (await page.getByRole('alert').filter({visible:true}).allTextContents()).some(t => t.trim().length > 0), 'El ingreso no termina', 15000);
    assert.equal(new URL(page.url()).pathname, '/', 'La app no permitió el ingreso; revisá la disponibilidad de la base y las credenciales');
  });
  const datos = await preparar();
  for (ancho of [1280, 390]) {
    await page.setViewportSize({ width: ancho, height: ancho === 390 ? 844 : 900 });
    await paso('Hoy', async () => { await ir('/'); await visible(page.getByText('Agenda del día', { exact:true })); await alcanzable(boton('Agendar')); });
    const prueba = await pacientes();
    await agenda(prueba);
    await ficha(datos, prueba);
    await paso('Cobros', async () => { await ir('/cobros'); await visible(page.getByRole('heading', {name:'Cobros',exact:true})); await visible(page.getByText(/sin cobrar/i).first()); });
    await paso('Cobros: historial del mes', async () => {
      await page.getByRole('tab', {name:'Cobros del mes',exact:true}).click();
      assert.equal(await page.getByRole('tab', {name:'Cobros del mes',exact:true}).getAttribute('aria-selected'), 'true');
      await page.getByRole('tab', {name:'Te deben',exact:true}).click();
    });
    for (const ruta of ['/deudores','/finanzas']) await paso('Enlace anterior: ' + ruta, async () => {await ir(ruta); await page.waitForURL(origen + '/cobros');});
    await configuracion();
    await ayuda();
    await cobrarYDeshacer(prueba);
    await limpiarPacientes();
  }
  resultado.omitidos.push('Grabación, audio, SMS, correos y cambios de contraseña; no se ejecutan.', 'Registro y restablecimiento con token vigente; se revisan pantallas sin token.', 'Estados que la cuenta no tiene (fallido/vacíos/solapes), calidad clínica y respuestas de IA.', 'Teclado y dispositivos físicos, Safari/Firefox, contraste y recortes con ellipsis intencionales.', 'El archivo y la cancelación conservan registros de prueba e historial de auditoría; no hay borrado físico en esta versión.');
  await finalizar();
} catch (error) { await finalizar(error); }
