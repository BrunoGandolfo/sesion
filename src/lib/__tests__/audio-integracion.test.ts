import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { conectarBaseDeTest, vaciarTablas } from "./db-test";
import { conectarArea2 } from "./estados-fixtures";
import { cifrarConsentimiento } from "@/lib/prisma-encryption";
import { claveAudio, confirmarSegmento, estadoAudio, finalizarAudio, leerSesionPorTurno, prepararAudio, reservarSegmento, type ObjetosAudio } from "@/app/api/_lib/casos-uso/audio";
import { renovarLease } from "@/app/api/_lib/casos-uso/sesion/renovar-lease";
import { registrarTranscripcion } from "@/app/api/_lib/casos-uso/sesion/registrar-transcripcion";
import { reclamarSesiones } from "@/app/api/_lib/casos-uso/sesion/reclamar";
let base: ReturnType<typeof conectarBaseDeTest>;
let organizationId: string, turnoId: string;
const descriptor = { indice: 0, inicioMs: 0, iv: Buffer.alloc(12, 1).toString("base64"), bytes: 100, sha256: "a".repeat(64) , continuacion: false };
let recibido = false;
const objetos: ObjetosAudio = { firmar: async key => ({ url: key, headers: {} }), comprobar: async () => ({ existe: recibido, bytes: 100, sha256: descriptor.sha256 }) };
const inicio = () => ({ prisma: base.db, organizationId, turnoId });
const sesion = (sesionId: string) => ({ prisma: base.db, organizationId, sesionId });
beforeAll(() => { base = conectarArea2(); });
afterAll(async () => base.prisma.$disconnect());
beforeEach(async () => {
  recibido = false;
  await vaciarTablas(base.prisma);
  organizationId = (await base.prisma.organization.create({ data: { nombre: "Audio sintético" } })).id;
  const pacienteId = (await base.prisma.paciente.create({ data: { organizationId, nombre: "Prueba", apellido: "Sintética", telefono: "", tarifa: 100 } })).id;
  turnoId = (await base.prisma.turno.create({ data: { organizationId, pacienteId, fecha: new Date("2026-09-15T12:00:00Z"), tarifaCobrada: 100 } })).id;
  const id = crypto.randomUUID();
  await base.prisma.consentimientoGrabacion.create({ data: { ...cifrarConsentimiento(id, { textoCompleto: "Prueba", firmaDigital: "Prueba" }), organizationId, pacienteId, textoVersion: "2.0", firmadoEn: new Date("2026-09-15T11:00:00Z") } });
});
test("dos inicios y una respuesta perdida recuperan la misma sesión y clave", async () => {
  const [a, b] = await Promise.all([prepararAudio(inicio()), prepararAudio(inicio())]);
  expect(a.id).toBe(b.id);
  const clave = await claveAudio(sesion(a.id));
  await prepararAudio(inicio());
  expect(await claveAudio(sesion(a.id))).toEqual(clave);
  const fila = await base.prisma.sesionClinica.findUniqueOrThrow({ where: { id: a.id } });
  expect(Buffer.from(fila.audioClaveEncrypted!).toString()).not.toContain(clave.clave);
});
test("rechaza otra cuenta, descriptor distinto y huecos sin reemplazar el audio", async () => {
  const { id } = await prepararAudio(inicio());
  await expect(claveAudio({ ...sesion(id), organizationId: "otra" })).rejects.toMatchObject({ status: 404 });
  await reservarSegmento({ ...sesion(id), descriptor, objetos });
  await expect(reservarSegmento({ ...sesion(id), descriptor: { ...descriptor, sha256: "b".repeat(64) }, objetos })).rejects.toMatchObject({ status: 409 });
  await expect(reservarSegmento({ ...sesion(id), descriptor: { ...descriptor, indice: 2 }, objetos })).rejects.toMatchObject({ status: 409 });
  expect((await estadoAudio(sesion(id))).segmentos[0].sha256).toBe(descriptor.sha256);
});
test("no procesa hasta confirmar todos; repetir confirmación y cierre no duplica ni retrocede", async () => {
  const { id } = await prepararAudio(inicio());
  await reservarSegmento({ ...sesion(id), descriptor, objetos });
  const cierre = { ...sesion(id), cantidad: 1, duracionAudioSeg: 60, pausas: [] };
  await expect(finalizarAudio(cierre)).rejects.toMatchObject({ status: 409 });
  expect((await estadoAudio(sesion(id))).estado).toBe("grabando");
  recibido = true;
  await confirmarSegmento({ ...sesion(id), indice: 0, objetos });
  await confirmarSegmento({ ...sesion(id), indice: 0, objetos });
  const [a, b] = await Promise.all([finalizarAudio(cierre), finalizarAudio(cierre)]);
  expect(a.estado).toBe("procesando"); expect(b.estado).toBe("procesando");
  expect((await base.prisma.turno.findUniqueOrThrow({ where: { id: turnoId } })).estado).toBe("realizado");
  await expect(reservarSegmento({ ...sesion(id), descriptor: { ...descriptor, indice: 1 }, objetos })).rejects.toMatchObject({ status: 409 });
  await base.prisma.sesionClinica.update({ where: { id }, data: { estado: "revision" } });
  expect((await finalizarAudio(cierre)).estado).toBe("revision");
  await expect(finalizarAudio({ ...cierre, duracionAudioSeg: 61 })).rejects.toMatchObject({ status: 409 });
});
test("el fallo de HEAD no marca confirmado ni borra el inventario", async () => {
  const { id } = await prepararAudio(inicio());
  await reservarSegmento({ ...sesion(id), descriptor, objetos });
  await expect(confirmarSegmento({ ...sesion(id), indice: 0, objetos: { ...objetos, comprobar: async () => { throw new Error("red"); } } })).rejects.toThrow("red");
  expect((await estadoAudio(sesion(id))).segmentos[0].confirmado).toBe(false);
});

test("la medida real es inmutable, conserva decimales en Postgres y llega al worker", async () => {
  const { id } = await prepararAudio(inicio());
  const segundo = { ...descriptor, indice: 1, inicioMs: 1100.25 };
  for (const d of [descriptor, segundo]) {
    await reservarSegmento({ ...sesion(id), descriptor: d, objetos });
    recibido = true;
    await confirmarSegmento({ ...sesion(id), indice: d.indice, objetos });
  }
  await expect(reservarSegmento({ ...sesion(id), descriptor: { ...segundo, inicioMs: 1000 }, objetos })).rejects.toMatchObject({ status: 409 });
  expect((await estadoAudio(sesion(id))).segmentos.map(s => s.inicioMs)).toEqual([0, 1100.25]);
  await finalizarAudio({ ...sesion(id), cantidad: 2, duracionAudioSeg: 119, pausas: [] });
  const [trabajo] = await reclamarSesiones({ prisma: base.db, ahora: new Date(), limite: 1, terminosAsr: async () => [] });
  expect(trabajo.audio?.segmentos.map(s => s.inicioMs)).toEqual([0, 1100.25]);
});

test("una pieza de adentro de la corrida se guarda como continuación y llega así al worker", async () => {
  const { id } = await prepararAudio(inicio());
  await reservarSegmento({ ...sesion(id), descriptor, objetos });
  recibido = true;
  await confirmarSegmento({ ...sesion(id), indice: 0, objetos });
  const segunda = { ...descriptor, indice: 1, inicioMs: 60_000, continuacion: true };
  await reservarSegmento({ ...sesion(id), descriptor: segunda, objetos });
  await confirmarSegmento({ ...sesion(id), indice: 1, objetos });
  // Declarar otra continuación para la misma pieza es un desacuerdo, no un reintento.
  await expect(reservarSegmento({ ...sesion(id), descriptor: { ...segunda, continuacion: false }, objetos })).rejects.toMatchObject({ status: 409 });
  expect((await estadoAudio(sesion(id))).segmentos.map(s => s.continuacion)).toEqual([false, true]);
  await finalizarAudio({ ...sesion(id), cantidad: 2, duracionAudioSeg: 120, pausas: [] });
  const [trabajo] = await reclamarSesiones({ prisma: base.db, ahora: new Date(), limite: 1, terminosAsr: async () => [] });
  expect(trabajo.audio?.segmentos.map(s => s.continuacion)).toEqual([false, true]);
});

test("una fila anterior sin medida permanece nula y no se procesa inventando el segundo nominal", async () => {
  const { id } = await prepararAudio(inicio());
  await base.prisma.audioSegmento.create({ data: { organizationId, sesionId: id, indice: 0, iv: Buffer.alloc(12), bytes: 100, sha256: descriptor.sha256, confirmadoEn: new Date() } });
  expect((await estadoAudio(sesion(id))).segmentos[0].inicioMs).toBeNull();
  await expect(finalizarAudio({ ...sesion(id), cantidad: 1, duracionAudioSeg: 60, pausas: [] })).rejects.toMatchObject({ status: 409 });
  expect((await estadoAudio(sesion(id))).estado).toBe("grabando");
  expect((await base.prisma.audioSegmento.findFirstOrThrow()).inicioMs).toBeNull();
});

test("el cierre persiste las interrupciones y la API clínica las devuelve completas", async () => {
  const { id } = await prepararAudio(inicio());
  await reservarSegmento({ ...sesion(id), descriptor, objetos });
  recibido = true;
  await confirmarSegmento({ ...sesion(id), indice: 0, objetos });
  const pausas = [{ inicio: 60_000, fin: null, siguienteIndice: 1, motivo: "interrupcion" as const }];
  await finalizarAudio({ ...sesion(id), cantidad: 1, duracionAudioSeg: 60, pausas });
  expect((await leerSesionPorTurno(inicio()))?.pausas).toEqual(pausas);
});

test("la migración solo agrega la columna nullable y deja intacta la fila existente", async () => {
  const sql = readFileSync("prisma/migrations/20260915190000_audio_inicio_ms/migration.sql", "utf8");
  // Solo este ALTER autorizado se ejecuta sobre una tabla temporal de prueba.
  expect(sql.replace(/--[^\n]*/g, "").trim()).toBe('ALTER TABLE "audio_segmentos" ADD COLUMN "inicio_ms" DOUBLE PRECISION;');
  await base.prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TEMPORARY TABLE audio_segmentos (indice integer, contenido text) ON COMMIT DROP');
    await tx.$executeRawUnsafe("INSERT INTO pg_temp.audio_segmentos VALUES (7, 'dato sintético que se conserva')");
    const antes = await tx.$queryRawUnsafe<{ indice: number; contenido: string; version: string; ubicacion: string }[]>('SELECT *, xmin::text AS version, ctid::text AS ubicacion FROM pg_temp.audio_segmentos');
    await tx.$executeRawUnsafe(sql);
    const despues = await tx.$queryRawUnsafe<{ indice: number; contenido: string; inicio_ms: null; version: string; ubicacion: string }[]>('SELECT indice, contenido, inicio_ms, xmin::text AS version, ctid::text AS ubicacion FROM pg_temp.audio_segmentos');
    expect(despues).toEqual([{ ...antes[0], inicio_ms: null }]);
    const columnas = await tx.$queryRawUnsafe<{ nombre: string; requerido: boolean; defecto: boolean }[]>("SELECT attname AS nombre, attnotnull AS requerido, atthasdef AS defecto FROM pg_attribute WHERE attrelid = 'pg_temp.audio_segmentos'::regclass AND attnum > 0 ORDER BY attnum");
    expect(columnas).toEqual([{ nombre: "indice", requerido: false, defecto: false }, { nombre: "contenido", requerido: false, defecto: false }, { nombre: "inicio_ms", requerido: false, defecto: false }]);
  });
});


test("los huecos detectados llegan a la lectura clínica y sobreviven al reclamo con checkpoint", async () => {
  const { id } = await prepararAudio(inicio());
  await reservarSegmento({ ...sesion(id), descriptor, objetos });
  recibido = true;
  await confirmarSegmento({ ...sesion(id), indice: 0, objetos });
  const manual = { inicio: 60_000, fin: null, siguienteIndice: 1, motivo: "manual" as const };
  await finalizarAudio({ ...sesion(id), cantidad: 1, duracionAudioSeg: 60, pausas: [manual] });
  const [reclamo] = await reclamarSesiones({ prisma: base.db, ahora: new Date(), limite: 1, terminosAsr: async () => [] });
  const hueco = { inicio: 59_800, fin: 60_000, siguienteIndice: 1, motivo: "interrupcion" as const };
  const checkpoint = { ...sesion(id), intento: reclamo.intento, transcripcion: "Audio sintético", modeloAsr: "prueba", registrarAuditoria: async () => {} };
  const aviso = { ...sesion(id), intento: reclamo.intento, pausasAudio: [manual, hueco] };
  await renovarLease(aviso);
  await renovarLease(aviso);
  expect((await leerSesionPorTurno(inicio()))?.pausas).toEqual([manual, hueco]);
  await registrarTranscripcion(checkpoint);
  expect((await leerSesionPorTurno(inicio()))?.pausas).toEqual([manual, hueco]);
  await expect(renovarLease({ ...aviso, intento: reclamo.intento - 1, pausasAudio: [] })).rejects.toMatchObject({ status: 409 });
  const [reintento] = await reclamarSesiones({ prisma: base.db, ahora: new Date(Date.now() + 86400000), limite: 1, terminosAsr: async () => [] });
  expect(reintento.audio).toBeNull();
  expect(reintento.checkpoint?.transcripcion).toBe("Audio sintético");
  expect((await leerSesionPorTurno(inicio()))?.pausas).toEqual([manual, hueco]);
});
