import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { cifrarHiloVersion, cifrarPaciente, cifrarSesion } from "@/lib/prisma-encryption";
import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { conectarBaseDeTest, limpiarDatosDeTest, vaciarTablas, type BaseDeTest } from "./db-test";
import { mantenimiento } from "@/app/api/_lib/casos-uso/mantenimiento";

let base: BaseDeTest;
let orgId: string;
let pacienteId: string;
const original = process.env.CLAVES_CIFRADO;
beforeAll(() => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  base = conectarBaseDeTest();
});
beforeEach(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  await vaciarTablas(base.prisma);
  orgId = (await base.db.organization.create({ data: { nombre: "Prueba de garantías" } })).id;
  pacienteId = randomUUID();
  await base.db.paciente.create({ data: {
    nombre: "Prueba", apellido: "Local", telefono: "", tarifa: 1, organizationId: orgId,
    ...cifrarPaciente(pacienteId, { notas: "original" }),
  } });
});
afterAll(async () => {
  await base.prisma.$disconnect();
  if (original === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = original;
  __resetLlaveroForTests();
});

it("regresión: create anidado rechaza el blob de otra fila igual que el directo", async () => {
  const id = randomUUID();
  const data = {
    nombre: "Otra", apellido: "Prueba", telefono: "", tarifa: 1,
    ...cifrarPaciente(pacienteId, { notas: "ajena" }), id,
  };
  await expect(base.db.paciente.create({ data: { ...data, organizationId: orgId } })).rejects.toThrow(/no fue cifrado para la fila/);
  await expect(base.db.organization.update({ where: { id: orgId }, data: {
    nombre: "no debe cambiar", pacientes: { create: data },
  } })).rejects.toThrow(/no fue cifrado para la fila/);
  expect(await base.prisma.paciente.findUnique({ where: { id } })).toBeNull();
  expect((await base.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).nombre).toBe("Prueba de garantías");
});

it("regresión: update anidado aplica las mismas guardas que el directo", async () => {
  const data = { notasEncrypted: cifrarPaciente(randomUUID(), { notas: "ajena" }).notasEncrypted };
  await expect(base.db.paciente.update({ where: { id: pacienteId }, data })).rejects.toThrow(/no fue cifrado para la fila/);
  await expect(base.db.organization.update({ where: { id: orgId }, data: {
    pacientes: { update: { where: { id: pacienteId }, data } },
  } })).rejects.toThrow(/no fue cifrado para la fila/);
  expect((await base.db.paciente.findUniqueOrThrow({ where: { id: pacienteId }, select: { notas: true } })).notas).toBe("original");
});

it("regresión: la base rechaza modificar y borrar auditoría incluso sin la extensión", async () => {
  const evento = await base.db.eventoAuditoria.create({ data: {
    organizationId: orgId, actorTipo: "sistema", accion: "prueba", entidad: "paciente", entidadId: pacienteId,
  } });
  await expect(base.db.eventoAuditoria.update({ where: { id: evento.id }, data: { accion: "reescrita" } })).rejects.toThrow(/eventos_auditoria.*inmutable/);
  await expect(base.db.eventoAuditoria.delete({ where: { id: evento.id } })).rejects.toThrow(/eventos_auditoria.*inmutable/);
  await expect(base.prisma.$executeRaw`UPDATE eventos_auditoria SET accion = 'sql' WHERE id = ${evento.id}`).rejects.toThrow(/eventos_auditoria.*inmutable/);
  expect(await base.prisma.eventoAuditoria.findUniqueOrThrow({ where: { id: evento.id } })).toEqual(evento);
});

async function version() {
  const id = randomUUID();
  await base.db.hilo.create({ data: { pacienteId, organizationId: orgId } });
  return base.db.hiloVersion.create({ data: {
    ...cifrarHiloVersion(id, { contenido: { resumen: "original" } }), pacienteId, organizationId: orgId,
    version: 1, actor: "ia", estado: "propuesta",
  }, select: { id: true, contenidoEncrypted: true, estado: true } });
}

it("regresión: contenido de hilo_versiones inmutable aunque el nuevo cifrado sea válido", async () => {
  const v = await version();
  const data = cifrarHiloVersion(v.id, { contenido: { resumen: "reescrito" } });
  await expect(base.db.hiloVersion.update({ where: { id: v.id }, data })).rejects.toThrow(/hilo_versiones.*inmutable/);
  await expect(base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${data.contenidoEncrypted} WHERE id = ${v.id}`).rejects.toThrow(/hilo_versiones.*inmutable/);
  expect((await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: v.id } })).contenidoEncrypted).toEqual(v.contenidoEncrypted);
});

it("aceptación/rechazo conservan el contenido y permiten estado, quién y cuándo", async () => {
  const v = await version();
  const resueltaEn = new Date("2026-09-16T00:00:00Z");
  await base.db.hiloVersion.update({ where: { id: v.id }, data: { estado: "rechazada", resueltaPorUserId: "profesional", resueltaEn } });
  expect(await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({
    contenidoEncrypted: v.contenidoEncrypted, estado: "rechazada", resueltaPorUserId: "profesional", resueltaEn,
  });
});

it("la guarda llega a un segundo nivel de create y admite cifrado correcto", async () => {
  const id = randomUUID();
  const data = { fecha: new Date("2026-09-16T15:00:00Z"), tarifaCobrada: 1, organizationId: orgId,
    sesionClinica: { create: { organizationId: orgId, ...cifrarSesion(id, { transcripcion: "correcta" }) } },
  };
  await base.db.organization.update({ where: { id: orgId }, data: { pacientes: { update: {
    where: { id: pacienteId }, data: { turnos: { create: data } },
  } } } });
  expect((await base.db.sesionClinica.findUniqueOrThrow({ where: { id }, select: { transcripcion: true } })).transcripcion).toBe("correcta");
  data.sesionClinica.create.id = randomUUID();
  await expect(base.db.paciente.update({ where: { id: pacienteId }, data: { turnos: { create: data } } })).rejects.toThrow(/no fue cifrado para la fila/);
});

it.each(["createMany", "upsert", "connectOrCreate"] as const)("%s anidado valida cada create con su propio id", async (operacion) => {
  const id = randomUUID();
  const data = { nombre: "Otra", apellido: "Local", telefono: "", tarifa: 1,
    ...cifrarPaciente(pacienteId, { notas: "ajena" }), id };
  const anidado = operacion === "createMany" ? { createMany: { data: [data] } }
    : operacion === "upsert" ? { upsert: { where: { id }, create: data, update: {} } }
      : { connectOrCreate: { where: { id }, create: data } };
  await expect(base.db.organization.update({ where: { id: orgId }, data: { pacientes: anidado } })).rejects.toThrow(/no fue cifrado para la fila/);
  data.notasEncrypted = cifrarPaciente(id, { notas: "correcta" }).notasEncrypted;
  await base.db.organization.update({ where: { id: orgId }, data: { pacientes: anidado } });
  expect((await base.db.paciente.findUniqueOrThrow({ where: { id }, select: { notas: true } })).notas).toBe("correcta");
});

it.each(["updateMany", "upsert"] as const)("%s anidado valida el destino del update", async (operacion) => {
  const data = { notasEncrypted: cifrarPaciente(randomUUID(), { notas: "ajena" }).notasEncrypted };
  const anidado = operacion === "updateMany" ? { updateMany: { where: { id: pacienteId }, data } }
    : { upsert: { where: { id: pacienteId }, update: data, create: {
      nombre: "Otra", apellido: "Local", telefono: "", tarifa: 1, ...cifrarPaciente(pacienteId, { notas: "nueva" }),
    } } };
  await expect(base.db.organization.update({ where: { id: orgId }, data: { pacientes: anidado } })).rejects.toThrow(/no fue cifrado para la fila/);
  data.notasEncrypted = cifrarPaciente(pacienteId, { notas: "correcta" }).notasEncrypted;
  await base.db.organization.update({ where: { id: orgId }, data: { pacientes: anidado } });
  expect((await base.db.paciente.findUniqueOrThrow({ where: { id: pacienteId }, select: { notas: true } })).notas).toBe("correcta");
});

it("update singular exige where.id, nunca confía en data.id ni en la relación implícita", async () => {
  const id = randomUUID();
  const turno = await base.db.turno.create({ data: {
    fecha: new Date("2026-09-16T15:00:00Z"), tarifaCobrada: 1, organizationId: orgId, pacienteId,
    sesionClinica: { create: { organizationId: orgId, ...cifrarSesion(id, { transcripcion: "original" }) } },
  } });
  const data = { transcripcionEncrypted: cifrarSesion(id, { transcripcion: "actualizada" }).transcripcionEncrypted };
  await expect(base.db.turno.update({ where: { id: turno.id }, data: { sesionClinica: { update: data } } })).rejects.toThrow(/exige where.id/);
  await expect(base.db.turno.update({ where: { id: turno.id }, data: { sesionClinica: { update: { data } } } })).rejects.toThrow(/exige where.id/);
  await base.db.turno.update({ where: { id: turno.id }, data: { sesionClinica: { update: { where: { id }, data } } } });
  expect((await base.db.sesionClinica.findUniqueOrThrow({ where: { id }, select: { transcripcion: true } })).transcripcion).toBe("actualizada");
  // Tampoco se cambia el id dejando intacto un blob atado al anterior.
  await expect(base.db.turno.update({ where: { id: turno.id }, data: { sesionClinica: { update: {
    where: { id }, data: { id: randomUUID() },
  } } } })).rejects.toThrow(/no se puede cambiar el id/);
});

it("un update anidado sin id o con set recibe el mismo rechazo que el directo", async () => {
  const data = { notasEncrypted: cifrarPaciente(pacienteId, { notas: "nueva" }).notasEncrypted };
  await expect(base.db.organization.update({ where: { id: orgId }, data: { pacientes: {
    updateMany: { where: { activo: true }, data },
  } } })).rejects.toThrow(/exige where.id/);
  const conSet = { notasEncrypted: { set: data.notasEncrypted } };
  await expect(base.db.paciente.update({ where: { id: pacienteId }, data: conSet })).rejects.toThrow(/solo acepta un blob/);
  await expect(base.db.organization.update({ where: { id: orgId }, data: { pacientes: {
    update: { where: { id: pacienteId }, data: conSet },
  } } })).rejects.toThrow(/solo acepta un blob/);
});

it("una transacción con una escritura anidada inválida no deja escrituras parciales", async () => {
  await expect(base.db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: orgId }, data: { nombre: "cambio parcial" } });
    await tx.organization.update({ where: { id: orgId }, data: { pacientes: { update: {
      where: { id: pacienteId }, data: { notasEncrypted: cifrarPaciente(randomUUID(), { notas: "ajena" }).notasEncrypted },
    } } } });
  })).rejects.toThrow(/no fue cifrado para la fila/);
  expect((await base.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).nombre).toBe("Prueba de garantías");
});

it("auditoría rechaza también updateMany, deleteMany, upsert existente y TRUNCATE", async () => {
  const evento = await base.db.eventoAuditoria.create({ data: {
    organizationId: orgId, actorTipo: "sistema", accion: "prueba", entidad: "paciente", entidadId: pacienteId,
  } });
  await expect(base.db.eventoAuditoria.updateMany({ data: { detalle: {} } })).rejects.toThrow(/eventos_auditoria.*inmutable/);
  await expect(base.db.eventoAuditoria.deleteMany()).rejects.toThrow(/eventos_auditoria.*inmutable/);
  await expect(base.db.eventoAuditoria.upsert({ where: { id: evento.id }, create: { ...evento, detalle: undefined }, update: { accion: "otra" } })).rejects.toThrow(/eventos_auditoria.*inmutable/);
  await expect(base.db.$executeRaw`TRUNCATE eventos_auditoria`).rejects.toThrow(/eventos_auditoria.*inmutable/);
  expect(await base.prisma.eventoAuditoria.count()).toBe(1);
});

it("hilo conserva procedencia y versiones ante updateMany, delete, cascada y TRUNCATE", async () => {
  const v = await version();
  await expect(base.db.hiloVersion.updateMany({ where: { id: v.id }, data: { actor: "profesional" } })).rejects.toThrow(/hilo_versiones.*inmutable/);
  await expect(base.db.hiloVersion.delete({ where: { id: v.id } })).rejects.toThrow(/hilo_versiones.*inmutable/);
  await expect(base.db.hilo.delete({ where: { pacienteId } })).rejects.toThrow(/hilo_versiones.*inmutable/);
  await expect(base.db.$executeRaw`TRUNCATE hilo_versiones CASCADE`).rejects.toThrow(/hilo_versiones.*inmutable/);
  expect(await base.prisma.hiloVersion.count()).toBe(1);
  expect(await base.prisma.hilo.count()).toBe(1);
});

it("la limpieza de fixtures restaura las protecciones también al fallar", async () => {
  await expect(limpiarDatosDeTest(base.prisma, async () => { throw new Error("fallo de fixture"); })).rejects.toThrow("fallo de fixture");
  await expect(base.db.eventoAuditoria.deleteMany()).rejects.toThrow(/eventos_auditoria.*inmutable/);
  await expect(base.db.hiloVersion.deleteMany()).rejects.toThrow(/hilo_versiones.*inmutable/);
});

it("recifrado no reescribe el historial ni anuncia que se puede retirar su clave", async () => {
  const v = await version();
  process.env.CLAVES_CIFRADO = `${CLAVES_CIFRADO_TEST},2=${Buffer.alloc(32, 2).toString("base64")}`;
  __resetLlaveroForTests();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const resultado = await mantenimiento({ prisma: base.db, ahora: new Date("2026-09-16T00:00:00Z"), todo: true });
    expect(resultado.recifrado).toEqual({ recifradas: 1, pendientes: 1, errores: 1 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("conservar la clave anterior"));
    expect((await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id: v.id } })).contenidoEncrypted).toEqual(v.contenidoEncrypted);
  } finally { log.mockRestore(); }
});
