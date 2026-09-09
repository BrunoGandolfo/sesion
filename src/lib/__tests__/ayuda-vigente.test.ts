import { beforeEach, describe, expect, it } from "vitest";

import { leerCorpus, olvidarCorpus } from "@/lib/ayuda-corpus";

// Se prueba el material que recibe Lupita, no una copia de los documentos.
// Estas restricciones editoriales no certifican la respuesta del modelo.
function documento(nombre: string): string {
  const marca = `----- ${nombre} -----`;
  const corpus = leerCorpus();
  expect(corpus).toContain(marca);
  return corpus.split(marca)[1].split("----- ")[0].replace(/\s+/g, " ");
}

beforeEach(olvidarCorpus);

describe("la ayuda describe las acciones disponibles", () => {
  it.each([
    "00-que-es-sesion.md",
    "05-cobros.md",
    "06-recordatorios-sms.md",
  ])("%s explica el cobro por SMS con confirmación", (archivo) => {
    const texto = documento(archivo);
    expect(texto).toMatch(/Recordar\s+(?:\*\*)?cobro/i);
    expect(texto).toContain("SMS");
    expect(texto).toMatch(/confirmás el envío/);
    expect(texto).not.toMatch(/abre\s+\*?\*?WhatsApp|desde WhatsApp|lo mandás vos\)/i);
  });
});

it.each(["05-cobros.md", "13-preguntas-frecuentes.md"])("%s permite corregir un cobro sin reabrir el turno", (archivo) => {
  const texto = documento(archivo);
  expect(texto).toContain("**Deshacer cobro**");
  expect(texto).toContain("vuelve a la deuda");
  expect(texto).toMatch(/no vuelve a Agendado/i);
  expect(texto).not.toMatch(/no hay un botón para deshacer|No hay botón para deshacer/);
});
