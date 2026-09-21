import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

import { editarHilo, aceptarPropuesta, rechazarPropuesta } from "@/app/api/_lib/casos-uso/hilo/escribir";
import { leerRecorrido, leerHiloParaWorker } from "@/app/api/_lib/casos-uso/hilo/leer";
import { leerBrief } from "@/app/api/_lib/casos-uso/hilo/brief";
import { regenerarHilo } from "@/app/api/_lib/casos-uso/hilo/regenerar";
import { exportarRecorrido } from "@/app/api/_lib/casos-uso/hilo/exportar";
import { crearTrabajo } from "@/app/api/_lib/casos-uso/trabajos/crear";
import { aprobarSesion } from "@/app/api/_lib/casos-uso/sesion/aprobar";
import { entregarTrabajos } from "@/app/api/_lib/casos-uso/trabajos/entregar";
import { reclamarTrabajos } from "@/app/api/_lib/casos-uso/trabajos/reclamar";
import { aplicarResultadoTrabajo } from "@/app/api/_lib/casos-uso/trabajos/resultado-worker";
import { autorizarTicketTrabajo } from "@/app/api/_lib/tickets";
import { hiloVacio } from "@/lib/hilo/contenido";
import { conectarArea2, crearOrg, crearSesion, limpiarOrg, NOTA, pedidoConTicket, type BaseArea2, type Org } from "./estados-fixtures";

let base: BaseArea2;
let org: Org;
const ahora = new Date(Date.now() + 60_000);
const contenido = () => ({ ...hiloVacio(), resumenAcumulativo: "Historia que solo debe existir cifrada" });
const identidad = () => ({ pacienteId: org.pacienteId, organizationId: org.orgId });
const escritura = (basadaEnVersion = 0) => ({ ...identidad(), prisma: base.db, usuarioId: org.userId, basadaEnVersion });
beforeAll(() => { base = conectarArea2(); });
beforeEach(async () => { org = await crearOrg(base.prisma); });
afterEach(async () => { await limpiarOrg(base.prisma, org.orgId); });
afterAll(async () => { await base.prisma.$disconnect(); });

async function aprobar() {
  const { sesionId } = await crearSesion(base.prisma, org, { estado: "revision", audio: false, notaIa: NOTA });
  await aprobarExistente(sesionId);
  return sesionId;
}
async function aprobarExistente(sesionId: string) {
  await aprobarSesion({ prisma: base.db, sesionId, organizationId: org.orgId, usuarioId: org.userId, generacion: 1 });
}
async function reclamar() {
  const entregas = await entregarTrabajos({ prisma: base.db, ahora, limite: 20, tipos: ["integrar_contexto"] });
  expect(entregas).toHaveLength(1);
  const entrega = entregas[0];
  return { entrega, trabajo: await autorizarTicketTrabajo(pedidoConTicket(entrega.ticket), base.db, entrega.trabajoId) };
}
async function proponer() {
  await aprobar();
  const { trabajo } = await reclamar();
  await aplicarResultadoTrabajo({ prisma: base.db, trabajo, resultado: { ok: true, propuesta: contenido(), promptVersion: "contexto_2.1", modeloLlm: "prueba" } });
  return (await leerRecorrido(base.db, identidad())).propuesta!;
}

it("aprobar crea el trabajo, el adjunto usa la nota aprobada y el aplicador cifra la propuesta", async () => {
  const sesionId = await aprobar();
  expect(await base.prisma.trabajo.count({ where: { sesionId, tipo: "integrar_contexto" } })).toBe(1);
  const { entrega, trabajo } = await reclamar();
  expect(entrega.adjunto).toMatchObject({ notaFinal: NOTA, version: 0, contextoVigente: null, fechaSesion: "2026-09-01" });
  await aplicarResultadoTrabajo({ prisma: base.db, trabajo, resultado: { ok: true, propuesta: contenido(), promptVersion: "contexto_2.1", modeloLlm: "prueba" } });
  const r = await leerRecorrido(base.db, identidad());
  expect(r.vigente).toBeNull();
  expect(r.propuesta?.contenido).toEqual(contenido());
  const filas = await base.prisma.hiloVersion.findMany({ where: identidad() });
  expect(JSON.stringify(filas)).not.toContain(contenido().resumenAcumulativo);
  expect(filas[0].contenidoEncrypted.byteLength).toBeGreaterThan(40);
  await expect(aplicarResultadoTrabajo({ prisma: base.db, trabajo, resultado: { ok: true, propuesta: contenido(), promptVersion: "x", modeloLlm: "y" } })).rejects.toMatchObject({ status: 409 });
  expect(await base.prisma.hiloVersion.count({ where: identidad() })).toBe(1);
});

it("dos pestañas guardando a la vez: una escribe y la otra recibe 409", async () => {
  const resultados = await Promise.allSettled(["Primera", "Segunda"].map(resumenAcumulativo => editarHilo({ ...escritura(), contenido: { ...contenido(), resumenAcumulativo } })));
  expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(resultados.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect(await base.prisma.hiloVersion.count({ where: identidad() })).toBe(1);
});

it.each([false, true])("aceptar (editada=%s) conserva bytes anteriores y registra quién, cuándo y origen", async editada => {
  const propuesta = await proponer();
  const antes = await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: propuesta.id } });
  const vigente = await aceptarPropuesta({ ...escritura(), propuestaId: propuesta.id, ahora, ...(editada ? { contenido: { ...contenido(), resumenAcumulativo: "Mi revisión" } } : {}) });
  const despues = await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: propuesta.id } });
  expect(despues.contenidoEncrypted).toEqual(antes.contenidoEncrypted);
  expect(despues).toMatchObject({ estado: "aplicada", resueltaEn: ahora, resueltaPorUserId: org.userId });
  expect(vigente.version).toBe(editada ? 2 : 1);
  expect(vigente.propuestaOrigenId).toBe(editada ? propuesta.id : null);
  expect((await leerRecorrido(base.db, identidad())).vigente?.id).toBe(vigente.id);
});

it("rechazar cierra la propuesta sin cambiar contenido ni volver a pedirla", async () => {
  const propuesta = await proponer();
  const antes = await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: propuesta.id } });
  await rechazarPropuesta({ ...escritura(), propuestaId: propuesta.id, ahora });
  const despues = await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: propuesta.id } });
  expect(despues).toMatchObject({ estado: "rechazada", resueltaEn: ahora, resueltaPorUserId: org.userId, contenidoEncrypted: antes.contenidoEncrypted });
  expect((await leerRecorrido(base.db, identidad())).vigente).toBeNull();
  expect(await entregarTrabajos({ prisma: base.db, ahora, limite: 20 })).toEqual([]);
});

it("un resultado sobre una base vieja queda desactualizado y nunca pisa la edición", async () => {
  await aprobar();
  const { trabajo } = await reclamar();
  const manual = await editarHilo({ ...escritura(), contenido: contenido() });
  await aplicarResultadoTrabajo({ prisma: base.db, trabajo, resultado: { ok: true, propuesta: contenido(), promptVersion: "x", modeloLlm: "y" } });
  const r = await leerRecorrido(base.db, identidad());
  expect(r.vigente?.id).toBe(manual.id);
  expect(r.propuesta).toBeNull();
  expect(r.desactualizadas).toHaveLength(1);
  await expect(aceptarPropuesta({ ...escritura(1), propuestaId: r.desactualizadas[0].id })).rejects.toMatchObject({ status: 409 });
});

it("claims simultáneos con fechas iguales mantienen una sola propuesta y encadenan las sesiones", async () => {
  await aprobar(); await aprobar();
  await base.prisma.trabajo.updateMany({ where: identidad(), data: { creadoEn: ahora } });
  const claims = (await Promise.all(Array.from({ length: 4 }, () => reclamarTrabajos({ prisma: base.db, ejecutor: "worker", ahora, limite: 20 })))).flat();
  expect(claims).toHaveLength(1);
  const t = claims[0];
  const trabajo = await autorizarTicketTrabajo(pedidoConTicket(t.ticket), base.db, t.id);
  const resultados = await Promise.allSettled([1, 2].map(() => aplicarResultadoTrabajo({ prisma: base.db, trabajo, resultado: { ok: true, propuesta: contenido(), promptVersion: "x", modeloLlm: "y" } })));
  expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(resultados.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect(await base.prisma.hiloVersion.count({ where: { ...identidad(), estado: "propuesta" } })).toBe(1);
  expect(await entregarTrabajos({ prisma: base.db, ahora, limite: 20 })).toEqual([]);
  const propuesta = (await leerRecorrido(base.db, identidad())).propuesta!;
  await aceptarPropuesta({ ...escritura(), propuestaId: propuesta.id });
  const siguiente = await reclamar();
  expect(siguiente.entrega.adjunto).toMatchObject({ version: 1, contextoVigente: contenido() });
});

it("un aplicador inválido revierte también la resolución del trabajo", async () => {
  await aprobar();
  const { trabajo } = await reclamar();
  await expect(aplicarResultadoTrabajo({ prisma: base.db, trabajo, resultado: { ok: true, propuesta: {}, promptVersion: "x", modeloLlm: "y" } })).rejects.toThrow();
  expect(await base.prisma.hiloVersion.count({ where: identidad() })).toBe(0);
  expect(await base.prisma.trabajo.findUnique({ where: { id: trabajo.trabajoId } })).toMatchObject({ estado: "en_curso" });
});

it("el worker solo lee lo vigente y el ticket solo sirve para la paciente de su sesión", async () => {
  await proponer();
  const { sesionId } = await crearSesion(base.prisma, org, { estado: "procesando", audio: false, intento: 1 });
  const autorizacion = { sesionId, organizationId: org.orgId, intento: 1 };
  expect(await leerHiloParaWorker(base.db, org.pacienteId, autorizacion)).toMatchObject({ tipo: "hilo_vigente", version: 0, contenido: null });
  await expect(leerHiloParaWorker(base.db, "otra-paciente", autorizacion)).rejects.toMatchObject({ status: 401 });
  await expect(leerRecorrido(base.db, { ...identidad(), organizationId: "otra" })).rejects.toMatchObject({ status: 404 });
  const propuesta = (await leerRecorrido(base.db, identidad())).propuesta!;
  await aceptarPropuesta({ ...escritura(), propuestaId: propuesta.id });
  expect(await leerHiloParaWorker(base.db, org.pacienteId, autorizacion)).toMatchObject({ version: 1, contenido: contenido() });
});

it("el brief no muestra propuestas sin aceptar ni incorpora notas sin aprobar", async () => {
  const propuesta = await proponer();
  await crearSesion(base.prisma, org, { estado: "revision", audio: false, notaIa: { ...NOTA, analisis: "NO APROBADA" } });
  const previo = await leerBrief(base.db, identidad());
  expect(previo).toMatchObject({ propuestaPendiente: true, notaPendiente: true, hiloLongitudinal: null });
  expect(JSON.stringify(previo)).not.toContain("NO APROBADA");
  expect(previo.ultimaSesion?.resumenSesion).toBe(NOTA.analisis);
  await aceptarPropuesta({ ...escritura(), propuestaId: propuesta.id });
  expect(await leerBrief(base.db, identidad())).toMatchObject({ propuestaPendiente: false, hiloLongitudinal: { resumenAcumulativo: contenido().resumenAcumulativo, revisadoPorTerapeuta: true } });
});

it("regenerar es explícito y dos pedidos simultáneos crean un solo trabajo nuevo", async () => {
  const propuesta = await proponer();
  await editarHilo({ ...escritura(), contenido: contenido() });
  const antes = await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: propuesta.id } });
  const resultados = await Promise.allSettled([1, 2].map(() => regenerarHilo({ ...escritura(2), propuestaId: propuesta.id })));
  expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(resultados.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect(await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: propuesta.id } })).toMatchObject({ estado: "rechazada", contenidoEncrypted: antes.contenidoEncrypted });
  expect((await reclamar()).entrega.adjunto).toMatchObject({ version: 2 });
});

it("pacientes bloqueadas no esconden los trabajos detrás del primer lote", async () => {
  const propuesta = await proponer();
  for (let i = 0; i < 30; i++) await crearTrabajo({ prisma: base.db, ...identidad(), tipo: "integrar_contexto", payload: { pacienteId: org.pacienteId, sesionId: propuesta.sesionOrigenId! }, proximoIntentoEn: new Date(0) });
  const otra = await crearOrg(base.prisma);
  try {
    const { sesionId } = await crearSesion(base.prisma, otra, { estado: "aprobada", audio: false });
    const t = await crearTrabajo({ prisma: base.db, organizationId: otra.orgId, pacienteId: otra.pacienteId, tipo: "integrar_contexto", payload: { pacienteId: otra.pacienteId, sesionId }, proximoIntentoEn: new Date(0) });
    const lista = await reclamarTrabajos({ prisma: base.db, ejecutor: "worker", ahora, limite: 1 });
    expect(lista.map(x => x.id)).toEqual([t.id]);
  } finally { await limpiarOrg(base.prisma, otra.orgId); }
});

it("aprobar fuera de orden conserva referencias estables a las sesiones", async () => {
  const primera = await crearSesion(base.prisma, org, { estado: "revision", audio: false, notaIa: NOTA });
  const segunda = await crearSesion(base.prisma, org, { estado: "revision", audio: false, notaIa: NOTA });
  await base.prisma.turno.update({ where: { id: segunda.turnoId }, data: { fecha: new Date("2026-09-02T14:00:00Z") } });
  await aprobarExistente(segunda.sesionId);
  const tarde = await reclamar();
  expect(tarde.entrega.adjunto).toMatchObject({ sesionId: segunda.sesionId, fechaSesion: "2026-09-02" });
  expect(tarde.entrega.adjunto).not.toHaveProperty("numeroSesion");
  const c = { ...contenido(), intervencionesProbadas: [{ tecnica: "validacion", eficaciaPercibida: "media", sesiones: [segunda.sesionId] }] };
  await aplicarResultadoTrabajo({ prisma: base.db, trabajo: tarde.trabajo, resultado: { ok: true, propuesta: c, promptVersion: "x", modeloLlm: "y" } });
  const propuesta = (await leerRecorrido(base.db, identidad())).propuesta!;
  await aceptarPropuesta({ ...escritura(), propuestaId: propuesta.id });
  await aprobarExistente(primera.sesionId);
  const temprano = await reclamar();
  expect(temprano.entrega.adjunto).toMatchObject({ sesionId: primera.sesionId, contextoVigente: c });
  const nuevo = { ...c, intervencionesProbadas: [{ ...c.intervencionesProbadas[0], sesiones: [segunda.sesionId, primera.sesionId] }] };
  await aplicarResultadoTrabajo({ prisma: base.db, trabajo: temprano.trabajo, resultado: { ok: true, propuesta: nuevo, promptVersion: "x", modeloLlm: "y" } });
  expect((await leerRecorrido(base.db, identidad())).propuesta?.contenido.intervencionesProbadas[0].sesiones).toEqual([segunda.sesionId, primera.sesionId]);
});

it("una propuesta vieja no permite volver a incorporar una sesión ya aceptada", async () => {
  const original = await proponer();
  await rechazarPropuesta({ ...escritura(), propuestaId: original.id });
  await regenerarHilo({ ...escritura(), propuestaId: original.id });
  const { trabajo } = await reclamar();
  await aplicarResultadoTrabajo({ prisma: base.db, trabajo, resultado: { ok: true, propuesta: contenido(), promptVersion: "x", modeloLlm: "y" } });
  const nueva = (await leerRecorrido(base.db, identidad())).propuesta!;
  await aceptarPropuesta({ ...escritura(), propuestaId: nueva.id });
  await expect(regenerarHilo({ ...escritura(nueva.version), propuestaId: original.id })).rejects.toMatchObject({ status: 409 });
  expect(await base.prisma.trabajo.count({ where: { ...identidad(), tipo: "integrar_contexto" } })).toBe(2);
});

it("no permite guardar referencias clínicas de otra paciente", async () => {
  const otra = await crearOrg(base.prisma);
  try {
    const { sesionId } = await crearSesion(base.prisma, otra, { estado: "aprobada", audio: false });
    await expect(editarHilo({ ...escritura(), contenido: { ...contenido(), intervencionesProbadas: [{ tecnica: "validacion", eficaciaPercibida: "media", sesiones: [sesionId] }] } })).rejects.toMatchObject({ status: 400 });
    expect(await base.prisma.hiloVersion.count({ where: identidad() })).toBe(0);
  } finally { await limpiarOrg(base.prisma, otra.orgId); }
});

it("exportar lleva completas la vigente y las que estuvieron vigentes, del resto solo el registro, y lo audita sin contenido", async () => {
  // v1 propuesta de la IA, aceptada con ediciones → v2 vigente (v1 queda aplicada, pero nunca fue vigente).
  const primera = await proponer();
  const sesionId = primera.sesionOrigenId!;
  const conIntervencion = { ...contenido(), resumenAcumulativo: "Versión dos", intervencionesProbadas: [{ tecnica: "validacion" as const, eficaciaPercibida: "alta" as const, sesiones: [sesionId] }] };
  const v2 = await aceptarPropuesta({ ...escritura(), propuestaId: primera.id, contenido: conIntervencion });
  // v3 edición propia.
  const v3 = await editarHilo({ ...escritura(v2.version), contenido: { ...conIntervencion, resumenAcumulativo: "Versión tres" } });
  // v4 propuesta que se desactualiza cuando ella edita (v5).
  await proponer();
  const v5 = await editarHilo({ ...escritura(v3.version), contenido: { ...conIntervencion, resumenAcumulativo: "Versión cinco" } });
  // v6 propuesta abierta, sin revisar.
  await proponer();

  const exportadoEn = new Date("2026-09-16T17:30:00Z");
  const r = await exportarRecorrido(base.db, identidad(), org.userId, exportadoEn);

  expect(r.paciente).toEqual({ nombre: "Ana", apellido: "Pérez" });
  expect(r.nombreProfesional).toBe("Lic. Prueba");
  expect(r.vigente).toMatchObject({ version: v5.version, contenido: { resumenAcumulativo: "Versión cinco" } });
  expect(r.anteriores.map(v => [v.version, v.contenido.resumenAcumulativo])).toEqual([[3, "Versión tres"], [2, "Versión dos"]]);
  expect(r.versiones.map(v => [v.version, v.estado])).toEqual([[6, "propuesta"], [5, "aplicada"], [4, "desactualizada"], [3, "aplicada"], [2, "aplicada"], [1, "aplicada"]]);
  expect(r.versiones.find(v => v.version === 2)?.propuestaOrigenId).toBe(primera.id);
  // Lo que la IA escribió y ella no adoptó no viaja: ni en la versión reemplazada ni en las propuestas.
  expect(JSON.stringify(r)).not.toContain(contenido().resumenAcumulativo);
  // Cada sesión referenciada tiene su fecha: la hoja no necesita mostrar un id.
  const fechas = new Map(r.sesiones.map(s => [s.id, s.fecha]));
  expect(fechas.get(sesionId)).toBe("2026-09-01T14:00:00.000Z");
  for (const v of [r.vigente!, ...r.anteriores]) {
    for (const i of v.contenido.intervencionesProbadas) for (const id of i.sesiones) expect(fechas.has(id)).toBe(true);
  }
  expect(r.progreso).toMatchObject({ rango: "todo", totalSesiones: 3 });

  const eventos = await base.prisma.eventoAuditoria.findMany({ where: { organizationId: org.orgId, accion: "hilo.exportar_pdf" } });
  expect(eventos).toHaveLength(1);
  expect(eventos[0]).toMatchObject({ actorTipo: "usuario", actorId: org.userId, entidad: "hilo", entidadId: org.pacienteId, creadoEn: exportadoEn });
  expect(eventos[0].detalle).toEqual({ vigente: 5, versiones: 6, conContenido: [5, 3, 2], sesiones: 3 });
  expect(JSON.stringify(eventos[0].detalle)).not.toMatch(/Versión|Historia|Ana|Pérez|Prueba/);
});

it("exportar una paciente de otra organización es 404 y no deja registro", async () => {
  const otra = await crearOrg(base.prisma);
  try {
    await editarHilo({ ...escritura(), contenido: contenido() });
    await expect(exportarRecorrido(base.db, { pacienteId: org.pacienteId, organizationId: otra.orgId }, otra.userId)).rejects.toMatchObject({ status: 404 });
    expect(await base.prisma.eventoAuditoria.count({ where: { accion: "hilo.exportar_pdf" } })).toBe(0);
  } finally { await limpiarOrg(base.prisma, otra.orgId); }
});
