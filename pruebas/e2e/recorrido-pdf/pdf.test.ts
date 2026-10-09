// El lector de pruebas/e2e/recorrido-pdf: cuenta páginas y lee su tamaño,
// también cuando la página hereda la /MediaBox de /Pages.
import { expect, it } from "vitest";

import { medidasDePaginas } from "./pdf";

const pdf = [
  "%PDF-1.4",
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
  "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /MediaBox [0 0 612 792] >> endobj",
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 594.959961 841.919983] /Annots [6 0 R] >> endobj",
  "4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 594.96 841.92] >> endobj",
  "5 0 obj << /Type /Page /Parent 2 0 R >> endobj",
  "6 0 obj << /Type /Annot /Subtype /Link >> endobj",
].join("\n");

it("una medida por página, A4 redondeado, y la heredada de /Pages", () => {
  expect(medidasDePaginas(pdf)).toEqual(["595x842", "595x842", "612x792"]);
});

it("sin páginas, lista vacía", () => {
  expect(medidasDePaginas("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj")).toEqual([]);
});
