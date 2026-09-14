// Unitario — la guarda de la base de test, a solas.
//
// Lo que protege: que un TRUNCATE ... CASCADE nunca corra contra una base
// que no sea local sin que alguien lo haya pedido con nombre y apellido
// (PERMITIR_BASE_REMOTA_DE_TEST=1). Y que la lista de tablas que se vacían
// sea la del schema entero: una tabla nueva que no esté acá queda con datos
// entre casos, y un test que pasa gracias a datos de otro test es un verde
// falso.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  TABLAS,
  validarUrlDeBaseDeTest,
  VARIABLE_PERMISO_REMOTO,
} from "./db-test";

const LOCAL = "postgresql://postgres:postgres@localhost:5433/sesion_test";
const REMOTA = "postgresql://usuario:secreto@ep-alguna-rama-123456.sa-east-1.aws.neon.tech/neondb?sslmode=require";

describe("validarUrlDeBaseDeTest", () => {
  it("acepta localhost, 127.0.0.1 y ::1 sin pedir nada más", () => {
    expect(validarUrlDeBaseDeTest(LOCAL, undefined)).toBe(LOCAL);
    expect(
      validarUrlDeBaseDeTest("postgresql://p:p@127.0.0.1:5432/x", undefined),
    ).toBe("postgresql://p:p@127.0.0.1:5432/x");
    expect(validarUrlDeBaseDeTest("postgresql://p:p@[::1]:5432/x", undefined)).toBe(
      "postgresql://p:p@[::1]:5432/x",
    );
  });

  it("sin la variable, aborta: es un TRUNCATE sin destino", () => {
    expect(() => validarUrlDeBaseDeTest(undefined, undefined)).toThrow(
      /DATABASE_URL_TEST no está definida/,
    );
    expect(() => validarUrlDeBaseDeTest("   ", undefined)).toThrow(
      /no está definida/,
    );
  });

  it("un host remoto sin permiso explícito aborta antes de conectar", () => {
    expect(() => validarUrlDeBaseDeTest(REMOTA, undefined)).toThrow(
      /no es local/,
    );
    // El permiso tiene que ser exactamente "1": "true", "yes" o "0" no valen.
    for (const valor of ["0", "true", "yes", ""]) {
      expect(() => validarUrlDeBaseDeTest(REMOTA, valor)).toThrow(/no es local/);
    }
  });

  it("el error nombra el host, nunca la contraseña", () => {
    let mensaje = "";
    try {
      validarUrlDeBaseDeTest(REMOTA, undefined);
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toContain("ep-alguna-rama-123456.sa-east-1.aws.neon.tech");
    expect(mensaje).not.toContain("secreto");
    expect(mensaje).toContain(VARIABLE_PERMISO_REMOTO);
  });

  it("con PERMITIR_BASE_REMOTA_DE_TEST=1 acepta y lo deja dicho en el log", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validarUrlDeBaseDeTest(REMOTA, "1")).toBe(REMOTA);
      expect(warn).toHaveBeenCalledTimes(1);
      const aviso = String(warn.mock.calls[0][0]);
      expect(aviso).toContain("REMOTA");
      expect(aviso).toContain("ep-alguna-rama-123456.sa-east-1.aws.neon.tech");
      expect(aviso).not.toContain("secreto");
    } finally {
      warn.mockRestore();
    }
  });

  it("una URL inválida aborta", () => {
    expect(() => validarUrlDeBaseDeTest("no es una url", undefined)).toThrow(
      /no es una URL válida/,
    );
  });
});

describe("TABLAS que se vacían", () => {
  it("son exactamente las del schema de Prisma", () => {
    // Cada `@@map("…")` de un model es una tabla. Si alguien agrega un model
    // y no lo agrega a TABLAS, este caso lo dice antes de que un test herede
    // filas del anterior.
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const enSchema = new Set<string>();
    let dentroDeModel = false;
    for (const linea of schema.split("\n")) {
      if (/^model\s+\w+\s*\{/.test(linea)) dentroDeModel = true;
      else if (/^enum\s+\w+\s*\{/.test(linea)) dentroDeModel = false;
      const m = linea.match(/^\s*@@map\("([^"]+)"\)/);
      if (dentroDeModel && m) enSchema.add(m[1]);
      if (/^\}/.test(linea)) dentroDeModel = false;
    }
    expect([...TABLAS].sort()).toEqual([...enSchema].sort());
  });
});
