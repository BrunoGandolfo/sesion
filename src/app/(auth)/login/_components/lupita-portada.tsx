"use client";

// Lupita se presenta donde la portada la nombra ("Lupita, para orientarte"),
// no en la entrada: el encabezado y el formulario siguen institucionales.
//
// Brota una sola vez, cuando la sección entra en la vista. Hasta entonces el
// círculo crema ya ocupa su lugar, así nada se corre al aparecer. Con
// movimiento reducido (o sin IntersectionObserver) aparece de entrada y
// quieta: Lupita misma no se anima si la preferencia está puesta.
//
// Excepción a docs/diseno/04-personaje.md, que no lista la entrada entre sus
// lugares: la decisión y el motivo están en docs/diseno/07-portada.md.

import * as React from "react";

import { Lupita, TAMANOS_LUPITA } from "@/components/ui/lupita";

/** Qué parte de la sección tiene que verse para que brote. */
const UMBRAL_VISIBLE = 0.5;

export function LupitaPortada() {
  const lugar = React.useRef<HTMLSpanElement>(null);
  const [vista, setVista] = React.useState(false);

  React.useEffect(() => {
    const nodo = lugar.current;
    const quieta = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!nodo || quieta || typeof IntersectionObserver === "undefined") {
      setVista(true);
      return;
    }
    const observador = new IntersectionObserver((entradas) => {
      // El primer aviso llega al observar aunque se vea un píxel: se mira la
      // proporción, no sólo isIntersecting.
      if (!entradas.some((e) => e.isIntersecting && e.intersectionRatio >= UMBRAL_VISIBLE)) return;
      setVista(true);
      observador.disconnect();
    }, { threshold: UMBRAL_VISIBLE });
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  return (
    <span
      ref={lugar}
      aria-hidden="true"
      data-lupita-portada={vista ? "vista" : "esperando"}
      className="flex size-18 shrink-0 items-center justify-center rounded-full bg-cream-100"
    >
      {vista ? <Lupita pose="saluda" tamano={TAMANOS_LUPITA.encabezado} movimiento="brota" /> : null}
    </span>
  );
}
