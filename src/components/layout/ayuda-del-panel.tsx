"use client";

// Un solo panel de ayuda (Lupita) para todo el panel.
//
// Antes lo montaba cada menú: uno el lateral y otro el de abajo. Los dos
// menús viven en el layout a la vez —uno se oculta con CSS según el ancho—,
// así que en el teléfono había DOS paneles montados, cada uno con su
// conversación, y según desde dónde se abría se veía una u otra. Ahora el
// panel es uno, lo monta el layout, y los menús solo lo abren.

import * as React from "react";

import { PanelAyuda } from "@/components/ayuda/panel-ayuda";

const AbrirAyudaContext = React.createContext<(() => void) | null>(null);

export function AyudaDelPanel({ children }: { children: React.ReactNode }) {
  const [abierta, setAbierta] = React.useState(false);
  const abrir = React.useCallback(() => setAbierta(true), []);

  return (
    <AbrirAyudaContext.Provider value={abrir}>
      {children}
      <PanelAyuda abierto={abierta} alCerrar={() => setAbierta(false)} />
    </AbrirAyudaContext.Provider>
  );
}

/** Abre el panel de ayuda del layout. Fuera de él no hace nada. */
export function useAbrirAyuda(): () => void {
  return React.useContext(AbrirAyudaContext) ?? sinPanel;
}

function sinPanel() {}
