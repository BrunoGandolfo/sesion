import { RecorridoImprimible } from "./_components/recorrido-imprimible";

export default async function ImprimirRecorridoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecorridoImprimible pacienteId={id} />;
}
