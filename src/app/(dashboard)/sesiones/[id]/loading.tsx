// Lo que se ve al abrir una nota, antes de que el servidor conteste.
// El mismo dibujo que usa la rama "cargando" de sesion-detail-view.tsx:
// allá va sólo el cuerpo (el "Volver" ya está dibujado y ya es tocable),
// acá va con él.

import { EsqueletoNota } from "@/components/esqueletos";

export default function Loading() {
  return <EsqueletoNota />;
}
