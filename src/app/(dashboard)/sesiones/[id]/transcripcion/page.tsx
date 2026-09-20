import { SesionDetailView } from "../_components/sesion-detail-view";

// La transcripción de una sesión: tercera vista, con URL propia, igual que
// "Para vos". Monta el mismo contenedor con `vista="transcripcion"`; el texto
// se pide recién cuando esta vista se abre (ver transcripcion-view.tsx).

export default async function TranscripcionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SesionDetailView id={id} vista="transcripcion" />;
}
