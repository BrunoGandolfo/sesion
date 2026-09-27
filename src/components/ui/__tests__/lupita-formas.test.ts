// Todas las poses de Lupita comparten la misma forma de trazo.
//
// framer-motion interpola un `d` de SVG número por número y sólo si los dos
// caminos tienen los mismos comandos; si no, salta de uno al otro sin
// transición. Antes de 06-lupita-presencia.md el tallo de saluda y celebra
// era `M…V…` y el de senala `M…C…`, y por eso sólo morfaban las hojas. Ahora
// cualquier pose puede morfar a cualquier otra (gestos, vaivén, parpadeo), y
// este test lo sostiene: si una pose nueva se dibuja con otros comandos o
// con otra cantidad de números, falla antes de que se note como un salto.

import { describe, expect, it } from "vitest";

import { POSES_LUPITA, trazosDe } from "@/components/ui/lupita";

/** Letras de comando y cantidad de números: la "firma" de un `d`. */
function firma(d: string): string {
  const letras = d.replace(/[^A-Za-z]/g, "");
  const numeros = d.match(/-?\d*\.?\d+/g) ?? [];
  return `${letras}:${numeros.length}`;
}

describe("las formas de Lupita", () => {
  const partes = ["tallo", "hojaGrande", "hojaChica"] as const;

  it.each(partes)("%s tiene la misma firma en las siete poses y en la hoja plegada", (parte) => {
    const firmas = new Set(
      POSES_LUPITA.flatMap((pose) => [firma(trazosDe(pose)[parte]), firma(trazosDe(pose, true)[parte])]),
    );
    expect(firmas.size).toBe(1);
  });

  it("el tallo es una sola cúbica y cada hoja dos que se cierran", () => {
    expect(firma(trazosDe("saluda").tallo)).toBe("MC:8");
    expect(firma(trazosDe("saluda").hojaGrande)).toBe("MCZ:14");
  });

  it("la hoja chica plegada es otra forma, con la misma base y la misma punta", () => {
    for (const pose of POSES_LUPITA) {
      const abierta = trazosDe(pose).hojaChica;
      const plegada = trazosDe(pose, true).hojaChica;
      expect(plegada).not.toBe(abierta);
      const puntos = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      const [a, p] = [puntos(abierta), puntos(plegada)];
      // Base (0,1), punta (6,7) y vuelta a la base (12,13).
      for (const i of [0, 1, 6, 7, 12, 13]) expect(p[i]).toBe(a[i]);
    }
  });

  it("no hay cara: ni ojos ni boca, sólo tallo, dos hojas y el brote", () => {
    for (const pose of POSES_LUPITA) {
      expect(Object.keys(trazosDe(pose))).toEqual(["tallo", "hojaGrande", "hojaChica"]);
    }
  });
});
