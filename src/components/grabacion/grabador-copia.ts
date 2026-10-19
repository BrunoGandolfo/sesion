"use client";

// La copia en el teléfono de la grabación en curso (seguimientoDeCopia): si
// alguna escritura a IndexedDB falló (cuota llena, modo privado), la
// pantalla lo sabe mientras graba y deja de prometer que lo grabado está a
// salvo ahí. Lo usa useGrabador (GrabadorSesion.tsx): cada grabación nueva,
// o una recuperada del teléfono, empieza con una copia nueva y sin falla.

import * as React from "react";

import { seguimientoDeCopia, type SeguimientoDeCopia } from "@/lib/grabacion-storage";

export function useCopiaDelTelefono() {
  const [copiaFallida, setCopiaFallida] = React.useState(false);
  const copiaRef = React.useRef<SeguimientoDeCopia>(seguimientoDeCopia());

  const nuevaCopia = React.useCallback((): SeguimientoDeCopia => {
    setCopiaFallida(false);
    // Una escritura de la grabación anterior que falla tarde no marca ésta.
    const copia: SeguimientoDeCopia = seguimientoDeCopia(() => {
      if (copiaRef.current === copia) setCopiaFallida(true);
    });
    copiaRef.current = copia;
    return copia;
  }, []);

  return { copiaRef, copiaFallida, nuevaCopia };
}
