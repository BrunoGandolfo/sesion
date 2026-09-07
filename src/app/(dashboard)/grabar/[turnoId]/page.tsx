// Pantalla de grabación. Una sola cosa por vez: antes de grabar, la única
// verificación es la autorización de la paciente; después, el cronómetro.
//
// La ruta acepta dos formas:
//   /grabar/<turnoId>                        turno ya agendado
//   /grabar/nuevo?pacienteId=<id>            sesión sin turno agendado
//
// Los datos del encabezado (nombre y hora) y el estado del consentimiento se
// resuelven en el servidor: la pantalla no arranca con un esqueleto ni pide
// tres endpoints antes de mostrar el botón.

import { notFound } from "next/navigation";

import { getServerSession } from "@/lib/auth-utils";
import { consentimientoVigenteDe } from "@/lib/consentimiento";
import { db } from "@/lib/db";
import { hora } from "@/lib/format";

import { GrabarView } from "./_components/grabar-view";

export const dynamic = "force-dynamic";

/** La misma pregunta que hace POST /api/sesion-clinica antes de crear la
 *  sesión. Una sola función: si las dos no contestan lo mismo, la pantalla
 *  ofrece grabar y la API lo rechaza (o al revés). */
function tieneAutorizacion(pacienteId: string, organizationId: string) {
  return consentimientoVigenteDe(db, pacienteId, organizationId);
}

export default async function GrabarPage({
  params,
  searchParams,
}: {
  params: Promise<{ turnoId: string }>;
  searchParams: Promise<{ pacienteId?: string }>;
}) {
  const [{ turnoId }, { pacienteId }, sesion] = await Promise.all([
    params,
    searchParams,
    getServerSession(),
  ]);

  if (!sesion) {
    notFound();
  }

  const { organizationId } = sesion;

  // Sin turno agendado: el turno se crea recién cuando toca "Grabar sesión",
  // para no dejar turnos fantasma si abre la pantalla y se arrepiente.
  if (turnoId === "nuevo") {
    if (!pacienteId) {
      notFound();
    }

    const paciente = await db.paciente.findFirst({
      where: { id: pacienteId, organizationId },
      select: { id: true, nombre: true, apellido: true },
    });

    if (!paciente) {
      notFound();
    }

    return (
      <GrabarView
        turnoId={null}
        turnoProgramado
        horaTexto={null}
        pacienteId={paciente.id}
        pacienteNombre={`${paciente.nombre} ${paciente.apellido}`.trim()}
        autorizacionVigente={await tieneAutorizacion(
          paciente.id,
          organizationId,
        )}
      />
    );
  }

  const turno = await db.turno.findFirst({
    where: { id: turnoId, organizationId },
    select: {
      id: true,
      fecha: true,
      estado: true,
      paciente: { select: { id: true, nombre: true, apellido: true } },
    },
  });

  if (!turno) {
    notFound();
  }

  return (
    <GrabarView
      turnoId={turno.id}
      turnoProgramado={turno.estado === "programado"}
      horaTexto={hora(turno.fecha)}
      pacienteId={turno.paciente.id}
      pacienteNombre={`${turno.paciente.nombre} ${turno.paciente.apellido}`.trim()}
      autorizacionVigente={await tieneAutorizacion(
        turno.paciente.id,
        organizationId,
      )}
    />
  );
}
