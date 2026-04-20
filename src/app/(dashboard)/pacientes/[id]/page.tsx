import { PacienteDetailView } from "./_components/paciente-detail-view";

export default async function PacienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PacienteDetailView id={id} />;
}
