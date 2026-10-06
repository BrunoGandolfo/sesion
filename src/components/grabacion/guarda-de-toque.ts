"use client";

// Tras Pausar o Reanudar el botón no responde por este rato: un doble toque
// no puede reanudar dos veces ni volver a pausar lo que acaba de reanudar.

import * as React from "react";

const GUARDA_TOQUE_MS = 800;

export function useGuardaDeToque() {
  const [conmutando, setConmutando] = React.useState(false);
  // La ref es la que decide (se lee dentro de los handlers); el estado sólo
  // deshabilita el botón.
  const activa = React.useRef(false);

  function tocar() {
    activa.current = true;
    setConmutando(true);
    window.setTimeout(() => {
      activa.current = false;
      setConmutando(false);
    }, GUARDA_TOQUE_MS);
  }

  return { conmutando, activa, tocar };
}
