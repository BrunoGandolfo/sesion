// La base, no TypeScript, decide qué se puede cambiar de una versión del
// Recorrido (20260928120000_hilo_versiones_recifrado): la resolución, o sola
// la clave con que está cifrado el contenido. Todo por SQL crudo, sin la
// extensión de cifrado: es lo que haría cualquiera con la conexión.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { aadDe, cifrar, descifrar } from "@/lib/encryption";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { cifrarHiloVersion, cifrarPaciente } from "@/lib/prisma-encryption";
import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { conectarBaseDeTest, hayBaseDeTest, vaciarTablas, type BaseDeTest } from "./db-test";

const K2 = randomBytes(32).toString("base64");
const original = process.env.CLAVES_CIFRADO;
const INMUTABLE = /55000[\s\S]*hilo_versiones es inmutable/;

describe.skipIf(!hayBaseDeTest())("hilo_versiones: solo cambia la clave, nunca el contenido", () => {
  let base: BaseDeTest;
  let orgId: string;
  let pacienteId: string;

  function usarLlavero(valor: string) {
    process.env.CLAVES_CIFRADO = valor;
    __resetLlaveroForTests();
  }

  beforeAll(() => {
    usarLlavero(CLAVES_CIFRADO_TEST);
    base = conectarBaseDeTest();
  });
  beforeEach(async () => {
    usarLlavero(CLAVES_CIFRADO_TEST);
    await vaciarTablas(base.prisma);
    orgId = (await base.db.organization.create({ data: { nombre: "Recifrado del hilo" } })).id;
    pacienteId = randomUUID();
    await base.db.paciente.create({ data: {
      nombre: "Prueba", apellido: "Local", telefono: "", tarifa: 1, organizationId: orgId,
      ...cifrarPaciente(pacienteId, { notas: "n" }),
    } });
    await base.db.hilo.create({ data: { pacienteId, organizationId: orgId } });
  });
  afterAll(async () => {
    await base.prisma.$disconnect();
    if (original === undefined) delete process.env.CLAVES_CIFRADO;
    else process.env.CLAVES_CIFRADO = original;
    __resetLlaveroForTests();
  });

  /** Una versión cifrada con la clave 1, leída de la base tal cual. */
  async function version() {
    const id = randomUUID();
    await base.db.hiloVersion.create({ data: {
      ...cifrarHiloVersion(id, { contenido: { resumen: "original" } }), pacienteId, organizationId: orgId,
      version: 1, actor: "ia", estado: "propuesta",
    } });
    const fila = await base.prisma.hiloVersion.findUniqueOrThrow({ where: { id } });
    expect(fila.contenidoEncrypted[4]).toBe(1);
    return { fila, aad: aadDe("hilo_versiones", "contenido_encrypted", id) };
  }

  const leer = (id: string) => base.prisma.hiloVersion.findUniqueOrThrow({ where: { id } });

  it("(a) otro id de clave y el mismo texto: pasa, y descifra igual", async () => {
    const { fila, aad } = await version();
    const texto = descifrar(Buffer.from(fila.contenidoEncrypted), aad);
    usarLlavero(`${CLAVES_CIFRADO_TEST},2=${K2}`);
    const nuevo = cifrar(texto, aad);
    expect(nuevo[4]).toBe(2);

    await expect(base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${nuevo} WHERE id = ${fila.id}`).resolves.toBe(1);

    const despues = await leer(fila.id);
    expect(Buffer.from(despues.contenidoEncrypted)).toEqual(nuevo);
    expect(descifrar(Buffer.from(despues.contenidoEncrypted), aad)).toBe(texto);
    expect({ ...despues, contenidoEncrypted: null }).toEqual({ ...fila, contenidoEncrypted: null });
  });

  it("(b) el mismo id de clave con otro blob: rechazado, aunque el texto sea el mismo", async () => {
    const { fila, aad } = await version();
    const texto = descifrar(Buffer.from(fila.contenidoEncrypted), aad);
    for (const blob of [cifrar(texto, aad), cifrar(JSON.stringify({ resumen: "reescrito" }), aad)]) {
      expect(blob[4]).toBe(1);
      await expect(base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${blob} WHERE id = ${fila.id}`).rejects.toThrow(INMUTABLE);
    }
    expect(Buffer.from((await leer(fila.id)).contenidoEncrypted)).toEqual(Buffer.from(fila.contenidoEncrypted));
  });

  it("(b') otro id pero sin prefijo ENC2: rechazado", async () => {
    const { fila, aad } = await version();
    usarLlavero(`${CLAVES_CIFRADO_TEST},2=${K2}`);
    const nuevo = cifrar("{}", aad);
    nuevo.write("ENC3", 0, "ascii");
    await expect(base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${nuevo} WHERE id = ${fila.id}`).rejects.toThrow(INMUTABLE);
    await expect(base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${Buffer.from([0x45, 0x4e, 0x43, 0x32])} WHERE id = ${fila.id}`).rejects.toThrow(INMUTABLE);
  });

  it("(c) otra columna junto con el blob: rechazado", async () => {
    const { fila, aad } = await version();
    const texto = descifrar(Buffer.from(fila.contenidoEncrypted), aad);
    usarLlavero(`${CLAVES_CIFRADO_TEST},2=${K2}`);
    const nuevo = cifrar(texto, aad);
    const resueltaEn = new Date("2026-09-28T12:00:00Z");
    await expect(base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${nuevo}, actor = 'profesional' WHERE id = ${fila.id}`).rejects.toThrow(INMUTABLE);
    await expect(base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${nuevo}, version = 2 WHERE id = ${fila.id}`).rejects.toThrow(INMUTABLE);
    // Ni siquiera con la resolución: son dos cambios distintos, van por separado.
    await expect(base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${nuevo}, estado = 'rechazada', resuelta_en = ${resueltaEn} WHERE id = ${fila.id}`).rejects.toThrow(INMUTABLE);
    expect(await leer(fila.id)).toEqual(fila);
  });

  it("(d) la resolución sigue funcionando, antes y después de recifrar", async () => {
    const { fila, aad } = await version();
    const resueltaEn = new Date("2026-09-28T12:00:00Z");
    await base.db.hiloVersion.update({ where: { id: fila.id }, data: { estado: "rechazada", resueltaPorUserId: "profesional", resueltaEn } });
    expect(await leer(fila.id)).toMatchObject({ contenidoEncrypted: fila.contenidoEncrypted, estado: "rechazada", resueltaPorUserId: "profesional", resueltaEn });

    usarLlavero(`${CLAVES_CIFRADO_TEST},2=${K2}`);
    const nuevo = cifrar(descifrar(Buffer.from(fila.contenidoEncrypted), aad), aad);
    await base.prisma.$executeRaw`UPDATE hilo_versiones SET contenido_encrypted = ${nuevo} WHERE id = ${fila.id}`;
    await base.prisma.$executeRaw`UPDATE hilo_versiones SET estado = 'propuesta', resuelta_en = NULL, resuelta_por_user_id = NULL WHERE id = ${fila.id}`;
    expect(await leer(fila.id)).toMatchObject({ estado: "propuesta", resueltaEn: null, resueltaPorUserId: null });
  });

  it("(e) DELETE sigue rechazado", async () => {
    const { fila } = await version();
    await expect(base.prisma.$executeRaw`DELETE FROM hilo_versiones WHERE id = ${fila.id}`).rejects.toThrow(/55000[\s\S]*hilo_versiones es inmutable/);
    expect(await base.prisma.hiloVersion.count()).toBe(1);
  });
});
