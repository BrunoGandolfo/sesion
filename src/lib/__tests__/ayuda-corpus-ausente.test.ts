// Unitario — qué ve la usuaria si el corpus no se puede leer.
//
// El comentario de despliegue de src/lib/ayuda-corpus.ts decía que /api/ayuda
// contestaba ERROR_CORPUS_AUSENTE. No es así: el caso de uso arma el prompt
// dentro del mismo try que llama al proveedor, y el error sale como 502 con el
// mensaje de proveedor caído. Esta prueba fija lo que el comentario ahora dice.

import { expect, it, vi } from "vitest";

import { ErrorCorpus } from "@/lib/ayuda-corpus";
import { MENSAJE_PROVEEDOR_CAIDO, responderAyudaStreaming } from "@/app/api/_lib/casos-uso/responder-ayuda";

vi.mock("@/lib/ayuda-corpus", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ayuda-corpus")>();
  return {
    ...original,
    systemPromptAyuda: () => {
      throw new original.ErrorCorpus("docs/ayuda/_indice.md", new Error("ENOENT"));
    },
  };
});

it("sin corpus, la ayuda contesta 502 con el mensaje de proveedor caído y nunca muestra ERROR_CORPUS_AUSENTE", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const crearStreaming = vi.fn();
  try {
    const pedido = responderAyudaStreaming({ pregunta: "¿Dónde cambio la tarifa?", apiKey: "clave", crearStreaming });
    await expect(pedido).rejects.toMatchObject({ status: 502, message: MENSAJE_PROVEEDOR_CAIDO });
    await expect(pedido).rejects.not.toMatchObject({ message: expect.stringContaining("ERROR_CORPUS_AUSENTE") });
    expect(crearStreaming).not.toHaveBeenCalled();
    // El log de la función sí conserva la causa real.
    expect(error).toHaveBeenCalledWith("[ayuda] fallo del proveedor", expect.any(ErrorCorpus));
  } finally {
    error.mockRestore();
  }
});
