import { SesionDetailView } from "./_components/sesion-detail-view";

export default async function SesionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SesionDetailView id={id} />;
}
