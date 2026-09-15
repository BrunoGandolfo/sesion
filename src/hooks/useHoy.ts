"use client";

import * as React from "react";
import { fechaInputMvd, finDelDiaMvd } from "@/lib/fechas-montevideo";

// El día de hoy, sin romper la hidratación.
//
// El problema que resuelve: construir un `new Date()` durante el render da
// resultados distintos en el servidor (UTC) y en el cliente (Montevideo).
// Cualquier texto derivado de esa fecha —el saludo, el día de la semana, la
// fecha larga del encabezado— salía distinto en cada lado, y ese mismatch
// disparaba React #418, que en producción deja la página montada pero sin
// ningún event handler: la app se ve bien y no responde a nada.
//
// Además, `new Date()` y `Date.now()` durante el render son llamadas impuras:
// el mismo render devuelve valores distintos cada vez que corre. Con este
// hook la fecha entra al componente como cualquier otro valor externo, y los
// useMemo que dependen de ella pueden declararla en sus dependencias.
//
// Cómo funciona: el store externo publica una *clave* del día (un string), no
// el Date. React compara snapshots con Object.is, así que devolver el string
// "2026-09-04" en llamadas consecutivas cuenta como el mismo valor y no
// hay bucle; devolver un `new Date()` no, porque cada objeto es distinto. El
// Date se construye una sola vez por clave, en el useMemo.

function suscribir(alCambiar: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const programar = () => {
    clearTimeout(timer);
    const ahora = new Date();
    timer = setTimeout(() => {
      alCambiar();
      programar();
    }, finDelDiaMvd(ahora).getTime() - ahora.getTime() + 1);
  };
  const alVolver = () => { alCambiar(); programar(); };
  const alCambiarVisibilidad = () => {
    if (document.visibilityState === "visible") alVolver();
  };
  programar();
  window.addEventListener("focus", alVolver);
  document.addEventListener("visibilitychange", alCambiarVisibilidad);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", alVolver);
    document.removeEventListener("visibilitychange", alCambiarVisibilidad);
  };
}

/** Clave estable del día: el mismo string en llamadas consecutivas. */
function claveDelDiaEnCliente(): string {
  return fechaInputMvd(new Date());
}

/** En el servidor no hay día: null, y el primer render sale sin fechas. */
function claveDelDiaEnServidor(): null {
  return null;
}

/**
 * `null` durante el render del servidor y hasta la hidratación; después, un
 * `Date` estable que solo cambia cuando cambia el día.
 *
 * Quien lo use tiene que contemplar el `null`: es el render que comparten
 * servidor y cliente, y es lo que hace que no haya mismatch.
 */
export function useHoy(): Date | null {
  const claveDelDia = React.useSyncExternalStore(
    suscribir,
    claveDelDiaEnCliente,
    claveDelDiaEnServidor,
  );

  return React.useMemo(
    () => (claveDelDia === null ? null : new Date()),
    [claveDelDia],
  );
}
