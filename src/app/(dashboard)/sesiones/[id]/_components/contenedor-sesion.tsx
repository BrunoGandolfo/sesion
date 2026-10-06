"use client";

import { useSelectedLayoutSegment } from "next/navigation";

import { vistaDeSegmento } from "./datos";
import { SesionDetailView } from "./sesion-detail-view";

// El contenedor de las tres caras de una sesión, montado por
// sesiones/[id]/layout.tsx. Un layout no se vuelve a montar al navegar entre
// sus páginas: cambiar de cara cambia `vista` y nada más; la fila que ya
// llegó, el polling y el borrador siguen donde estaban. La cara la dice la
// URL, por el segmento debajo de [id].

export function ContenedorSesion({ id }: { id: string }) {
  const vista = vistaDeSegmento(useSelectedLayoutSegment());
  return <SesionDetailView id={id} vista={vista} />;
}
