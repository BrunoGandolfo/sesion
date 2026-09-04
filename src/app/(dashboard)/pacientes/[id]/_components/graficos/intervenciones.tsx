"use client";

import { formatearEtiqueta, mapaDeEtiquetas } from "@/lib/etiquetas";
import { fechaCorta } from "@/lib/format";
import { INTERVENCIONES } from "@/lib/glosario";

import { lecturaIntervenciones } from "../progreso-lecturas";
import {
  COLOR,
  BarrasPorFecha,
  ChartCard,
  fechaDe,
  type SesionProgreso,
} from "./base";
import { SUBTITULO_INTERVENCIONES } from "./textos";

// Intervenciones por sesión dentro del período.
//
// Antes había cinco cubetas fijas (validación, reformulación, señalamiento,
// confrontación y "Otros") y todo lo demás —interpretación, pregunta
// circular, silencio terapéutico— se sumaba a "Otros" y desaparecía. Una
// intervención tiene nombre técnico y se muestra con su nombre: acá las
// claves son las que vino a decir la API, ordenadas por frecuencia.

/** Color propio para los ocho tipos del contrato; el resto cicla la paleta.
 *  Que una clave desconocida aparezca con color prestado es preferible a
 *  meterla en una cubeta "Otros" que le borra el nombre. */
const COLOR_POR_TIPO: Record<string, string> = {
  validacion: COLOR.sage,
  reformulacion: COLOR.gold,
  senalamiento: COLOR.mint,
  confrontacion: COLOR.terracotta,
  interpretacion: COLOR.violeta,
  pregunta_circular: COLOR.sageSoft,
  silencio_terapeutico: COLOR.arena,
  otra: COLOR.gray,
};

const PALETA_EXTRA = [
  COLOR.violeta,
  COLOR.arena,
  COLOR.mint,
  COLOR.gold,
  COLOR.sageSoft,
  COLOR.gray,
];

export function IntervencionesChart({ sesiones }: { sesiones: SesionProgreso[] }) {
  // Claves presentes en el período, ordenadas por total descendente: la
  // intervención más usada queda abajo de la pila y primera en la leyenda.
  const totalPorClave = new Map<string, number>();
  for (const sesion of sesiones) {
    for (const [clave, cantidad] of Object.entries(sesion.intervenciones ?? {})) {
      if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
      totalPorClave.set(clave, (totalPorClave.get(clave) ?? 0) + cantidad);
    }
  }

  const claves = [...totalPorClave.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([clave]) => clave);

  if (claves.length === 0) {
    return (
      <ChartCard title={INTERVENCIONES} subtitle={SUBTITULO_INTERVENCIONES}>
        <p className="py-6 text-center text-[13px] text-ink-500">
          No hay intervenciones registradas en este período.
        </p>
      </ChartCard>
    );
  }

  const etiquetas = mapaDeEtiquetas(claves);
  const colores: Record<string, string> = {};
  let extra = 0;
  for (const clave of claves) {
    const propio = COLOR_POR_TIPO[clave.toLowerCase()];
    colores[clave] = propio ?? PALETA_EXTRA[extra++ % PALETA_EXTRA.length];
  }

  const porSesion = sesiones.map((sesion) => {
    const valores: Record<string, number> = {};
    for (const clave of claves) {
      valores[clave] = sesion.intervenciones?.[clave] ?? 0;
    }
    return valores;
  });

  const totales = porSesion.map((v) =>
    Object.values(v).reduce((a, b) => a + b, 0),
  );
  const maxTotal = Math.max(...totales, 1);
  const paso = Math.max(1, Math.ceil(maxTotal / 4));
  const yTop = Math.ceil(maxTotal / paso) * paso;
  const yTicks: number[] = [];
  for (let v = 0; v <= yTop; v += paso) yTicks.push(v);

  const barras = sesiones.map((sesion, i) => {
    const total = totales[i];
    const detalle =
      total === 0
        ? `${fechaCorta(fechaDe(sesion))} · sin intervenciones registradas`
        : `${fechaCorta(fechaDe(sesion))} · ${claves
            .filter((c) => porSesion[i][c] > 0)
            .map((c) => `${formatearEtiqueta(c)} ${porSesion[i][c]}`)
            .join(", ")}`;
    return { fecha: fechaDe(sesion), valores: porSesion[i], detalle };
  });

  const lectura = lecturaIntervenciones(porSesion, etiquetas);

  return (
    <ChartCard
      title={INTERVENCIONES}
      subtitle={SUBTITULO_INTERVENCIONES}
      lectura={lectura}
    >
      <BarrasPorFecha
        barras={barras}
        claves={claves}
        etiquetas={etiquetas}
        colores={colores}
        yTicks={yTicks}
        yMax={yTop}
        ariaLabel={`${INTERVENCIONES} por sesión`}
      />
    </ChartCard>
  );
}
