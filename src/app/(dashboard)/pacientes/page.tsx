import { PacientesView } from "./_components/pacientes-view";

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ archivado?: string }>;
}) {
  const params = await searchParams;
  return <PacientesView archivedToast={params.archivado === "1"} />;
}
