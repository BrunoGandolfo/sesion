// El cifrado del audio antes de que salga del dispositivo.
//
// Este tramo nunca había tenido un test, y es el que más importa: si acá se
// rompe algo, o el audio de una sesión clínica viaja en claro, o viaja
// indescifrable y la sesión se perdió.
//
// Se usa Web Crypto DE VERDAD (Node 22 la trae en globalThis), no un doble:
// lo que se prueba es que lo que sale se pueda volver a abrir con la clave y
// el IV que salieron con él. Un doble probaría que se llamó a una función,
// que es exactamente lo que no interesa.

import { describe, expect, it } from "vitest";

import { descifrar } from "@/lib/crypto";
import {
  cifrarGrabacion,
  GrabacionVaciaError,
} from "@/lib/grabacion-cifrado";

const PAUSAS = [
  { inicio: "2026-09-05T15:10:00.000Z", fin: "2026-09-05T15:12:00.000Z" },
];

/** Chunks como los entrega el MediaRecorder: uno por segundo. */
function chunksDe(...textos: string[]): Blob[] {
  return textos.map((t) => new Blob([t], { type: "audio/webm" }));
}

async function texto(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

describe("cifrarGrabacion", () => {
  it("lo cifrado se vuelve a abrir con su clave y su IV", async () => {
    const datos = await cifrarGrabacion({
      chunks: chunksDe("hola ", "sesión ", "clínica"),
      mimeType: "audio/webm;codecs=opus",
      duracionSegundos: 3,
      pausas: [],
    });

    const abierto = await descifrar(
      // El blob cifrado se vuelve a base64 igual que lo hace la subida.
      Buffer.from(await datos.audioBlob.arrayBuffer()).toString("base64"),
      datos.claveCifrado,
      datos.ivCifrado,
    );

    expect(new TextDecoder().decode(abierto)).toBe("hola sesión clínica");
  });

  it("los chunks se concatenan en orden: es UN archivo, no varios", async () => {
    // La pausa manual usa MediaRecorder.pause(), así que todos los chunks son
    // del mismo archivo. Si se reordenaran, el audio saldría cortado.
    const datos = await cifrarGrabacion({
      chunks: chunksDe("1", "2", "3", "4"),
      mimeType: "audio/webm",
      duracionSegundos: 4,
      pausas: [],
    });

    const abierto = await descifrar(
      Buffer.from(await datos.audioBlob.arrayBuffer()).toString("base64"),
      datos.claveCifrado,
      datos.ivCifrado,
    );

    expect(new TextDecoder().decode(abierto)).toBe("1234");
  });

  it("el blob que sale NO contiene el audio en claro", async () => {
    const datos = await cifrarGrabacion({
      chunks: chunksDe("dato clinico sensible"),
      mimeType: "audio/webm",
      duracionSegundos: 1,
      pausas: [],
    });

    expect(await texto(datos.audioBlob)).not.toContain("dato clinico sensible");
    expect(datos.audioBlob.type).toBe("application/octet-stream");
  });

  it("cada grabación lleva su propia clave", async () => {
    // Reusar la clave entre sesiones rompería el crypto-shredding: borrar la
    // de una dejaría abiertas las otras.
    const uno = await cifrarGrabacion({
      chunks: chunksDe("a"),
      mimeType: "audio/webm",
      duracionSegundos: 1,
      pausas: [],
    });
    const dos = await cifrarGrabacion({
      chunks: chunksDe("a"),
      mimeType: "audio/webm",
      duracionSegundos: 1,
      pausas: [],
    });

    expect(uno.claveCifrado).not.toBe(dos.claveCifrado);
    expect(uno.ivCifrado).not.toBe(dos.ivCifrado);
    // Mismo texto, distinto cifrado: el IV cumple su función.
    expect(await texto(uno.audioBlob)).not.toBe(await texto(dos.audioBlob));
  });

  it("la clave abre lo suyo y nada más", async () => {
    const uno = await cifrarGrabacion({
      chunks: chunksDe("uno"),
      mimeType: "audio/webm",
      duracionSegundos: 1,
      pausas: [],
    });
    const dos = await cifrarGrabacion({
      chunks: chunksDe("dos"),
      mimeType: "audio/webm",
      duracionSegundos: 1,
      pausas: [],
    });

    await expect(
      descifrar(
        Buffer.from(await uno.audioBlob.arrayBuffer()).toString("base64"),
        dos.claveCifrado,
        uno.ivCifrado,
      ),
    ).rejects.toBeTruthy();
  });

  it("pasa la duración y las pausas tal cual, sin recalcularlas", async () => {
    // El cronómetro ya hizo esa cuenta (grabacion-cronometro.ts). Acá se
    // transportan: dos fuentes de verdad para la duración sería el bug.
    const datos = await cifrarGrabacion({
      chunks: chunksDe("a"),
      mimeType: "audio/webm",
      duracionSegundos: 2400,
      pausas: PAUSAS,
    });

    expect(datos.duracionSegundos).toBe(2400);
    expect(datos.pausas).toEqual(PAUSAS);
  });

  it("sin mimeType usa webm y no rompe", async () => {
    const datos = await cifrarGrabacion({
      chunks: chunksDe("a"),
      mimeType: "",
      duracionSegundos: 1,
      pausas: [],
    });

    expect(datos.audioBlob.size).toBeGreaterThan(0);
  });
});

describe("cifrarGrabacion — cuando no hay audio", () => {
  it("sin chunks lanza GrabacionVaciaError", async () => {
    await expect(
      cifrarGrabacion({
        chunks: [],
        mimeType: "audio/webm",
        duracionSegundos: 0,
        pausas: [],
      }),
    ).rejects.toBeInstanceOf(GrabacionVaciaError);
  });

  it("con chunks que suman cero bytes también", async () => {
    // El MediaRecorder entregó eventos pero el micrófono no capturó nada.
    await expect(
      cifrarGrabacion({
        chunks: [new Blob([]), new Blob([])],
        mimeType: "audio/webm",
        duracionSegundos: 5,
        pausas: [],
      }),
    ).rejects.toBeInstanceOf(GrabacionVaciaError);
  });

  it("el mensaje es el que ve la profesional, y no dice 'cifrado'", async () => {
    // Es un error distinto del de cifrado a propósito: sin audio no hay nada
    // que reintentar, y decirle "probá de nuevo" sería mandarla a perder el
    // tiempo.
    const error = await cifrarGrabacion({
      chunks: [],
      mimeType: "audio/webm",
      duracionSegundos: 0,
      pausas: [],
    }).catch((e: unknown) => e);

    expect((error as Error).message).toBe(
      "No se pudo capturar audio de la sesión.",
    );
  });
});
