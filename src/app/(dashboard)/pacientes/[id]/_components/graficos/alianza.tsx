"use client";

import { ALIANZA_TERAPEUTICA } from "@/lib/glosario";

import { lecturaAlianza } from "../progreso-lecturas";
import {
  COLOR,
  ChartCard,
  LineaPorFecha,
  NOMBRE_ALIANZA,
  detalleDePunto,
  fechaDe,
  nivelDeAlianza,
  type SesionProgreso,
} from "./base";
import { HUECOS_EXPLICADOS, SUBTITULO_ALIANZA } from "./textos";

// El eje se rotula con los cuatro nombres del contrato, no con números: el
// orden 1..4 es un artificio para poder dibujar la línea, no una medida.
const ETIQUETAS_Y: Record<number, string> = {
  1: NOMBRE_ALIANZA.fragil,
  2: NOMBRE_ALIANZA.inestable,
  3: NOMBRE_ALIANZA.estable,
  4: NOMBRE_ALIANZA.fuerte,
};

export function AlianzaChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  const niveles = sesiones.map((s) => nivelDeAlianza(s.alianzaTerapeutica));

  const caidas = calcularCaidas(niveles);

  const puntos = sesiones.map((s, i) => ({
    fecha: fechaDe(s),
    valor: niveles[i],
    destacado: caidas[i],
    detalle: detalleDePunto(
      fechaDe(s),
      s.alianzaTerapeutica ? NOMBRE_ALIANZA[s.alianzaTerapeutica] : null,
    ),
  }));

  const hayHuecos = puntos.some((p) => p.valor === null);
  const lectura = lecturaAlianza(
    sesiones.map((s, i) => ({
      nivel: niveles[i],
      etiqueta: s.alianzaTerapeutica
        ? NOMBRE_ALIANZA[s.alianzaTerapeutica]
        : null,
    })),
  );

  return (
    <ChartCard
      title={ALIANZA_TERAPEUTICA}
      subtitle={SUBTITULO_ALIANZA}
      lectura={lectura}
    >
      <LineaPorFecha
        puntos={puntos}
        yMin={1}
        yMax={4}
        yTicks={[1, 2, 3, 4]}
        yLabels={ETIQUETAS_Y}
        color={COLOR.sage}
        fillColor="rgba(79,122,106,0.12)"
        ariaLabel={`${ALIANZA_TERAPEUTICA} por fecha`}
      />
      {hayHuecos ? (
        <p className="mt-2 text-[11px] leading-[1.45] text-ink-500">
          {HUECOS_EXPLICADOS}
        </p>
      ) : null}
    </ChartCard>
  );
}

// Una caída se mide contra el último nivel registrado, salteando las
// sesiones sin dato: comparar contra un hueco inventaría una ruptura.
function calcularCaidas(niveles: Array<number | null>): boolean[] {
  const caidas: boolean[] = [];
  let ultimoConDato: number | null = null;
  for (const nivel of niveles) {
    if (nivel === null) {
      caidas.push(false);
      continue;
    }
    caidas.push(ultimoConDato !== null && nivel < ultimoConDato);
    ultimoConDato = nivel;
  }
  return caidas;
}
