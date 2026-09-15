import Link from "next/link";
import { notFound } from "next/navigation";
import { buscarActor } from "@/app/api/_lib/auth";
import { consentimientoVigenteDe } from "@/lib/consentimiento";
import { db } from "@/lib/db";
import { formatearHoraMvd } from "@/lib/fechas-montevideo";
import { GrabarView } from "./_components/grabar-view";
export const dynamic = "force-dynamic";
export default async function GrabarPage({ params }: { params: Promise<{ turnoId: string }> }) {
  const [{ turnoId }, actor] = await Promise.all([params, buscarActor()]);
  if (!actor) notFound();
  if (turnoId === "nuevo") return <main className="p-6"><h1>Agendá el turno para grabar la sesión</h1><Link href="/agenda">Ir a la agenda</Link></main>;
  const { organizationId, userId } = actor;
  const turno = await db.turno.findFirst({ where: { id: turnoId, organizationId }, select: { id: true, fecha: true, paciente: { select: { id: true, nombre: true, apellido: true } } } });
  if (!turno) notFound();
  return <GrabarView turnoId={turno.id} organizationId={organizationId} cuenta={`${organizationId}:${userId}`} horaTexto={formatearHoraMvd(turno.fecha)} pacienteId={turno.paciente.id} pacienteNombre={`${turno.paciente.nombre} ${turno.paciente.apellido}`.trim()} autorizacionVigente={await consentimientoVigenteDe(db, turno.paciente.id, organizationId)} />;
}
