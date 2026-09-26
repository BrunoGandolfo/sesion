// @vitest-environment jsdom
//
// El primer test de componente del repo. La línea de arriba no es un
// comentario: es lo que le dice a vitest que este archivo corre en un DOM y
// no en node. Sin ella, `render` explota con "document is not defined".
// Ver la nota de vitest.config.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { SUAVE, TIEMPOS, TIEMPOS_LUPITA } from "@/lib/movimiento";
import { obtenerLupita, parpadear, reiniciarLupitaParaTests } from "@/lib/lupita-presencia";
import {
  Lupita,
  LupitaMenu,
  POSES_LUPITA,
  SEMICICLOS_PIENSA,
  TAMANOS_LUPITA,
  trazosDe,
  type PoseLupita,
} from "@/components/ui/lupita";

const preferencias = vi.hoisted(() => ({ reducido: false }));
vi.mock("framer-motion", async (importOriginal) => {
  const original = await importOriginal<typeof import("framer-motion")>();
  const exponer = (props: Record<string, unknown>) => ({
    "data-animate": JSON.stringify(props.animate),
    "data-initial": JSON.stringify(props.initial),
    "data-transition": JSON.stringify(props.transition),
  });
  return {
    ...original,
    useReducedMotion: () => preferencias.reducido,
    motion: {
      path: ({ animate, initial, transition, ...props }: import("react").ComponentProps<"path"> & {
        animate?: unknown; initial?: unknown; transition?: unknown;
      }) => <path {...props} data-motion-path="true" {...exponer({ animate, initial, transition })} />,
      circle: ({ animate, initial, transition, ...props }: import("react").ComponentProps<"circle"> & {
        animate?: unknown; initial?: unknown; transition?: unknown;
      }) => <circle {...props} data-motion-circle="true" {...exponer({ animate, initial, transition })} />,
      span: ({ children, animate, initial, transition, ...props }: import("react").ComponentProps<"span"> & {
        animate?: unknown; initial?: unknown; transition?: unknown;
      }) => <span {...props} data-motion-span="true" {...exponer({ animate, initial, transition })}>{children}</span>,
    },
  };
});
beforeEach(() => {
  preferencias.reducido = false;
  reiniciarLupitaParaTests();
});

const POSES: PoseLupita[] = POSES_LUPITA;

function dibujar(pose: PoseLupita, tamano?: number) {
  const { container } = render(<Lupita pose={pose} tamano={tamano} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error(`la pose ${pose} no dibujó nada`);
  return svg;
}

describe("Lupita", () => {
  it("dibuja las siete poses de 06-lupita-presencia.md", () => {
    expect(POSES).toEqual(["saluda", "senala", "celebra", "saluda-alto", "concentrada", "piensa", "asiente"]);
    for (const pose of POSES) {
      const svg = dibujar(pose);
      expect(svg.getAttribute("data-pose")).toBe(pose);
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      // Tallo, hoja grande y hoja chica: las dos hojas y media.
      expect(svg.querySelectorAll("path")).toHaveLength(3);
    }
  });

  it("dibuja cada pose distinta de las otras", () => {
    const dibujos = POSES.map((pose) => dibujar(pose).innerHTML);
    expect(new Set(dibujos).size).toBe(POSES.length);
  });

  it("es siempre decorativa: aria-hidden y sin foco", () => {
    for (const pose of POSES) {
      const svg = dibujar(pose);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      // Nada de texto accesible: el que habla es el texto de al lado.
      expect(svg.querySelector("title")).toBeNull();
    }
  });

  it("dibuja los tamaños documentados", () => {
    for (const tamano of Object.values(TAMANOS_LUPITA)) {
      const svg = dibujar("saluda", tamano);
      expect(svg.getAttribute("width")).toBe(String(tamano));
      expect(svg.getAttribute("height")).toBe(String(tamano));
    }
  });

  it("saca el punto dorado del brote a 20 px, donde ensucia", () => {
    expect(dibujar("celebra", TAMANOS_LUPITA.inline).querySelector("[data-brote]")).toBeNull();
    expect(
      dibujar("celebra", TAMANOS_LUPITA.junto).querySelector("[data-brote]"),
    ).not.toBeNull();
    expect(
      dibujar("celebra", TAMANOS_LUPITA.encabezado).querySelector("[data-brote]"),
    ).not.toBeNull();
    expect(
      dibujar("celebra", TAMANOS_LUPITA.vacio).querySelector("[data-brote]"),
    ).not.toBeNull();
  });

  it("conserva la pose cuando recibe cada movimiento con significado", () => {
    const movimientos = ["brota", "respira", "piensa", "habla", "celebra", "quieta"] as const;
    for (const movimiento of movimientos) {
      const { container } = render(
        <Lupita
          pose={movimiento === "celebra" ? "celebra" : "senala"}
          movimiento={movimiento}
        />,
      );
      expect(container.querySelector("[data-pose]")).not.toBeNull();
    }
  });
});

// ─── Movimiento ──────────────────────────────────────────────────────────────
//
// POR QUÉ CAMBIARON ESTOS TESTS
//
// Hasta la rama lupita-presencia, este archivo exigía que `respira`, `piensa`
// y `habla` se dibujaran quietos ("el estado %s no activa movimiento
// continuo"): 04-personaje.md decía "reposo quieto, sin pulsos ni loops". El
// dueño decidió que Lupita pase a ser una presencia que respira, parpadea y
// piensa de verdad (docs/diseno/06-lupita-presencia.md, sección 3), y esto
// lo reemplaza con los límites de esa decisión: respira sólo desde 32 px,
// sin un solo loop de framer-motion (la respiración es CSS), el vaivén de
// piensa es finito, cada gesto dura como mucho 600 ms, y con movimiento
// reducido no se mueve nada. Si este archivo cambia para aflojar uno de
// esos límites sin que 06 cambie antes, está mal.

it.each(["quieta", "habla"] as const)("%s se dibuja quieta", (movimiento) => {
  const { container } = render(<Lupita pose="saluda" movimiento={movimiento} tamano={72} />);
  expect(container.querySelector("[data-motion-span], [data-motion-path]")).toBeNull();
  expect(container.querySelector("svg")?.getAttribute("class")).toBeNull();
});

it("respira desde 32 px con la clase CSS, sin ningún loop de framer-motion", () => {
  for (const tamano of [32, 34, 72, 96]) {
    const { container, unmount } = render(<Lupita pose="saluda" movimiento="respira" tamano={tamano} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("lupita-respira");
    expect(container.querySelector("[data-motion-span], [data-motion-path]")).toBeNull();
    unmount();
  }
});

it("a 20 px no respira: sería un temblor de antialias (06, sección 3)", () => {
  const { container } = render(<Lupita pose="saluda" movimiento="respira" tamano={20} />);
  expect(container.querySelector("svg")?.getAttribute("class")).toBeNull();
});

it("piensa con un vaivén finito hasta el tope de 15 s, que termina en senala", () => {
  const { container } = render(<Lupita pose="saluda" movimiento="piensa" tamano={72} />);
  expect(container.querySelector("svg")?.getAttribute("data-pose")).toBe("senala");
  const caminos = container.querySelectorAll("[data-motion-path]");
  expect(caminos).toHaveLength(3);
  const transicion = JSON.parse(caminos[0].getAttribute("data-transition")!);
  expect(transicion.duration).toBe(TIEMPOS_LUPITA.pensamiento / 1000);
  expect(transicion.repeatType).toBe("reverse");
  expect(Number.isFinite(transicion.repeat)).toBe(true);
  // Semiciclos pares: termina donde empezó, en senala.
  expect((transicion.repeat + 1) % 2).toBe(0);
  expect((transicion.repeat + 1) * TIEMPOS_LUPITA.pensamiento).toBeLessThanOrEqual(15_000);
  expect(SEMICICLOS_PIENSA).toBe(transicion.repeat + 1);
  // El brote va y viene con la punta del tallo, no queda flotando.
  const brote = container.querySelector("[data-motion-circle]")!;
  expect(JSON.parse(brote.getAttribute("data-animate")!).cx).toHaveLength(2);
  expect(JSON.parse(brote.getAttribute("data-transition")!)).toEqual(transicion);
});

it.each([
  ["saludo", "saluda-alto"],
  ["cobro", "celebra"],
  ["asiente", "asiente"],
] as const)("el gesto %s va y vuelve por %s en 600 ms o menos", (movimiento, medio) => {
  const { container } = render(<Lupita pose="saluda" movimiento={movimiento} tamano={34} />);
  const caminos = [...container.querySelectorAll("[data-motion-path]")];
  expect(caminos).toHaveLength(3);
  const partes = ["tallo", "hojaGrande", "hojaChica"] as const;
  caminos.forEach((camino, i) => {
    const d = JSON.parse(camino.getAttribute("data-animate")!).d as string[];
    expect(d).toEqual([trazosDe("saluda")[partes[i]], trazosDe(medio)[partes[i]], trazosDe("saluda")[partes[i]]]);
    const transicion = JSON.parse(camino.getAttribute("data-transition")!);
    expect(transicion.duration * 1000).toBeLessThanOrEqual(600);
    expect(transicion.ease).toEqual([...SUAVE]);
    expect(transicion.repeat).toBeUndefined();
  });
  // El punto dorado viaja con el tallo, con la misma transición.
  const brote = container.querySelector("[data-motion-circle]")!;
  expect(JSON.parse(brote.getAttribute("data-animate")!).cx).toHaveLength(3);
  expect(JSON.parse(brote.getAttribute("data-transition")!)).toEqual(
    JSON.parse(caminos[0].getAttribute("data-transition")!),
  );
  // Durante el gesto no respira: el gesto interrumpe la respiración.
  expect(container.querySelector("svg")?.getAttribute("class")).toBeNull();
});

it.each(["brota", "celebra", "retira"] as const)("el gesto %s termina con la curva y duración compartidas", (movimiento) => {
  const { container } = render(<Lupita pose="saluda" movimiento={movimiento} />);
  const transicion = JSON.parse(container.querySelector("[data-motion-span]")!.getAttribute("data-transition")!);
  expect(transicion).toEqual({ duration: TIEMPOS.pliegue / 1000, ease: [...SUAVE] });
});

it("parpadea con la hoja chica cuando late el reloj, no al aparecer", () => {
  const { container } = render(<Lupita pose="saluda" movimiento="respira" tamano={34} />);
  expect(container.querySelector("[data-parpadeo]")).toBeNull();
  act(() => parpadear());
  const chica = container.querySelector("[data-parpadeo]")!;
  expect(chica).not.toBeNull();
  const transicion = JSON.parse(chica.getAttribute("data-transition")!);
  expect(transicion.duration).toBe(TIEMPOS_LUPITA.parpadeo / 1000);
  const d = JSON.parse(chica.getAttribute("data-animate")!).d as string[];
  expect(d[0]).toBe(d[2]);
  expect(d[1]).not.toBe(d[0]);
});

it("una que no vive no parpadea", () => {
  const { container } = render(<Lupita pose="saluda" movimiento="quieta" tamano={96} />);
  act(() => parpadear());
  expect(container.querySelector("[data-parpadeo]")).toBeNull();
});

it("una de contenido viva se anota en el almacén; la posada no", () => {
  const { unmount } = render(<Lupita pose="saluda" movimiento="respira" tamano={96} />);
  expect(obtenerLupita().vivasEnContenido).toBe(1);
  unmount();
  expect(obtenerLupita().vivasEnContenido).toBe(0);
  render(<Lupita pose="saluda" movimiento="respira" tamano={34} enPosada />);
  expect(obtenerLupita().vivasEnContenido).toBe(0);
});

const MOVIMIENTOS = [
  "brota", "respira", "piensa", "habla", "celebra", "quieta", "retira", "saludo", "cobro", "asiente",
] as const;

it.each(MOVIMIENTOS)("con movimiento reducido %s muestra sólo la pose fija", (movimiento) => {
  preferencias.reducido = true;
  const { container } = render(<Lupita pose="saluda" movimiento={movimiento} tamano={72} />);
  act(() => parpadear());
  expect(container.querySelector("span")).toBeNull();
  expect(container.querySelector("[data-motion-path]")).toBeNull();
  expect(container.querySelector("svg")?.getAttribute("class")).toBeNull();
  // Los estados se ven en su pose; los gestos, no: no hay cambio de pose que
  // valga por medio segundo de movimiento.
  expect(container.querySelector("svg")?.getAttribute("data-pose")).toBe(
    movimiento === "piensa" || movimiento === "habla" ? "senala" : movimiento === "celebra" ? "celebra" : "saluda",
  );
  expect(obtenerLupita().vivasEnContenido).toBe(0);
});

it("recibir otro fragmento conserva el dibujo quieto", () => {
  const { container, rerender } = render(<Lupita pose="saluda" movimiento="habla" pulso={1} />);
  const primero = container.querySelector("svg");
  rerender(<Lupita pose="saluda" movimiento="habla" pulso={2} />);
  expect(container.querySelector("svg")).toBe(primero);
  expect(container.querySelector("[data-motion-span]")).toBeNull();
});

it("el menú hace un bob de 3 px por toque, sin loop ni movimiento reducido", () => {
  const { container, rerender } = render(<LupitaMenu toque={0} />);
  const antes = container.firstElementChild;
  expect(JSON.parse(antes!.getAttribute("data-animate")!)).toEqual({ y: 0 });
  rerender(<LupitaMenu toque={1} />);
  expect(container.firstElementChild).not.toBe(antes);
  expect(JSON.parse(container.firstElementChild!.getAttribute("data-animate")!)).toEqual({ y: [0, -3, 0] });
  expect(JSON.parse(container.firstElementChild!.getAttribute("data-transition")!)).toEqual({ duration: 0.15, ease: [...SUAVE] });
  preferencias.reducido = true;
  rerender(<LupitaMenu toque={2} />);
  expect(container.querySelector("span")).toBeNull();
});
