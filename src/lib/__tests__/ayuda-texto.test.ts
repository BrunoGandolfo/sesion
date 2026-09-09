import { describe, expect, it } from "vitest";
import { limpiarMarkdown, type EstadoMarkdown } from "@/lib/ayuda-texto";

function limpiarFragmentos(fragmentos: string[]) {
  let estado: EstadoMarkdown = { pendiente: "", linea: "inicio" };
  let texto = "";
  for (const fragmento of fragmentos) {
    const resultado = limpiarMarkdown(fragmento, estado);
    texto += resultado.texto;
    estado = resultado.estado;
  }
  return texto + limpiarMarkdown("", estado, true).texto;
}

describe("limpiarMarkdown", () => {
  it.each([
    [["Hola **Mar", "iana** cómo"], "Hola Mariana cómo"],
    [["Hola *", "*Mariana*", "* cómo"], "Hola Mariana cómo"],
    [["Hola _", "_Mariana_", "_ cómo"], "Hola Mariana cómo"],
    [["#", "##", " Título\n", "#", " Otro"], "Título\nOtro"],
    [["`", "`", "`texto`", "``"], "texto"],
    [["2 *", " 3 y un_", "nombre*"], "2 * 3 y un_nombre*"],
    [["Hola *", "", "*Mariana**"], "Hola Mariana"],
  ])("limpia %j", (fragmentos, esperado) => {
    expect(limpiarFragmentos(fragmentos)).toBe(esperado);
    expect(limpiarMarkdown(fragmentos.join(""))).toBe(esperado);
  });

  it("da el mismo resultado en cada corte posible y carácter por carácter", () => {
    const original = "## Hola **Mariana**\n__Cómo__ va `Agenda`\n# Pasos\n1. Abrí #2\n2 * 3_";
    const esperado = "Hola Mariana\nCómo va Agenda\nPasos\n1. Abrí #2\n2 * 3_";
    for (let corte = 0; corte <= original.length; corte++) {
      expect(limpiarFragmentos([original.slice(0, corte), original.slice(corte)])).toBe(esperado);
    }
    expect(limpiarFragmentos([...original])).toBe(esperado);
  });

  it("retiene el marcador sin mutar el estado de entrada", () => {
    const estado = Object.freeze({ pendiente: "", linea: "inicio" } as const);
    expect(limpiarMarkdown("Hola *", estado)).toEqual({
      texto: "Hola ", estado: { pendiente: "*", linea: "texto" },
    });
    expect(estado).toEqual({ pendiente: "", linea: "inicio" });
  });
});
