// Lo grabado se mide por los chunks recibidos. Estas cuentas son las que el
// 18/9 hicieron falta: el reloj de pared contó 170 minutos de una grabación
// que tenía 16, y el tope saltó al desbloquear el teléfono.

import { describe, expect, it } from "vitest";

import {
  AVISO_LIMITE_SEGUNDOS,
  contarChunk,
  crearReloj,
  estadoLimite,
  LIMITE_SEGUNDOS,
  medidaInicial,
  reanudarMedida,
  sinChunksDesde,
  type Medida,
} from "@/lib/grabacion-captura";

const T0 = 1_000_000;
const KB16 = 16_000;

/** `n` chunks puntuales de un segundo a partir de la medida dada. */
function grabar(medida: Medida, n: number): Medida {
  let actual = medida;
  for (let i = 0; i < n; i += 1) {
    actual = contarChunk(actual, KB16, actual.ultimoChunkEn + 1000);
  }
  return actual;
}

describe("cuánto se grabó", () => {
  it("cada chunk puntual vale el tiempo que pasó desde el anterior", () => {
    const medida = grabar(medidaInicial(T0), 60);
    expect(medida.segundos).toBe(60);
    expect(medida.chunks).toBe(60);
    expect(medida.bytes).toBe(60 * KB16);
    expect(medida.huecos).toEqual([]);
  });

  it("el reloj de pared no cuenta: veinte minutos de teléfono bloqueado no son audio", () => {
    const antes = grabar(medidaInicial(T0), 984);
    const bloqueado = 20 * 60 * 1000;
    // Al desbloquear vuelven los chunks normales, de un segundo de audio.
    const despues = grabar(contarChunk(antes, KB16, antes.ultimoChunkEn + bloqueado), 2);

    expect(despues.segundos).toBe(987);
    // El hueco empieza donde termina el audio que sí llegó y se declara cuando
    // los chunks vuelven a llegar a ritmo normal (un segundo después de volver).
    expect(despues.huecos).toEqual([{ desde: antes.ultimoChunkEn + 2000, hasta: antes.ultimoChunkEn + bloqueado + 1000 }]);
  });

  it("un chunk tardío que trae audio adentro se acredita por su tamaño, y no es un hueco", () => {
    const antes = grabar(medidaInicial(T0), 100);
    // La página no corrió 60 s, pero el navegador siguió capturando: llega un
    // solo chunk sesenta veces más grande.
    const despues = contarChunk(antes, 60 * KB16, antes.ultimoChunkEn + 60_000);

    expect(despues.segundos).toBe(160);
    expect(despues.huecos).toEqual([]);
  });

  it("una ráfaga de chunks atrasados (el hilo se trabó y el navegador los soltó juntos) cuenta entera y no es un hueco", () => {
    // Visto en Chromium: tras 8 s con el hilo ocupado llegan 8 chunks de un
    // segundo de audio cada uno, con milisegundos de diferencia.
    const antes = grabar(medidaInicial(T0), 30);
    let despues = contarChunk(antes, KB16, antes.ultimoChunkEn + 8000);
    for (let i = 1; i < 8; i += 1) despues = contarChunk(despues, KB16, despues.ultimoChunkEn + 3);
    despues = grabar(despues, 5);

    expect(Math.round(despues.segundos)).toBe(43);
    expect(despues.huecos).toEqual([]);
  });

  it("lo que hace Chromium de verdad: un chunk chico tarde y, un segundo después, uno enorme con todo el audio", () => {
    // Medido con el hilo trabado 10,8 s: llegan 13.540 bytes y, 1.033 ms
    // después, 176.954 (contra 16.438 de un chunk normal). No hay hueco.
    const antes = grabar(medidaInicial(T0), 40);
    const chico = contarChunk({ ...antes, bytes: 40 * 16_438 }, 13_540, antes.ultimoChunkEn + 10_789);
    const enorme = contarChunk(chico, 176_954, chico.ultimoChunkEn + 1_033);
    const despues = grabar(enorme, 5);

    expect(despues.huecos).toEqual([]);
    expect(Math.abs(despues.segundos - (40 + 10.789 + 1.033 + 5))).toBeLessThan(0.5);
  });

  it("nunca acredita más que el tiempo que pasó, por grande que sea el chunk", () => {
    const antes = grabar(medidaInicial(T0), 10);
    const despues = contarChunk(antes, 500 * KB16, antes.ultimoChunkEn + 30_000);
    expect(despues.segundos).toBe(40);
  });

  it("una pausa manual no es un hueco", () => {
    const pausada = grabar(medidaInicial(T0), 30);
    const reanudada = reanudarMedida(pausada, pausada.ultimoChunkEn + 10 * 60 * 1000);
    const despues = grabar(reanudada, 5);
    expect(despues.segundos).toBe(35);
    expect(despues.huecos).toEqual([]);
  });

  it("una grabación recuperada arranca de lo que ya traía", () => {
    expect(grabar(medidaInicial(T0, 120), 3).segundos).toBe(123);
  });
});

describe("sin chunks", () => {
  it("hasta cinco segundos de demora no es noticia", () => {
    const medida = grabar(medidaInicial(T0), 5);
    expect(sinChunksDesde(medida, medida.ultimoChunkEn + 5000)).toBeNull();
  });

  it("pasado el umbral dice desde cuándo no llega audio", () => {
    const medida = grabar(medidaInicial(T0), 5);
    expect(sinChunksDesde(medida, medida.ultimoChunkEn + 5001)).toBe(medida.ultimoChunkEn);
  });
});

describe("el tope se aplica sobre el audio recibido", () => {
  it("avisa a los 135 minutos y corta a los 150", () => {
    expect(estadoLimite(AVISO_LIMITE_SEGUNDOS - 1)).toBe("ok");
    expect(estadoLimite(AVISO_LIMITE_SEGUNDOS)).toBe("aviso");
    expect(estadoLimite(LIMITE_SEGUNDOS - 1)).toBe("aviso");
    expect(estadoLimite(LIMITE_SEGUNDOS)).toBe("limite");
  });

  it("169 minutos de reloj con 149 de audio NO llegan al tope", () => {
    // La sesión 02feb013: el tope saltó a los 169,7 min de reloj, al desbloquear.
    const antes = grabar(medidaInicial(T0), 149 * 60);
    const despues = grabar(contarChunk(antes, KB16, antes.ultimoChunkEn + 20 * 60 * 1000), 3);
    expect(estadoLimite(despues.segundos)).toBe("aviso");
    expect(despues.huecos).toHaveLength(1);
  });
});

describe("el reloj con que se mide no retrocede", () => {
  it("si el reloj de pared se corrige hacia atrás, sigue por el monotónico y no se come segundos", () => {
    // Medido en la máquina de pruebas: el reloj de pared retrocedía 2,4 s cada
    // treinta, y la grabación informaba 47 s de un audio de 52.
    let pared = 1_000_000;
    let mono = 50;
    const reloj = crearReloj(() => pared, () => mono);
    const inicio = reloj();
    pared += 1000; mono += 1000;
    expect(reloj() - inicio).toBe(1000);
    pared -= 2400; mono += 1000;
    expect(reloj() - inicio).toBe(2000);
    pared += 1000; mono += 1000;
    expect(reloj() - inicio).toBe(3000);
  });

  it("si el teléfono durmió y el monotónico no corrió, cuenta el reloj de pared: ese rato es el hueco", () => {
    let pared = 1_000_000;
    let mono = 50;
    const reloj = crearReloj(() => pared, () => mono);
    const inicio = reloj();
    pared += 20 * 60 * 1000; mono += 300;
    expect(reloj() - inicio).toBe(20 * 60 * 1000);
  });

  it("arranca en la hora de pared: sirve para decir entre qué horas no se grabó", () => {
    expect(crearReloj(() => 1_789_000_000_000, () => 0)()).toBe(1_789_000_000_000);
  });
});
