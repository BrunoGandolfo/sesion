import { LIMITE_SEGUNDOS, AVISO_LIMITE_SEGUNDOS } from "@/lib/grabacion-captura";

import { beforeEach, describe, expect, it } from "vitest";

import { leerCorpus, olvidarCorpus, systemPromptAyuda } from "@/lib/ayuda-corpus";

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

it("la ayuda explica el rechazo de solapamientos y permite turnos consecutivos", () => {
  const texto = documento("03-agenda-y-turnos.md");
  expect(texto).toContain("No permite superponer turnos");
  expect(texto).toContain("no se guarda el cambio");
  expect(texto).toContain("justo cuando termina el anterior");
  expect(texto).not.toContain("No avisa de choques");
});

it("no aconseja bloquear el teléfono ni garantiza recuperar una interrupción", () => {
  for (const archivo of ["07-grabar-una-sesion.md", "13-preguntas-frecuentes.md"]) {
    expect(documento(archivo)).toMatch(/No bloquees la pantalla/);
    expect(documento(archivo)).not.toContain("Podés bloquear la pantalla");
  }
  const prompt = systemPromptAyuda();
  expect(prompt).toContain("La recuperación completa no está garantizada");
  expect(prompt).not.toContain("La llamada se llevó el micrófono, no la sesión");
});

it("los minutos que enseña la ayuda coinciden con los límites de captura", () => {
  const texto = documento("07-grabar-una-sesion.md");
  expect(texto).toContain(`**${LIMITE_SEGUNDOS / 60} minutos**`);
  expect(texto).toContain(`**${AVISO_LIMITE_SEGUNDOS / 60} minutos**`);
  expect(texto).toContain("todavía tenés que terminar y guardar");
  expect(texto).not.toContain("hora y media");
});

it.each(["04-pacientes-y-ficha.md", "07-grabar-una-sesion.md"])("%s ubica Grabar en la cabecera", (archivo) => {
  const texto = documento(archivo);
  expect(texto).toContain("cabecera");
  expect(texto).toContain("**Grabar**");
  expect(texto).not.toContain("Abajo del todo");
  expect(texto).not.toContain("Grabar** de abajo a la derecha");
});
