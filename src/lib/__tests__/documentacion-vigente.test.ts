import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DOCUMENTOS, revisarTexto, verificarDocumentacion } from "../../../scripts/ci/documentacion-vigente.mjs";
import { RESERVA_HUERFANA_MS, RETENCION_OPERATIVA_DIAS } from "@/app/api/_lib/casos-uso/mantenimiento";
import { UMBRAL_HUERFANA_HORAS } from "@/lib/sesion-clinica/estados";

it("todos los archivos, métodos HTTP y variables citados existen", () => {
  const resultados = verificarDocumentacion();
  expect(resultados).toHaveLength(5);
  expect(DOCUMENTOS).toContain("docs/esquema.md");
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
// WhatsApp volvió como canal del recordatorio (casos-uso/recordatorios-whatsapp.ts):
// lo retirado es el enlace viejo de cobros, buildWhatsAppUrl, y eso es lo que se vigila.
it("los documentos no reintroducen configuración ni contratos retirados", () => {
  for (const archivo of DOCUMENTOS) {
    const texto = readFileSync(archivo, "utf8");
    expect(texto, archivo).not.toMatch(/NEXTAUTH_URL|NOTES_ENCRYPTION_KEY|buildWhatsAppUrl|ALERTA_WEBHOOK_URL|SEED_SECRET|SEED_USER_PASSWORD/);
    expect(texto, archivo).not.toMatch(/PATCH \/api\/sesion-clinica/);
  }
});

// docs/esquema.md dice qué se borra y cuándo: los plazos son los del código.
it("la retención de esquema.md es la del mantenimiento", () => {
  const texto = readFileSync("docs/esquema.md", "utf8");
  const retencion = texto.slice(texto.indexOf("**Retención.**"), texto.indexOf("\n---", texto.indexOf("**Retención.**")));
  expect(retencion).toContain(`A los ${RETENCION_OPERATIVA_DIAS} días: \`intentos_acceso\``);
  expect(RESERVA_HUERFANA_MS).toBe(60 * 60 * 1000);
  expect(retencion).toContain("A la hora: las reservas de recuperación de clave");
  expect(retencion).toContain(`A los ${UMBRAL_HUERFANA_HORAS / 24} días: las \`sesiones_clinicas\` que quedaron sin terminar`);
  expect(retencion).not.toMatch(/no hay\s+borrado por antigüedad/);
});
