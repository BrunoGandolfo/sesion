/**
 * La extensión de cifrado, sin base: la tabla de campos, los cifrarX y las
 * dos guardas. Corre con `npm run test:unit`.
 *
 * Lo que necesita la base (la extensión leyendo y escribiendo de verdad, la
 * rotación, el mantenimiento) está en prisma-encryption-integracion.test.ts,
 * que está en la lista INTEGRACION de vitest.config.ts y FALLA sin base: no
 * se saltea en silencio.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { celdasCifradas } from "@/app/api/_lib/casos-uso/mantenimiento";
import { aadDe, descifrar, ErrorDescifrado } from "@/lib/encryption";
import { __resetLlaveroForTests } from "@/lib/llavero";
import {
  assertConsultaSinCifrados,
  assertEscrituraCifradaConsistente,
  CAMPOS_CIFRADOS,
  cifrarHotWord,
  cifrarPaciente,
  cifrarSesion,
  cifrarTurno,
  MODELOS_CIFRADOS,
} from "@/lib/prisma-encryption";

import { CLAVES_CIFRADO_TEST } from "./base-identidad";

const ORIGINAL = process.env.CLAVES_CIFRADO;

function llavero(texto: string) {
  process.env.CLAVES_CIFRADO = texto;
  __resetLlaveroForTests();
}

// Al recolectar (los `describe` corren antes que cualquier hook) ya hace
// falta la clave: los blobs de ejemplo se arman en el cuerpo del describe.
llavero(CLAVES_CIFRADO_TEST);
beforeAll(() => llavero(CLAVES_CIFRADO_TEST));
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL;
  __resetLlaveroForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
// Unitario
// ─────────────────────────────────────────────────────────────────────────────

describe("la tabla de campos cifrados es la del anexo de docs/esquema.md", () => {
  it("seis modelos, con las columnas exactas", () => {
    expect(MODELOS_CIFRADOS.sort()).toEqual(
      ["ConsentimientoGrabacion", "HiloVersion", "HotWord", "Paciente", "SesionClinica", "Turno"].sort(),
    );
    expect(Object.keys(CAMPOS_CIFRADOS.SesionClinica.campos).sort()).toEqual(
      ["datos", "feedback", "notaFinal", "notaIa", "notasEdicion", "transcripcion"].sort(),
    );
    expect(CAMPOS_CIFRADOS.HotWord.campos.termino.columnaSql).toBe("termino_encrypted");
    expect(CAMPOS_CIFRADOS.HiloVersion.tabla).toBe("hilo_versiones");
  });

  // Doce: audio_clave_encrypted salió de la tabla de campos cifrados cuando
  // la app dejó de cifrar el audio (5c1bfe2). La columna sigue en la base
  // hasta la migración que la borra, pero ya nadie la lee ni la recifra.
  it("celdasCifradas (lo que recorre el re-cifrado) enumera las doce columnas vivas", () => {
    expect(celdasCifradas()).toHaveLength(12);
    expect(celdasCifradas()).toContainEqual({ tabla: "hilo_versiones", columna: "contenido_encrypted" });
    expect(celdasCifradas()).not.toContainEqual({ tabla: "sesiones_clinicas", columna: "audio_clave_encrypted" });
  });
});

describe("cifrarX", () => {
  it("devuelve el id y solo las columnas de los campos enviados", () => {
    const r = cifrarPaciente("p1", { notas: "texto" });
    expect(r.id).toBe("p1");
    expect(Buffer.isBuffer(r.notasEncrypted)).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["id", "notasEncrypted"]);
  });

  it("null deja la columna en null; undefined no la toca", () => {
    expect(cifrarTurno("t1", { notas: null }).notasEncrypted).toBeNull();
    expect(Object.keys(cifrarTurno("t1", {}))).toEqual(["id"]);
    expect(Object.keys(cifrarSesion("s1", { notaIa: undefined, datos: null }))).toEqual(["id", "datosEncrypted"]);
  });

  it("sin id no cifra: el AAD necesita la fila", () => {
    expect(() => cifrarPaciente("", { notas: "x" })).toThrow(/id de la fila es obligatorio/);
    // @ts-expect-error id inválido a propósito
    expect(() => cifrarSesion(undefined, { transcripcion: "x" })).toThrow();
  });

  it("el blob va atado a tabla, columna e id de la BASE", () => {
    const { notasEncrypted } = cifrarPaciente("p1", { notas: "texto" });
    const blob = notasEncrypted as Buffer;
    expect(descifrar(blob, aadDe("pacientes", "notas_encrypted", "p1"))).toBe("texto");
    expect(() => descifrar(blob, aadDe("turnos", "notas_encrypted", "p1"))).toThrow(ErrorDescifrado);
  });

  it("una nota SOAP se normaliza a sus cuatro claves antes de cifrar", () => {
    const { notaIaEncrypted } = cifrarSesion("s1", {
      notaIa: { subjetivo: "s", plan: "p", extra: "no" } as never,
    });
    const texto = descifrar(notaIaEncrypted as Buffer, aadDe("sesiones_clinicas", "nota_ia_encrypted", "s1"));
    expect(JSON.parse(texto)).toEqual({ subjetivo: "s", objetivo: null, analisis: null, plan: "p" });
  });

  it("json acepta objeto o string ya serializado", () => {
    const aad = aadDe("sesiones_clinicas", "datos_encrypted", "s1");
    expect(descifrar(cifrarSesion("s1", { datos: { a: 1 } }).datosEncrypted as Buffer, aad)).toBe('{"a":1}');
    expect(descifrar(cifrarSesion("s1", { datos: '{"b":2}' }).datosEncrypted as Buffer, aad)).toBe('{"b":2}');
  });

  it("rechaza un campo que no es cifrado", () => {
    expect(() => cifrarPaciente("p1", { nombre: "x" } as never)).toThrow(/no es un campo cifrado/);
  });
});

describe("guarda 1: nada cifrado en where / orderBy", () => {
  it.each(MODELOS_CIFRADOS)("%s rechaza el campo lógico y la columna, también anidados", (modelo) => {
    const [campo, def] = Object.entries(CAMPOS_CIFRADOS[modelo].campos)[0];
    expect(() => assertConsultaSinCifrados(modelo, { where: { [campo]: "x" } })).toThrow(/Cannot filter/);
    expect(() => assertConsultaSinCifrados(modelo, { where: { [def.columna]: null } })).toThrow(/Cannot filter/);
    expect(() =>
      assertConsultaSinCifrados(modelo, { where: { OR: [{ id: "a" }, { NOT: { [campo]: null } }] } }),
    ).toThrow(/Cannot filter/);
    expect(() => assertConsultaSinCifrados(modelo, { orderBy: [{ id: "asc" }, { [campo]: "asc" }] })).toThrow(
      /Cannot order/,
    );
    expect(() => assertConsultaSinCifrados(modelo, { where: { id: "a" }, orderBy: { id: "asc" } })).not.toThrow();
  });
});

describe("guarda 2: toda escritura cifrada lleva el id de su fila", () => {
  const blobP1 = cifrarPaciente("p1", { notas: "n" });

  it("create sin id con una columna cifrada se rechaza", () => {
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "create", { data: { notasEncrypted: blobP1.notasEncrypted } }),
    ).toThrow(/exige data.id/);
  });

  it("create con el id de otra fila se rechaza: el blob no es de esa fila", () => {
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "create", { data: { id: "p2", notasEncrypted: blobP1.notasEncrypted } }),
    ).toThrow(/no fue cifrado para la fila p2/);
  });

  it("create con el id correcto pasa; sin columnas cifradas no exige id", () => {
    expect(() => assertEscrituraCifradaConsistente("Paciente", "create", { data: blobP1 })).not.toThrow();
    expect(() => assertEscrituraCifradaConsistente("Paciente", "create", { data: { nombre: "x" } })).not.toThrow();
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "create", { data: { id: "p9", notasEncrypted: null } }),
    ).not.toThrow();
  });

  it("update/updateMany exigen where.id y que el blob sea de esa fila", () => {
    const { id: _id, ...data } = blobP1;
    void _id;
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "updateMany", { where: { organizationId: "o" }, data }),
    ).toThrow(/exige where.id/);
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "updateMany", { where: { id: "p2", organizationId: "o" }, data }),
    ).toThrow(/no fue cifrado para la fila p2/);
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "update", { where: { id: "p1" }, data }),
    ).not.toThrow();
  });

  it("upsert mira create.id y where.id", () => {
    const { id: _id, ...update } = blobP1;
    void _id;
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "upsert", { where: { id: "p1" }, create: blobP1, update }),
    ).not.toThrow();
    expect(() =>
      assertEscrituraCifradaConsistente("Paciente", "upsert", { where: { id: "p2" }, create: blobP1, update }),
    ).toThrow(/no fue cifrado para la fila p2/);
  });

  it("createMany revisa cada fila", () => {
    expect(() =>
      assertEscrituraCifradaConsistente("HotWord", "createMany", {
        data: [cifrarHotWord("h1", { termino: "a" }), { terminoEncrypted: cifrarHotWord("h2", { termino: "b" }).terminoEncrypted }],
      }),
    ).toThrow(/exige data.id/);
  });

  it("un valor que no es blob en una columna cifrada se rechaza", () => {
    expect(() =>
      assertEscrituraCifradaConsistente("Turno", "create", { data: { id: "t1", notasEncrypted: "texto plano" } }),
    ).toThrow(/solo acepta un blob/);
  });

  it("las lecturas no pasan por la guarda 2", () => {
    expect(() => assertEscrituraCifradaConsistente("Paciente", "findMany", { where: { id: "x" } })).not.toThrow();
  });
});
