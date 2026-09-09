// @vitest-environment jsdom
//
// Ver la nota de vitest.config.ts: la primera línea de este archivo es lo
// que lo hace correr en un DOM.
//
// Las dos caras de una sesión: que la nota perdió el plegable del final,
// que "Para vos" es una vista con la misma cabecera, y que esa vista cumple
// las reglas de docs/diseno/04-personaje.md — sin personaje, sin
// celebración, sin entrada animada, e idéntica con señal de riesgo.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";
import {
  CAMBIOS_SIN_APROBAR_MENSAJE,
  CAMBIOS_SIN_APROBAR_TITULO,
  IR_IGUAL,
  PARA_VOS,
  PARA_VOS_SIN_ANALISIS,
  PARA_VOS_SUBTITULO,
  QUEDARME,
  VISTA_NOTA,
} from "@/lib/glosario";

import { NotaSesionView } from "../nota-sesion-view";
import { ParaVosView } from "../para-vos-view";
import { SelectorVista, hrefDeVista } from "../selector-vista";

// El selector navega: alcanza con que el router exista.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
}));

const CITA = { timestamp: "05:49", quote: "no sé si puedo seguir así" };

const FEEDBACK = {
  instrumento: "gestalt",
  itemsGTFS: [
    { id: "gtfs_01", nombre: "Presencia dialogal", score: 1, evidence: [CITA] },
  ],
  fortalezas: [{ descripcion: "Sostuvo el silencio", evidence: [CITA] }],
  areasCrecimiento: [
    {
      observacion: "Poca devolución",
      sugerencia: "Cerrá con una síntesis",
      evidence: [CITA],
    },
  ],
  sugerenciaProximaSesion: "Retomar el tema del trabajo",
};

/** Señal de riesgo graduada, con la forma que valida el contrato. */
const RIESGO = {
  nivel: "moderado",
  indicadores: ["desesperanza"],
  evidencia: [CITA],
  notaParaTerapeuta: null,
};

/** Un tema largo, de los que el modelo escribe y desbordaban la pantalla. */
const TEMA_LARGO = "devolución diagnóstica e inestabilidad emocional";

function sesion(
  datos: Record<string, unknown> | null = {
    feedbackTerapeuta: FEEDBACK,
    temas: [TEMA_LARGO],
    materialNuevo: ["mudanza"],
  },
): SesionClinicaResponse {
  return {
    id: "ses_1",
    turnoId: "t_1",
    estado: "aprobado",
    duracionAudioSeg: 3000,
    audioR2Key: null,
    audioBorradoEn: null,
    notaSubjetivo: "Relató la semana.",
    notaObjetivo: "Se la vio cansada.",
    notaAnalisis: "Sigue el mismo hilo.",
    notaPlan: "Retomar el trabajo.",
    notaSoapOriginal: null,
    datosEstructurados: datos,
    modeloASR: null,
    modeloLLM: null,
    promptVersion: null,
    hablanteTerapeuta: null,
    procesadoEn: null,
    aprobadoEn: null,
    error: null,
    intentos: 1,
    createdAt: "2026-09-07T13:00:00.000Z",
    updatedAt: "2026-09-07T13:00:00.000Z",
    turno: {
      id: "t_1",
      fecha: "2026-09-07T13:00:00.000Z",
      paciente: { id: "p_1", nombre: "Lucía", apellido: "Fernández" },
    },
  } as unknown as SesionClinicaResponse;
}

/** Los ids que React genera con useId cambian entre montajes: para comparar
 *  dos dibujos hay que sacarlos. */
function sinIds(html: string): string {
  return html.replace(/_r_[0-9a-z]+_/g, "_id_");
}

const NOTA = {
  subjetivo: "Relató la semana.",
  objetivo: "Se la vio cansada.",
  analisis: "Sigue el mismo hilo.",
  plan: "Retomar el trabajo.",
};

describe("la nota clínica", () => {
  it("ya no lleva 'Para vos' adentro", () => {
    render(<NotaSesionView sesion={sesion()} nota={NOTA} editable={false} />);

    // La nota conserva sus plegables…
    expect(screen.getByText("Más de esta sesión")).toBeTruthy();
    // …y perdió el del final. El análisis vive en la vista hermana.
    expect(screen.queryByText(PARA_VOS)).toBeNull();
    expect(screen.queryByText("Sostuvo el silencio")).toBeNull();
  });

  it("los chips de temas envuelven en vez de salirse por el borde", () => {
    render(<NotaSesionView sesion={sesion()} nota={NOTA} editable={false} />);
    fireEvent.click(screen.getByText("Más de esta sesión"));

    // texto="libre" es lo que les saca whitespace-nowrap. Con "estado", el
    // tema largo producía un chip más ancho que el teléfono, en un layout
    // sin scroll horizontal: texto clínico recortado.
    expect(screen.getByText(TEMA_LARGO).getAttribute("data-texto")).toBe(
      "libre",
    );
    // "Apareció por primera vez" es la otra lista de texto del modelo.
    expect(screen.getByText("mudanza").getAttribute("data-texto")).toBe("libre");
  });

  it("dice la sección S sin ponerle género a nadie", () => {
    render(<NotaSesionView sesion={sesion()} nota={NOTA} editable={false} />);

    // El modelo de datos no tiene género (prisma/schema.prisma: Paciente).
    expect(screen.getByText("Lo relatado en sesión")).toBeTruthy();
    expect(screen.queryByText(/la paciente relató/)).toBeNull();
  });
});

describe("ParaVosView", () => {
  it("comparte la cabecera con la nota: misma paciente, misma fecha", () => {
    const { unmount } = render(
      <NotaSesionView sesion={sesion()} nota={NOTA} editable={false} />,
    );
    const enLaNota = screen.getByRole("heading", { level: 1 }).textContent;
    unmount();

    render(<ParaVosView sesion={sesion()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(enLaNota);
    expect(enLaNota).toBe("Lucía Fernández");
  });

  it("muestra el análisis entero, sin plegar", () => {
    render(<ParaVosView sesion={sesion()} />);

    expect(screen.getByText(PARA_VOS_SUBTITULO)).toBeTruthy();
    // Sin abrir nada: las fortalezas y las áreas están a la vista.
    expect(screen.getByText("Sostuvo el silencio")).toBeTruthy();
    expect(screen.getByText("Poca devolución")).toBeTruthy();
    expect(screen.getByText("Retomar el tema del trabajo")).toBeTruthy();
  });

  it("no lleva personaje, ni celebración, ni entrada animada", () => {
    const { container } = render(<ParaVosView sesion={sesion()} />);

    // Lupita se dibuja con data-pose; el check de confirmación es un <svg>
    // con trazo animado. Ninguno de los dos entra a esta pantalla.
    expect(container.querySelector("[data-pose]")).toBeNull();
    expect(screen.queryByText(/Lupita/)).toBeNull();
    // Ningún elemento con opacidad inicial: el contenido está cuando la
    // pantalla está. Las entradas de framer-motion arrancan en opacity 0.
    for (const nodo of container.querySelectorAll<HTMLElement>("*")) {
      expect(nodo.style.opacity).not.toBe("0");
    }
  });

  it("con señal de riesgo es idéntica", () => {
    const conRiesgo = render(
      <ParaVosView
        sesion={sesion({ feedbackTerapeuta: FEEDBACK, riesgoDetectado: RIESGO })}
      />,
    );
    const dibujoConRiesgo = sinIds(conRiesgo.container.innerHTML);
    conRiesgo.unmount();

    const sinRiesgo = render(<ParaVosView sesion={sesion()} />);
    expect(sinIds(sinRiesgo.container.innerHTML)).toBe(dibujoConRiesgo);
  });

  it("sin análisis lo dice y ofrece la vuelta a la nota", () => {
    render(<ParaVosView sesion={sesion({})} />);

    expect(screen.getByText(PARA_VOS_SIN_ANALISIS)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: VISTA_NOTA }).getAttribute("href"),
    ).toBe("/sesiones/ses_1");
  });
});

describe("SelectorVista — cambios sin aprobar", () => {
  beforeEach(() => push.mockClear());

  it("sin cambios, tocar la otra cara navega derecho", () => {
    render(<SelectorVista id="ses_1" vista="nota" />);
    fireEvent.click(screen.getByRole("tab", { name: PARA_VOS }));

    expect(push).toHaveBeenCalledWith("/sesiones/ses_1/para-vos");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("con cambios NO navega: pregunta primero", () => {
    render(<SelectorVista id="ses_1" vista="nota" tieneCambios />);
    fireEvent.click(screen.getByRole("tab", { name: PARA_VOS }));

    // Lo que el P1 pedía: la nota editada sigue montada.
    expect(push).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByText(CAMBIOS_SIN_APROBAR_TITULO)).toBeTruthy();
    expect(within(dialogo).getByText(CAMBIOS_SIN_APROBAR_MENSAJE)).toBeTruthy();
  });

  it("'Quedarme' cierra la pregunta y no navega", () => {
    render(<SelectorVista id="ses_1" vista="nota" tieneCambios />);
    fireEvent.click(screen.getByRole("tab", { name: PARA_VOS }));
    fireEvent.click(screen.getByRole("button", { name: QUEDARME }));

    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("'Ir igual' es lo único que navega con cambios", () => {
    render(<SelectorVista id="ses_1" vista="nota" tieneCambios />);
    fireEvent.click(screen.getByRole("tab", { name: PARA_VOS }));
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: IR_IGUAL }));
    expect(push).toHaveBeenCalledWith("/sesiones/ses_1/para-vos");
  });

  it("tocar la cara en la que ya está no pregunta nada", () => {
    render(<SelectorVista id="ses_1" vista="nota" tieneCambios />);
    fireEvent.click(screen.getByRole("tab", { name: VISTA_NOTA }));

    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("SelectorVista", () => {
  it("ofrece las dos caras y marca la que se está mirando", () => {
    render(<SelectorVista id="ses_1" vista="nota" />);
    const tablist = screen.getByRole("tablist");

    const nota = within(tablist).getByRole("tab", { name: VISTA_NOTA });
    const paraVos = within(tablist).getByRole("tab", { name: PARA_VOS });
    expect(nota.getAttribute("aria-selected")).toBe("true");
    expect(paraVos.getAttribute("aria-selected")).toBe("false");
  });

  it("cada cara tiene su URL", () => {
    expect(hrefDeVista("ses_1", "nota")).toBe("/sesiones/ses_1");
    expect(hrefDeVista("ses_1", "para-vos")).toBe("/sesiones/ses_1/para-vos");
  });
});
