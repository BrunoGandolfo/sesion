import { SesionDetailView } from "../_components/sesion-detail-view";

// "Para vos" de una sesión: la vista hermana de la nota, con URL propia.
//
// Monta el mismo contenedor que /sesiones/[id] con `vista="para-vos"`: una
// sola carga, un solo polling, una sola cabecera. Ver la nota de cabecera de
// sesion-detail-view.tsx.

export default async function ParaVosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SesionDetailView id={id} vista="para-vos" />;
}
