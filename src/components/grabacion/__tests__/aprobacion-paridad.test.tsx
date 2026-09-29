// @vitest-environment jsdom
//
// Paridad pantalla ↔ servidor (forense 01, H1; decisión del dueño D1): para
// cada combinación de nivel de riesgo, flags y menciones, las casillas que
// DIBUJA la pantalla (RiesgoDetectadoBanner + MencionesNota) son exactamente
// las que el servidor EXIGE en POST /aprobar. Marcarlas todas deja pasar;
// dejar cualquiera sin marcar es un 400.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MencionesNota } from "@/components/clinico/MencionesNota";
import { RiesgoDetectadoBanner } from "@/components/grabacion/RiesgoDetectadoBanner";
import {
  clavesDeConfirmacion,
  confirmacionesDeCasillas,
  confirmacionesFaltantes,
  confirmacionesParaAprobar,
} from "@/lib/sesion-clinica/aprobacion";
import { flagRiesgoSchema, type DatosEstructurados } from "@/lib/sesion-clinica/schema";

afterEach(cleanup);

const NIVELES = ["ninguno", "bajo", "moderado", "alto", "inventado", null] as const;
const TODOS = flagRiesgoSchema.options as string[];
const JUEGOS_DE_FLAGS = [[], [TODOS[0]], [TODOS[1], TODOS[3]], TODOS];
const MENCIONES = [0, 2];

function datosDe(nivel: (typeof NIVELES)[number], flags: string[], menciones: number): DatosEstructurados {
  return {
    ...(nivel === null ? {} : { riesgoDetectado: { nivel, indicadores: [], evidencia: [], notaParaTerapeuta: null } as never }),
    flagsRiesgo: {
      ideacionSuicida: flags.includes("ideacionSuicida"),
      autolesion: flags.includes("autolesion"),
      violenciaTerceros: flags.includes("violenciaTerceros"),
      sintomasPsicoticos: flags.includes("sintomasPsicoticos"),
      crisisPanico: flags.includes("crisisPanico"),
      detalle: "",
    },
    ...(menciones > 0
      ? { riesgoLexico: { coincidencias: Array.from({ length: menciones }, (_, i) => ({ termino: `t${i}`, timestamp: "00:01", quote: `cita ${i}` })) } }
      : {}),
  };
}

/** Las claves de las casillas que la pantalla dibuja: se tocan todas y se
 *  anota lo que cada una informa. */
function casillasDeLaPantalla(datos: DatosEstructurados): string[] {
  const claves: string[] = [];
  const onRevisar = (clave: string) => { claves.push(clave); };
  const { container } = render(
    <>
      <RiesgoDetectadoBanner riesgoDetectado={datos.riesgoDetectado} flagsRiesgo={datos.flagsRiesgo} editable revisadas={new Set()} onRevisar={onRevisar} />
      <MencionesNota datos={datos} editable revisada={false} onRevisar={onRevisar} />
    </>,
  );
  const casillas = container.querySelectorAll('input[type="checkbox"]');
  casillas.forEach((c) => fireEvent.click(c));
  expect(claves).toHaveLength(casillas.length);
  cleanup();
  return claves;
}

describe("las casillas de la pantalla son las que exige el servidor", () => {
  const casos = NIVELES.flatMap((nivel) =>
    JUEGOS_DE_FLAGS.flatMap((flags) => MENCIONES.map((m) => [String(nivel), flags, m] as const)),
  );

  it.each(casos)("nivel %s, flags %j, %i menciones", (nivelTexto, flags, menciones) => {
    const nivel = nivelTexto === "null" ? null : (nivelTexto as (typeof NIVELES)[number]);
    const datos = datosDe(nivel, [...flags], menciones);
    const exigidas = confirmacionesParaAprobar(datos);
    const pantalla = casillasDeLaPantalla(datos);

    expect([...pantalla].sort()).toEqual([...clavesDeConfirmacion(exigidas)].sort());

    // Todas marcadas: el servidor no pide nada más.
    expect(confirmacionesFaltantes(exigidas, confirmacionesDeCasillas(exigidas, new Set(pantalla)))).toEqual([]);
    // Cualquiera sin marcar: el servidor la reclama.
    for (const clave of pantalla) {
      const menos = new Set(pantalla.filter((c) => c !== clave));
      expect(confirmacionesFaltantes(exigidas, confirmacionesDeCasillas(exigidas, menos))).toEqual([clave]);
    }
  });

  it("el nivel bajo y los flags piden casilla (D1)", () => {
    expect(clavesDeConfirmacion(confirmacionesParaAprobar(datosDe("bajo", [], 0)))).toEqual(["riesgoGraduado"]);
    expect(clavesDeConfirmacion(confirmacionesParaAprobar(datosDe("ninguno", ["autolesion"], 0)))).toEqual(["autolesion"]);
    expect(clavesDeConfirmacion(confirmacionesParaAprobar(datosDe("alto", [], 2)))).toEqual(["riesgoGraduado"]);
  });
});
