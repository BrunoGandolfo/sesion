// La grabación de verdad, en Chromium con micrófono falso, contra la app local
// (next dev + Postgres local) — ver README.md de esta carpeta para levantarla.
//
//   A. Una grabación con una pausa y un cambio de pestaña deja en
//      eventos_auditoria.detalle un "diagnostico" con esos eventos.
//   B. Una grabación de 3 segundos no sube nada ni crea trabajo de
//      transcripción, y el turno queda listo para grabar de nuevo.
//
// R2 no existe en local: este guion levanta un S3 falso, le entrega el PUT
// del navegador (context.route) y el servidor le pregunta por el objeto a
// través de r2-falso-preload.cjs. Todo lo demás es la app real.
//
//   node --env-file=.env pruebas/grabador-ajustes/verificar.mjs --url=http://localhost:3137

import assert from "node:assert/strict";
import http from "node:http";

import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const url = (process.argv.find((a) => a.startsWith("--url=")) ?? "--url=http://localhost:3137").slice(6);
const USUARIO = "profesional@sesion.test";
const PASSWORD = "sesion-dev-1234";
const PACIENTE_A = "aaaaaaaa-0001-4000-8000-000000000001";
const PACIENTE_B = "aaaaaaaa-0002-4000-8000-000000000002";

assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/sesion_e2e_/, "Sólo contra una base sesion_e2e_*");
assert.match(new URL(process.env.DATABASE_URL).hostname, /^(127\.0\.0\.1|localhost)$/, "Sólo contra una base local");

// ─── S3 falso ────────────────────────────────────────────────────────────
const objetos = new Map();
const s3 = http.createServer((req, res) => {
  const clave = new URL(req.url, "http://s3").pathname;
  if (req.method === "PUT") {
    const partes = [];
    req.on("data", (p) => partes.push(p));
    req.on("end", () => { objetos.set(clave, Buffer.concat(partes)); res.writeHead(200, { etag: '"falso"' }).end(); });
    return;
  }
  const objeto = objetos.get(clave);
  if (!objeto) return void res.writeHead(404).end();
  res.writeHead(200, { "content-length": objeto.length, "content-type": "audio/webm", etag: '"falso"' }).end();
});
await new Promise((ok) => s3.listen(Number(new URL(process.env.R2_FALSO_URL ?? "http://127.0.0.1:4599").port), "127.0.0.1", ok));

const prisma = new PrismaClient();
const navegador = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const contexto = await navegador.newContext({ permissions: ["microphone"], viewport: { width: 390, height: 844 }, timezoneId: "America/Montevideo" });

// El PUT del navegador a la URL prefirmada: se lo lleva el S3 falso.
const puts = [];
await contexto.route(/r2\.cloudflarestorage\.com/, async (ruta) => {
  const pedido = ruta.request();
  if (pedido.method() !== "PUT") return ruta.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "PUT" } });
  const cuerpo = pedido.postDataBuffer() ?? Buffer.alloc(0);
  puts.push({ url: pedido.url(), bytes: cuerpo.length });
  const destino = new URL(new URL(pedido.url()).pathname, process.env.R2_FALSO_URL ?? "http://127.0.0.1:4599");
  await fetch(destino, { method: "PUT", body: cuerpo });
  await ruta.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", etag: '"falso"' } });
});

const pagina = await contexto.newPage();
const pedidosApi = [];
pagina.on("request", (r) => { if (r.url().includes("/api/")) pedidosApi.push(`${r.method()} ${new URL(r.url()).pathname}`); });
const resultado = {};

try {
  // Entrar con la cuenta del seed.
  await pagina.goto(`${url}/login`);
  await pagina.getByLabel(/correo|email/i).fill(USUARIO);
  await pagina.getByLabel(/contraseña/i).first().fill(PASSWORD);
  await pagina.getByRole("button", { name: /entrar|ingresar/i }).click();
  await pagina.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

  // La autorización de las dos pacientes, por la API real.
  for (const paciente of [PACIENTE_A, PACIENTE_B]) {
    const r = await pagina.evaluate(async ([id]) => {
      const res = await fetch(`/api/pacientes/${id}/consentimiento`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firmaDigital: "Paciente Sintética", textoVersion: "2.6" }) });
      return res.status;
    }, [paciente]);
    assert.ok(r === 201 || r === 200 || r === 409, `consentimiento: HTTP ${r}`);
  }

  // ─── A. Grabación con pausa y cambio de pestaña ────────────────────────
  const inicioA = new Date();
  await pagina.goto(`${url}/grabar/nuevo?pacienteId=${PACIENTE_A}`);
  await pagina.getByRole("button", { name: "Grabar sesión" }).click();
  await pagina.getByRole("button", { name: "Pausar" }).waitFor({ timeout: 60_000 });
  await pagina.waitForTimeout(6_000);
  await pagina.getByRole("button", { name: "Pausar" }).click();
  await pagina.waitForTimeout(2_000);
  await pagina.getByRole("button", { name: "Reanudar" }).click();
  await pagina.waitForTimeout(2_000);
  // Cambio de pestaña de verdad: otra página al frente, y de vuelta.
  const otra = await contexto.newPage();
  await otra.goto("about:blank");
  await otra.bringToFront();
  await pagina.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await otra.waitForTimeout(2_000);
  await pagina.bringToFront();
  await pagina.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await otra.close();
  await pagina.waitForTimeout(5_000);
  await pagina.getByRole("button", { name: "Terminar la sesión" }).click();
  await pagina.getByText("La grabación llegó bien", { exact: false }).waitFor({ timeout: 60_000 });

  const auditoria = await prisma.eventoAuditoria.findMany({ where: { accion: "sesion.subir_audio_fin", creadoEn: { gte: inicioA } }, orderBy: { creadoEn: "desc" }, take: 1 });
  assert.equal(auditoria.length, 1, "no hay sesion.subir_audio_fin");
  const detalle = auditoria[0].detalle;
  resultado.A = { detalle, put: puts.at(-1) };
  assert.ok(Array.isArray(detalle.diagnostico), "detalle.diagnostico no es una lista");
  const tipos = detalle.diagnostico.map((l) => l.split(" ")[1]);
  for (const tipo of ["pausa", "reanudar", "oculta", "visible"]) assert.ok(tipos.includes(tipo), `falta el evento ${tipo}: ${tipos.join(",")}`);
  for (const linea of detalle.diagnostico) assert.match(linea, /^\d{4}-\d\d-\d\dT[\d:.]+Z [a-z-]+( \d+)?$/);
  for (const valor of Object.values(detalle)) assert.ok(valor === null || typeof valor !== "object" || Array.isArray(valor));
  assert.ok(detalle.diagnosticoChunks >= 10 && detalle.diagnosticoBytes > 0);
  assert.equal(puts.at(-1).bytes, detalle.bytes, "lo que salió del navegador no es lo que el servidor contó");

  // ─── B. Tres segundos ─────────────────────────────────────────────────
  const putsAntes = puts.length;
  const inicioB = new Date();
  const trabajosAntes = await prisma.trabajo.count();
  pedidosApi.length = 0;
  await pagina.goto(`${url}/grabar/nuevo?pacienteId=${PACIENTE_B}`);
  await pagina.getByRole("button", { name: "Grabar sesión" }).click();
  await pagina.getByRole("button", { name: "Pausar" }).waitFor({ timeout: 60_000 });
  await pagina.waitForTimeout(3_000);
  await pagina.getByRole("button", { name: "Terminar la sesión" }).click();
  await pagina.getByText("Grabaste menos de 10 segundos. No se guardó nada.").waitFor({ timeout: 10_000 });
  await pagina.waitForTimeout(1_500);

  const sesionesB = await prisma.sesionClinica.findMany({ where: { turno: { pacienteId: PACIENTE_B }, creadaEn: { gte: inicioB } }, select: { id: true, estado: true, audioEstado: true } });
  resultado.B = {
    pedidosApi: [...pedidosApi],
    puts: puts.length - putsAntes,
    trabajosNuevos: (await prisma.trabajo.count()) - trabajosAntes,
    sesiones: sesionesB,
    auditoriaDeSubida: await prisma.eventoAuditoria.count({ where: { entidadId: { in: sesionesB.map((s) => s.id) }, accion: { startsWith: "sesion.subir_audio" } } }),
  };
  assert.equal(resultado.B.puts, 0, "hubo un PUT");
  assert.ok(!pedidosApi.some((p) => p.includes("upload")), `hubo pedidos de subida: ${pedidosApi.join(", ")}`);
  assert.equal(resultado.B.trabajosNuevos, 0, "se creó un trabajo");
  assert.equal(resultado.B.auditoriaDeSubida, 0);
  assert.deepEqual(sesionesB.map((s) => s.estado), ["grabando"]);

  // Y el turno queda listo: graba de nuevo, ahora sí 12 s, sobre la MISMA sesión.
  const boton = pagina.getByRole("button", { name: "Grabar sesión" });
  assert.equal(await boton.isEnabled(), true);
  await boton.click();
  await pagina.getByRole("button", { name: "Pausar" }).waitFor({ timeout: 60_000 });
  await pagina.waitForTimeout(12_500);
  await pagina.getByRole("button", { name: "Terminar la sesión" }).click();
  await pagina.getByText("La grabación llegó bien", { exact: false }).waitFor({ timeout: 60_000 });
  const despues = await prisma.sesionClinica.findMany({ where: { turno: { pacienteId: PACIENTE_B }, creadaEn: { gte: inicioB } }, select: { id: true, estado: true } });
  resultado.B.despuesDeRegrabar = despues;
  assert.equal(despues.length, 1, "quedó una sesión colgada");
  assert.equal(despues[0].id, sesionesB[0].id);
  assert.equal(despues[0].estado, "procesando");

  console.log(JSON.stringify(resultado, null, 2));
  console.log("\nVERDE");
} catch (error) {
  console.log(JSON.stringify(resultado, null, 2));
  console.error("\nROJO:", error);
  process.exitCode = 1;
} finally {
  await navegador.close();
  await prisma.$disconnect();
  s3.close();
}
