"use client";

import { Segmented } from "@/components/ui";

import { RANGOS, type RangoProgreso } from "./base";
import { PERIODO, RANGO_LABEL } from "./textos";

// Selector de período del Recorrido.
//
// Vive arriba de los gráficos y no arriba de la pestaña a propósito: el hilo
// (hipótesis, objetivos, el recorrido hasta hoy) no se recorta por período —
// es el proceso entero. Lo que el período acota es lo que se mide.

const OPCIONES = RANGOS.map((valor) => ({
  value: valor,
  label: RANGO_LABEL[valor],
}));

export function SelectorRango({
  valor,
  onCambio,
}: {
  valor: RangoProgreso;
  onCambio: (rango: RangoProgreso) => void;
}) {
  return (
    <Segmented
      options={OPCIONES}
      value={valor}
      onChange={onCambio}
      ariaLabel={PERIODO}
    />
  );
}
