import type * as React from "react";

import { ContenedorSesion } from "./_components/contenedor-sesion";

// Las tres caras de una sesión —la nota (/sesiones/[id]), "Para vos"
// (/para-vos) y la transcripción (/transcripcion)— son un solo contenedor,
// y vive acá y no en cada página: Next no vuelve a montar un layout al
// navegar entre sus páginas. Antes cada página montaba el suyo, y cambiar de
// cara volvía a pedir la fila y hacía esperar a la transcripción detrás de
// esa lectura. Las páginas sólo nombran la cara (ver contenedor-sesion.tsx)
// y no dibujan nada.
//
// La espera de la ruta es sesiones/loading.tsx, un nivel arriba: un
// loading.tsx en esta carpeta envolvería a las páginas y dibujaría el
// esqueleto debajo del contenedor en cada cambio de cara.

export default async function SesionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <ContenedorSesion id={id} />
      {children}
    </>
  );
}
