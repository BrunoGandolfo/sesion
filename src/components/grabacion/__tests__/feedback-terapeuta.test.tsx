// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo
// que lo hace correr en un DOM.
//
// EL BUG QUE ESTE ARCHIVO CUIDA
//
// La nota tenía un guardián (`esFeedbackRenderizable`) que pedía dos arrays
// —`fortalezas` y `areasCrecimiento`— y, si faltaba cualquiera de los dos,
// no dibujaba NADA y no decía nada. El análisis existía, ella no se
// enteraba. "Para vos" es la mitad del diferencial del producto: esconderlo
// en silencio porque al payload le faltó una parte es el peor default
// posible.
//
// La regla nueva, y lo que se verifica acá: se muestra lo que llegó, con un
// aviso chico cuando falta algo; sólo se calla cuando no hay análisis.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  FeedbackTerapeutaView,
  hayParaVos,
  leerFeedback,
} from "@/components/grabacion/FeedbackTerapeutaView";
import { PARA_VOS_INCOMPLETO } from "@/lib/glosario";

const CITA = { timestamp: "12:30", quote: "eso me costó bastante" };

/** El mismo objeto sin una de sus claves: un payload al que le faltó una
 *  parte, que es exactamente el caso que este archivo cuida. */
function sinLaClave<T extends object>(objeto: T, clave: keyof T): Partial<T> {
  const copia = { ...objeto };
  delete copia[clave];
  return copia;
}

function score(valor: number | null) {
  return { score: valor, evidence: valor === null ? [] : [CITA] };
}

/** Un feedback MITI/CTS-R completo, como lo devuelve el procesador. */
function feedbackCompleto() {
  return {
    instrumento: "cbt_mi",
    mitiGlobales: {
      empathy: score(4),
      partnership: score(3),
      cultivatingChangeTalk: score(3),
      softeningSustainTalk: score(3),
    },
    ctsrSubset: {
      agendaSetting: score(4),
      feedback: score(3),
      collaboration: score(5),
      guidedDiscovery: score(4),
    },
    fortalezas: [{ descripcion: "Sostuvo el silencio", evidence: [CITA] }],
    areasCrecimiento: [
      {
        observacion: "Poca devolución",
        sugerencia: "Probá cerrar con una síntesis",
        evidence: [CITA],
      },
    ],
    sugerenciaProximaSesion: "Retomar el tema del trabajo",
  };
}

function feedbackGestalt() {
  return {
    instrumento: "gestalt",
    itemsGTFS: [
      { id: "gtfs_04", nombre: "Presencia dialogal", score: 1, evidence: [CITA] },
    ],
    fortalezas: [],
    areasCrecimiento: [],
    sugerenciaProximaSesion: "",
  };
}

describe("leerFeedback — el guardián que ya no esconde", () => {
  it("no lee nada donde no hay análisis", () => {
    for (const vacio of [null, undefined, "", 0, [], "un texto"]) {
      expect(leerFeedback(vacio)).toBeNull();
      expect(hayParaVos(vacio)).toBe(false);
    }
  });

  it("lee un feedback completo y lo marca como completo", () => {
    const leido = leerFeedback(feedbackCompleto());
    expect(leido).not.toBeNull();
    expect(leido?.completo).toBe(true);
    expect(leido?.instrumento).toBe("cbt_mi");
    expect(leido?.fortalezas).toHaveLength(1);
    expect(leido?.mitiGlobales?.empathy.score).toBe(4);
    expect(leido?.ctsrSubset?.collaboration.score).toBe(5);
  });

  it("un feedback sin discriminador es MITI/CTS-R, como antes del contrato", () => {
    const leido = leerFeedback(sinLaClave(feedbackCompleto(), "instrumento"));
    expect(leido?.instrumento).toBe("cbt_mi");
    expect(leido?.completo).toBe(true);
  });

  it("sin `fortalezas` NO se pierde el resto: lee lo demás y marca el hueco", () => {
    const sinFortalezas = sinLaClave(feedbackCompleto(), "fortalezas");
    const leido = leerFeedback(sinFortalezas);

    expect(leido).not.toBeNull();
    expect(leido?.completo).toBe(false);
    expect(leido?.fortalezas).toEqual([]);
    // Lo que sí llegó sigue estando entero: es todo el punto del arreglo.
    expect(leido?.areasCrecimiento).toHaveLength(1);
    expect(leido?.mitiGlobales).not.toBeNull();
    expect(hayParaVos(sinFortalezas)).toBe(true);
  });

  it("sin `areasCrecimiento` tampoco se esconde nada", () => {
    const leido = leerFeedback(
      sinLaClave(feedbackCompleto(), "areasCrecimiento"),
    );

    expect(leido?.completo).toBe(false);
    expect(leido?.areasCrecimiento).toEqual([]);
    expect(leido?.fortalezas).toHaveLength(1);
  });

  it("un bloque de instrumento roto no se dibuja con datos inventados", () => {
    const roto = { ...feedbackCompleto(), ctsrSubset: { agendaSetting: {} } };
    const leido = leerFeedback(roto);

    // Ni ceros ni "No determinable" puestos por la app: el bloque no está.
    expect(leido?.ctsrSubset).toBeNull();
    expect(leido?.completo).toBe(false);
    // Y el núcleo panteórico, que llegó bien, sigue en pie.
    expect(leido?.fortalezas).toHaveLength(1);
    expect(leido?.mitiGlobales).not.toBeNull();
  });

  it("descarta de a una las piezas que no tienen la forma del contrato", () => {
    const leido = leerFeedback({
      ...feedbackCompleto(),
      fortalezas: [
        { descripcion: "Esta sirve", evidence: [CITA, { quote: "sin minuto" }] },
        { evidence: [] },
      ],
    });

    expect(leido?.fortalezas).toHaveLength(1);
    expect(leido?.fortalezas[0].descripcion).toBe("Esta sirve");
    // La cita sin timestamp no se completa con nada: se descarta.
    expect(leido?.fortalezas[0].evidence).toEqual([CITA]);
  });

  it("lee el instrumento gestáltico por sus ítems", () => {
    const leido = leerFeedback(feedbackGestalt());
    expect(leido?.instrumento).toBe("gestalt");
    expect(leido?.itemsGTFS).toHaveLength(1);
    expect(leido?.completo).toBe(true);
    expect(leido?.mitiGlobales).toBeNull();
  });
});

describe("FeedbackTerapeutaView", () => {
  it("no dibuja nada cuando no hay análisis", () => {
    const { container } = render(
      <FeedbackTerapeutaView feedbackTerapeuta={undefined} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("dibuja el análisis completo sin ningún aviso", () => {
    render(<FeedbackTerapeutaView feedbackTerapeuta={feedbackCompleto()} />);

    expect(screen.getByText("Sostuvo el silencio")).toBeTruthy();
    expect(screen.getByText("Poca devolución")).toBeTruthy();
    expect(screen.queryByText(PARA_VOS_INCOMPLETO)).toBeNull();
  });

  it("con una parte faltante muestra lo que hay Y avisa", () => {
    render(
      <FeedbackTerapeutaView
        feedbackTerapeuta={sinLaClave(feedbackCompleto(), "fortalezas")}
      />,
    );

    // El aviso está…
    expect(screen.getByText(PARA_VOS_INCOMPLETO)).toBeTruthy();
    // …y lo que sí llegó también. Antes acá no había absolutamente nada.
    expect(screen.getByText("Poca devolución")).toBeTruthy();
    expect(screen.getByText("Retomar el tema del trabajo")).toBeTruthy();
  });

  it("un instrumento sin ítems evaluables lo dice, no se calla", () => {
    // Un análisis gestáltico donde ningún ítem se pudo acreditar desde la
    // transcripción sigue siendo información: que el audio no dejó huella
    // verbal dice más sobre el audio que sobre su trabajo
    // (docs/ayuda/09-para-vos-feedback.md). Se muestra.
    const sinItems = {
      instrumento: "gestalt",
      itemsGTFS: [],
      fortalezas: [],
      areasCrecimiento: [],
      sugerenciaProximaSesion: "",
    };
    expect(hayParaVos(sinItems)).toBe(true);

    render(<FeedbackTerapeutaView feedbackTerapeuta={sinItems} />);
    expect(screen.getByText(/Ningún ítem fue evaluable/)).toBeTruthy();
    expect(screen.queryByText(PARA_VOS_INCOMPLETO)).toBeNull();
  });

  it("un objeto vacío avisa en vez de desaparecer", () => {
    // `feedbackTerapeuta: {}` es un análisis que el procesador escribió mal.
    // Antes el guardián lo borraba de la pantalla sin decir nada; ahora la
    // pantalla dice que falta.
    expect(hayParaVos({})).toBe(true);

    render(<FeedbackTerapeutaView feedbackTerapeuta={{}} />);
    expect(screen.getByText(PARA_VOS_INCOMPLETO)).toBeTruthy();
  });
});
