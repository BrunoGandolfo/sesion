// Lo que se ve al tocar "Cobros", antes de que el servidor conteste.
// El mismo dibujo que usa la rama "cargando" de cobros-view.tsx: allá va
// sólo el cuerpo, dentro del <Marco> de verdad; acá va con su marco, porque
// todavía no hay ninguno.

import { EsqueletoCobros } from "@/components/esqueletos";

export default function Loading() {
  return <EsqueletoCobros />;
}
