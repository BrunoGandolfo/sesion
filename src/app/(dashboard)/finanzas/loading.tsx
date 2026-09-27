// Lo que se ve al tocar "Finanzas", antes de que el servidor conteste. El
// mismo dibujo que la rama "cargando" de finanzas-view.tsx.

import { EsqueletoFinanzas } from "@/components/esqueletos";

export default function Loading() {
  return <EsqueletoFinanzas />;
}
