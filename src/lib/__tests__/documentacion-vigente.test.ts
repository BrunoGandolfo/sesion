import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DOCUMENTOS, revisarTexto, verificarDocumentacion } from "../../../scripts/ci/documentacion-vigente.mjs";

it("todos los archivos, métodos HTTP y variables citados existen", () => {
  const resultados = verificarDocumentacion();
  expect(resultados).toHaveLength(4);
  expect(resultados.flatMap(r => r.errores)).toEqual([]);
  expect(resultados.reduce((n, r) => n + r.rutas, 0)).toBeGreaterThan(40);
  expect(resultados.reduce((n, r) => n + r.http, 0)).toBeGreaterThan(15);
});
it("detecta una ruta inventada, una variable ausente y un método que la ruta no exporta", () => {
  const resultado = revisarTexto("`src/lib/no-existe.ts` `CLAVE_INVENTADA` `POST /api/health`", {
    existe: (ruta: string) => ruta === "src/app/api/health/route.ts",
    leer: () => "export function GET() {}",
    variables: new Set(),
  });
  expect(resultado.errores).toEqual([
    "No existe: src/lib/no-existe.ts",
    "Falta en .env.example: CLAVE_INVENTADA",
    "Método HTTP ausente: POST /api/health",
  ]);
});
it("rechaza un enlace de archivo roto y una ruta HTTP eliminada", () => {
  const resultado = revisarTexto("[archivo](docs/inventado.md) `GET /api/borrada`", {
    existe: () => false, leer: () => "", variables: new Set(),
  });
  expect(resultado.errores).toHaveLength(2);
});
it("los cuatro documentos no reintroducen configuración ni contratos retirados", () => {
  for (const archivo of DOCUMENTOS) {
    const texto = readFileSync(archivo, "utf8");
    expect(texto, archivo).not.toMatch(/NEXTAUTH_URL|NOTES_ENCRYPTION_KEY|WhatsApp|ALERTA_WEBHOOK_URL|SEED_SECRET|SEED_USER_PASSWORD/);
    expect(texto, archivo).not.toMatch(/PATCH \/api\/sesion-clinica/);
  }
});
