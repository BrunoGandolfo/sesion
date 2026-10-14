// La app instalada se abre sin señal. Chromium real contra `next build && next
// start` (la doc de Next: dev no es referencia para el comportamiento sin
// conexión), con micrófono simulado. Comprueba, en este orden:
//
//   1. Con señal: Hoy carga, el service worker queda controlando la página y
//      la agenda local tiene el turno de hoy.
//   2. Con señal: ninguna respuesta de /api/ sale del service worker.
//   3. Sin señal (context.setOffline): /grabar/<turnoId> por URL muestra el
//      nombre de la paciente; "Grabar sesión" arranca el micrófono; al
//      terminar, la grabación queda en el teléfono (flujo sin conexión).
//      "Volver" desde el grabador lleva a la agenda local.
//   4. Sin señal: / muestra la agenda local con su botón Grabar.
//   5. Lo que quedó guardado en el teléfono: las cachés del service worker
//      (sólo /_next/static/** y /sin-conexion) y la agenda local.
//
// Necesita un servidor levantado con una base local sembrada (ver
// pruebas/e2e/README.md, "Base local") y Chromium de Playwright:
//
//   npx playwright install chromium     (o SIN_CONEXION_CANAL=chrome para usar
//                                        el Google Chrome de la máquina)
//   SIN_CONEXION_URL=http://localhost:3147 E2E_USUARIO=profesional@sesion.test \
//     E2E_PASSWORD=sesion-dev-1234 node pruebas/sin-conexion/verificar.mjs
//
// SIN SEÑAL DE VERDAD. `context.setOffline(true)` corta la red de la página,
// pero en Chrome 134 (el de la máquina) NO corta la del service worker: su
// fetch de la navegación llegaba al servidor y /agenda volvía entera
// (verificado el 13-oct-2026). En el teléfono, el modo avión corta las dos.
// Por eso el navegador habla con el servidor a través de un puente TCP de
// este script, y "sin señal" es setOffline(true) MÁS cortar el puente.
//
// Crea un turno de hoy para la primera paciente activa (POST /api/turnos) y
// al final lo cancela. No toca ningún proveedor externo: la subida falla por
// falta de red, que es lo que se prueba.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SERVIDOR = new URL(process.env.SIN_CONEXION_URL ?? "http://localhost:3147");
const USUARIO = process.env.E2E_USUARIO;
const PASSWORD = process.env.E2E_PASSWORD;
assert(USUARIO && PASSWORD, "Faltan E2E_USUARIO y E2E_PASSWORD");

const salida = fileURLToPath(new URL("./resultados/", import.meta.url));
mkdirSync(salida, { recursive: true });
const registro = { pasos: [], apiDesdeServiceWorker: [], apiVistas: 0 };
const paso = (nombre, detalle = {}) => {
  registro.pasos.push({ nombre, ...detalle });
  console.log(`✓ ${nombre}`, Object.keys(detalle).length ? JSON.stringify(detalle) : "");
};

/** Un instante de hoy en Montevideo (UTC-3), unos minutos adelante. */
function horaDeHoy(minutosAdelante) {
  const fecha = new Date(Date.now() + minutosAdelante * 60_000);
  const mvd = (d) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  assert.equal(mvd(fecha), mvd(new Date()), "Muy cerca de la medianoche de Montevideo: correlo más tarde");
  fecha.setUTCSeconds(0, 0);
  return fecha;
}

// El puente: mientras no esté cortado, copia bytes entre el navegador y el
// servidor; cortado, cierra todo y rechaza conexiones nuevas.
const puente = { cortado: false, sockets: new Set() };
const servidorPuente = net.createServer((cliente) => {
  if (puente.cortado) return cliente.destroy();
  const servidor = net.connect(Number(SERVIDOR.port || 80), SERVIDOR.hostname);
  const cerrar = () => {
    cliente.destroy();
    servidor.destroy();
    puente.sockets.delete(cliente);
    puente.sockets.delete(servidor);
  };
  puente.sockets.add(cliente);
  puente.sockets.add(servidor);
  cliente.on("error", cerrar).on("close", cerrar);
  servidor.on("error", cerrar).on("close", cerrar);
  cliente.pipe(servidor).pipe(cliente);
});
await new Promise((ok) => servidorPuente.listen(0, "127.0.0.1", ok));
const URL_BASE = `http://localhost:${servidorPuente.address().port}`;

async function sinSenal(contexto) {
  await contexto.setOffline(true);
  puente.cortado = true;
  for (const socket of puente.sockets) socket.destroy();
}

async function conSenal(contexto) {
  puente.cortado = false;
  await contexto.setOffline(false);
}

const navegador = await chromium.launch({
  channel: process.env.SIN_CONEXION_CANAL || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const contexto = await navegador.newContext({ baseURL: URL_BASE, viewport: { width: 390, height: 844 } });
await contexto.grantPermissions(["microphone"], { origin: URL_BASE });
const pagina = await contexto.newPage();
pagina.on("pageerror", (e) => console.warn("[pageerror]", e.message));

let turnoId = null;
try {
  // ── Ingreso y un turno de hoy ────────────────────────────────────────────
  const entrar = await contexto.request.post("/api/cuenta/entrar", { data: { email: USUARIO, password: PASSWORD } });
  assert.equal(entrar.status(), 200, `ingreso: ${entrar.status()}`);
  const pacientes = (await (await contexto.request.get("/api/pacientes")).json()).data;
  const paciente = pacientes[0];
  assert(paciente, "La cuenta no tiene pacientes activos");
  const nombre = `${paciente.nombre} ${paciente.apellido}`.trim();
  for (const minutos of [3, 33, 63, 93]) {
    const r = await contexto.request.post("/api/turnos", {
      data: { pacienteId: paciente.id, fecha: horaDeHoy(minutos).toISOString(), duracion: 50, modalidad: "presencial" },
    });
    if (r.ok()) {
      turnoId = (await r.json()).data.id;
      break;
    }
  }
  assert(turnoId, "No se pudo crear un turno de hoy");
  paso("turno de hoy creado", { turnoId, paciente: nombre });

  // ── 1. Con señal: Hoy, service worker y agenda local ─────────────────────
  await pagina.goto("/");
  await pagina.getByText(nombre).first().waitFor();
  await pagina.evaluate(() => navigator.serviceWorker.ready);
  // Recargar: la primera carga la atendió la red sin service worker; desde
  // acá todo pasa por él (clientsClaim) y se puede mirar qué sirve.
  pagina.on("response", (respuesta) => {
    if (new URL(respuesta.url()).pathname.startsWith("/api/")) {
      registro.apiVistas += 1;
      if (respuesta.fromServiceWorker()) registro.apiDesdeServiceWorker.push(respuesta.url());
    }
  });
  await pagina.reload();
  await pagina.getByText(nombre).first().waitFor();
  const controla = await pagina.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  assert(controla?.endsWith("/serwist/sw.js"), `controller: ${controla}`);
  const sw = await contexto.request.get("/serwist/sw.js");
  assert.equal(sw.headers()["service-worker-allowed"], "/");
  paso("Hoy con señal y service worker controlando", { controla, cacheControl: sw.headers()["cache-control"] });

  const leerAgenda = () =>
    pagina.evaluate(
      () =>
        new Promise((ok, mal) => {
          const pedido = indexedDB.open("sesion-agenda-local");
          pedido.onerror = () => mal(pedido.error);
          pedido.onsuccess = () => {
            const db = pedido.result;
            if (!db.objectStoreNames.contains("turnos")) return ok([]);
            const todos = db.transaction("turnos").objectStore("turnos").getAll();
            todos.onsuccess = () => ok(todos.result);
          };
        }),
    );
  let agenda = [];
  for (let i = 0; i < 20 && !agenda.some((t) => t.turnoId === turnoId); i += 1) {
    agenda = await leerAgenda();
    await pagina.waitForTimeout(250);
  }
  assert(agenda.some((t) => t.turnoId === turnoId), "El turno de hoy no quedó en la agenda local");
  paso("agenda local escrita por Hoy", { registros: agenda.length });

  // ── 2. Con señal: /api nunca sale del service worker ─────────────────────
  // Navegar a la ficha también pide /api (y escribe la agenda desde ella).
  await pagina.goto(`/pacientes/${paciente.id}`);
  await pagina.getByRole("heading", { name: nombre }).first().waitFor();
  await pagina.goto("/");
  await pagina.getByText(nombre).first().waitFor();
  assert(registro.apiVistas > 0, "No se vio ninguna respuesta de /api");
  assert.deepEqual(registro.apiDesdeServiceWorker, [], "Respuestas de /api servidas por el service worker");
  paso("ninguna respuesta de /api salió del service worker", { vistas: registro.apiVistas });

  // ── 3. Sin señal: /grabar/<turno> por URL ────────────────────────────────
  await sinSenal(contexto);
  await pagina.goto(`/grabar/${turnoId}`);
  await pagina.getByRole("heading", { name: nombre }).waitFor();
  assert.equal(new URL(pagina.url()).pathname, `/grabar/${turnoId}`);
  await pagina.screenshot({ path: path.join(salida, "grabar-sin-senal-390.png") });
  // "Volver" es un <Link> de Next: sin red su pedido RSC falla y la
  // navegación tiene que terminar en la agenda local, no colgada.
  await pagina.getByRole("link", { name: "Volver" }).click();
  await pagina.getByRole("heading", { name: "Sin señal" }).waitFor({ timeout: 15_000 });
  paso("sin señal: Volver desde el grabador lleva a la agenda local", { url: new URL(pagina.url()).pathname });
  await pagina.locator(`a[href="/grabar/${turnoId}"]`).click();
  await pagina.getByRole("heading", { name: nombre }).waitFor();
  await pagina.getByRole("button", { name: "Grabar sesión" }).click();
  await pagina.getByRole("button", { name: "Pausar" }).waitFor();
  await pagina.waitForFunction(() => {
    const reloj = document.querySelector('[aria-label$="segundos grabados"]');
    return reloj && Number.parseInt(reloj.getAttribute("aria-label"), 10) >= 11;
  }, null, { timeout: 30_000 });
  paso("sin señal: grabador con el nombre y el micrófono grabando");
  await pagina.getByRole("button", { name: "Terminar la sesión" }).click();
  await pagina.getByText("La grabación quedó guardada en el teléfono", { exact: false }).waitFor({ timeout: 30_000 });
  paso("sin señal: al terminar, la grabación queda en el teléfono");

  // ── 4. Sin señal: / muestra la agenda local ──────────────────────────────
  await pagina.goto("/");
  await pagina.getByRole("heading", { name: "Sin señal" }).waitFor();
  await pagina.getByText(nombre).first().waitFor();
  const grabar = pagina.getByRole("link", { name: "Grabar" });
  assert((await grabar.count()) >= 1);
  assert(await pagina.locator(`a[href="/grabar/${turnoId}"]`).count(), "Falta el botón Grabar del turno");
  await pagina.screenshot({ path: path.join(salida, "agenda-sin-senal-390.png") });
  await pagina.setViewportSize({ width: 1280, height: 800 });
  await pagina.screenshot({ path: path.join(salida, "agenda-sin-senal-1280.png") });
  paso("sin señal: / muestra la agenda local con Grabar");
  // Y la llamada a la API sin red falla: no hay copia guardada.
  const api = await pagina.evaluate(() => fetch("/api/dashboard").then((r) => r.status, () => "sin red"));
  assert.equal(api, "sin red");
  paso("sin señal: /api no tiene copia en el teléfono");

  // ── 5. Lo que quedó guardado en el teléfono ──────────────────────────────
  const cachés = await pagina.evaluate(async () => {
    const salida = {};
    for (const nombre of await caches.keys()) {
      salida[nombre] = (await (await caches.open(nombre)).keys()).map((r) => new URL(r.url).pathname);
    }
    return salida;
  });
  const urls = Object.values(cachés).flat();
  const ajenas = urls.filter((u) => !u.startsWith("/_next/static/") && u !== "/sin-conexion");
  assert.deepEqual(ajenas, [], "Hay en caché algo que no es estático ni /sin-conexion");
  assert(urls.includes("/sin-conexion"));
  agenda = await leerAgenda();
  registro.guardado = {
    caches: Object.fromEntries(Object.entries(cachés).map(([n, u]) => [n, { entradas: u.length, noEstaticas: u.filter((x) => !x.startsWith("/_next/static/")) }])),
    agendaLocal: agenda,
  };
  paso("en el teléfono: sólo estáticos, /sin-conexion y la agenda local", {
    entradas: urls.length,
    camposAgenda: [...new Set(agenda.flatMap((t) => Object.keys(t)))].sort(),
  });
  registro.resultado = "verde";
} catch (error) {
  registro.resultado = "rojo";
  registro.error = String(error?.stack ?? error);
  await pagina.screenshot({ path: path.join(salida, "fallo.png") }).catch(() => {});
  throw error;
} finally {
  await conSenal(contexto);
  if (turnoId) {
    await contexto.request.patch(`/api/turnos/${turnoId}`, { data: { estado: "cancelado" } }).catch(() => {});
  }
  writeFileSync(path.join(salida, "resultado.json"), JSON.stringify(registro, null, 2));
  await navegador.close();
  servidorPuente.close();
}
