import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  agregarMesesMvd, esMismoDiaMvd, esMismoMesMvd, fechaInputMvd,
  formatearMesMvd, inicioDelDiaMvd, partesMvd,
} from "@/lib/fechas-montevideo";
import { calcularProgramadoEn } from "@/lib/recordatorios-programacion";

const zonas = ["UTC", "America/Montevideo", "Europe/Madrid", "America/Los_Angeles"];
describe.each(zonas)("calendario del consultorio con proceso en %s", (zona) => {
  it("comparte día y año entre etiquetas, agrupación y recordatorios después de medianoche UTC", () => {
    const anterior = process.env.TZ;
    process.env.TZ = zona;
    try {
      const turno = new Date("2027-01-01T02:30:00Z"); // 31/12, 23:30 Mvd.
      expect(fechaInputMvd(turno)).toBe("2026-12-31");
      expect(partesMvd(turno).anio).toBe(2026);
      expect(formatearMesMvd(turno, true)).toBe("diciembre 2026");
      expect(esMismoMesMvd(turno, new Date("2026-12-01T15:00:00Z"))).toBe(true);
      expect(esMismoDiaMvd(turno, new Date("2026-12-31T15:00:00Z"))).toBe(true);
      expect(esMismoDiaMvd(turno, new Date("2027-01-01T03:00:00Z"))).toBe(false);
      expect(inicioDelDiaMvd(turno).toISOString()).toBe("2026-12-31T03:00:00.000Z");
      expect(calcularProgramadoEn(turno, "dia_anterior").toISOString()).toBe("2026-12-30T23:00:00.000Z");
      expect(calcularProgramadoEn(turno, "misma_manana").toISOString()).toBe("2026-12-31T11:00:00.000Z");
    } finally {
      if (anterior === undefined) delete process.env.TZ;
      else process.env.TZ = anterior;
    }
  });
});

it.each([
  ["2026-01-31T23:15:20.123-03:00", 1, "2026-03-01T02:15:20.123Z"],
  ["2024-01-31T15:00:00-03:00", 1, "2024-02-29T18:00:00.000Z"],
  ["2026-03-31T15:00:00-03:00", -1, "2026-02-28T18:00:00.000Z"],
  ["2026-12-31T23:30:00-03:00", 1, "2027-02-01T02:30:00.000Z"],
] as const)("navega meses desde %s sin desbordar el último día", (iso, meses, esperado) => {
  expect(agregarMesesMvd(new Date(iso), meses).toISOString()).toBe(esperado);
});

it("centraliza las decisiones de calendario y reloj fuera de la zona del proceso", () => {
  const infracciones: string[] = [];
  const metodosLocales = new Set([
    "getDate", "getDay", "getMonth", "getFullYear", "getHours", "getMinutes",
    "setDate", "setMonth", "setFullYear", "setHours", "setMinutes",
    "getUTCDate", "getUTCDay", "getUTCMonth", "getUTCFullYear",
    "toDateString", "toLocaleDateString",
  ]);
  function recorrer(carpeta: string) {
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const archivo = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name !== "__tests__") recorrer(archivo);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(archivo) || /\.(test|spec)\./.test(archivo)) continue;
      if (archivo === path.join("src", "lib", "fechas-montevideo.ts")) continue;
      const fuente = ts.createSourceFile(archivo, fs.readFileSync(archivo, "utf8"), ts.ScriptTarget.Latest, true);
      function visitar(nodo: ts.Node) {
        if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier)
          && nodo.moduleSpecifier.text.startsWith("date-fns")) infracciones.push(archivo + ": date-fns");
        if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)
          && metodosLocales.has(nodo.expression.name.text)) infracciones.push(archivo + ": " + nodo.expression.name.text);
        if (ts.isNewExpression(nodo) && nodo.expression.getText(fuente) === "Date"
          && (nodo.arguments?.length ?? 0) > 1) infracciones.push(archivo + ": Date local");
        ts.forEachChild(nodo, visitar);
      }
      visitar(fuente);
    }
  }
  recorrer("src");
  expect(infracciones).toEqual([]);
});
