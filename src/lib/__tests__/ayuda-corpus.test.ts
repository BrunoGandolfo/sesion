// Unitario — el corpus y el system prompt del asistente de ayuda.
//
// Lo que se prueba no es "el prompt dice cosas lindas" sino tres invariantes
// que, si se rompen, no se notan hasta que el asistente contesta cualquier
// cosa en producción:
//
//   1. la lista ARCHIVOS_CORPUS y el directorio docs/ayuda/ coinciden (un
//      documento nuevo que nadie agregó a la lista es un documento que el
//      asistente no ve, y nada lo avisa);
//   2. los cinco límites están, uno por uno, con su texto exacto;
//   3. no quedan comentarios HTML —los bloques `<!-- fuentes: … -->` son
//      rutas de código y no tienen por qué llegarle a la usuaria.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  ARCHIVOS_CORPUS,
  DIRECTORIO_CORPUS,
  leerCorpus,
  LIMITES_ASISTENTE,
  NOMBRE_ASISTENTE,
  olvidarCorpus,
  quitarComentariosHtml,
  systemPromptAyuda,
} from "@/lib/ayuda-corpus";

beforeEach(() => {
  olvidarCorpus();
});

describe("quitarComentariosHtml", () => {
  it("saca un comentario de varias líneas", () => {
    const md = "antes\n<!-- fuentes:\nsrc/a.ts\nsrc/b.ts\n-->\ndespués";
    expect(quitarComentariosHtml(md)).toBe("antes\n\ndespués");
  });

  it("no se come el texto entre dos comentarios", () => {
    expect(quitarComentariosHtml("<!--a-->medio<!--b-->")).toBe("medio");
  });

  it("deja intacto un markdown sin comentarios", () => {
    expect(quitarComentariosHtml("# Título\n\ntexto")).toBe("# Título\n\ntexto");
  });
});

describe("ARCHIVOS_CORPUS", () => {
  it("es exactamente lo que hay en docs/ayuda/", () => {
    const enDisco = readdirSync(join(process.cwd(), DIRECTORIO_CORPUS))
      .filter((n) => n.endsWith(".md"))
      .sort();
    expect([...ARCHIVOS_CORPUS].sort()).toEqual(enDisco);
  });

  it("arranca por el índice", () => {
    expect(ARCHIVOS_CORPUS[0]).toBe("_indice.md");
  });
});

describe("leerCorpus", () => {
  it("trae los 16 documentos, cada uno con su encabezado", () => {
    const corpus = leerCorpus();
    for (const archivo of ARCHIVOS_CORPUS) {
      expect(corpus).toContain(`----- ${archivo} -----`);
    }
  });

  it("no deja ningún comentario HTML", () => {
    expect(leerCorpus()).not.toContain("<!--");
  });

  it("conserva el contenido: una frase de un documento del medio", () => {
    // Se lee del archivo, no se escribe a mano: así el test no se rompe
    // cuando alguien reescriba una línea de la documentación.
    const original = readFileSync(
      join(process.cwd(), DIRECTORIO_CORPUS, "07-grabar-una-sesion.md"),
      "utf8",
    );
    const primeraLinea = original.split("\n")[0];
    expect(leerCorpus()).toContain(primeraLinea);
  });

  it("respeta el orden de la lista", () => {
    const corpus = leerCorpus();
    const posiciones = ARCHIVOS_CORPUS.map((a) =>
      corpus.indexOf(`----- ${a} -----`),
    );
    const ordenadas = [...posiciones].sort((a, b) => a - b);
    expect(posiciones).toEqual(ordenadas);
  });

  it("memoiza: la segunda llamada devuelve la misma referencia", () => {
    expect(leerCorpus()).toBe(leerCorpus());
  });
});

describe("systemPromptAyuda", () => {
  it("se presenta con el nombre del asistente", () => {
    expect(systemPromptAyuda()).toContain(`Sos ${NOMBRE_ASISTENTE},`);
    expect(NOMBRE_ASISTENTE).toBe("Lupita");
  });

  // El corazón del asunto: los cinco límites, con el texto exacto.
  it.each(LIMITES_ASISTENTE.map((limite, i) => [i + 1, limite] as const))(
    "incluye el límite %i completo",
    (_n, limite) => {
      expect(systemPromptAyuda()).toContain(limite);
    },
  );

  it("son cinco límites", () => {
    expect(LIMITES_ASISTENTE).toHaveLength(5);
  });

  it("los límites de alcance y seguridad van ANTES del corpus", () => {
    const prompt = systemPromptAyuda();
    const ultimoLimite = prompt.indexOf(
      LIMITES_ASISTENTE[LIMITES_ASISTENTE.length - 1],
    );
    expect(ultimoLimite).toBeGreaterThan(-1);
    expect(ultimoLimite).toBeLessThan(prompt.indexOf("===== CORPUS"));
  });

  it("la regla de voz cierra el prompt después del corpus y los ejemplos", () => {
    const prompt = systemPromptAyuda();
    expect(prompt.endsWith(LIMITES_ASISTENTE[2])).toBe(true);
    expect(prompt.lastIndexOf(LIMITES_ASISTENTE[2])).toBeGreaterThan(prompt.indexOf("===== FIN DEL CORPUS ====="));
    expect(LIMITES_ASISTENTE[2]).toContain("Empezá cada respuesta con una frase corta y humana");
  });

  it("dice que no ve pacientes, turnos ni montos", () => {
    expect(systemPromptAyuda()).toContain(
      "No tenés acceso a sus pacientes, sus turnos ni sus montos",
    );
  });

  it("lleva el corpus adentro", () => {
    expect(systemPromptAyuda()).toContain(leerCorpus());
  });

  it("no tiene nada variable: dos llamadas dan el mismo texto", () => {
    const uno = systemPromptAyuda();
    olvidarCorpus();
    const dos = systemPromptAyuda();
    // Byte a byte: es lo que hace que el prompt caching sirva.
    expect(dos).toBe(uno);
  });
});
