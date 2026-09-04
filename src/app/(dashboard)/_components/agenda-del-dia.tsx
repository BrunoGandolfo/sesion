"use client";

// La lista de turnos del día. Cada fila ofrece lo que corresponde al momento
// del turno (SessionRow decide cuál); acá solo se enlaza a dónde va cada
// acción y se agenda uno nuevo.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button, Card, SessionRow } from "@/components/ui";
import { AGENDA_DEL_DIA } from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

import { Titulo } from "./titulo";

export function AgendaDelDia({
  turnos,
  ahora,
  notaPorTurno,
  sinAutorizacion,
  onCobrar,
  onAgendar,
}: {
  turnos: TurnoConPaciente[];
  ahora: Date;
  /** turnoId → sesionId de la nota que espera revisión. */
  notaPorTurno: Map<string, string>;
  /** turnoIds cuya paciente no firmó la autorización. */
  sinAutorizacion: Set<string>;
  onCobrar: (turnoId: string) => void;
  onAgendar: () => void;
}) {
  const router = useRouter();

  return (
    <section className="min-w-0">
      <Titulo
        accion={
          <div className="flex items-center gap-4">
            <Button
              size="sm"
              onClick={onAgendar}
              icon={<Plus size={14} strokeWidth={1.8} aria-hidden="true" />}
            >
              Turno
            </Button>
            <Link
              href="/agenda"
              className="hidden text-[13px] font-semibold text-sage-600 hover:text-sage-700 lg:inline"
            >
              Ver semana →
            </Link>
          </div>
        }
      >
        {AGENDA_DEL_DIA}
      </Titulo>

      {turnos.length > 0 ? (
        <div className="space-y-2">
          {turnos.map((turno) => (
            <SessionRow
              key={turno.id}
              turno={turno}
              ahora={ahora}
              notaParaRevisar={notaPorTurno.has(turno.id)}
              sinAutorizacion={sinAutorizacion.has(turno.id)}
              onCobrar={() => onCobrar(turno.id)}
              onRevisarNota={() =>
                router.push(`/sesiones/${notaPorTurno.get(turno.id)}`)
              }
              onGrabar={() => router.push(`/grabar/${turno.id}`)}
              onAutorizar={() => router.push(`/pacientes/${turno.paciente.id}`)}
            />
          ))}
        </div>
      ) : (
        <Card className="rounded-[8px] p-6 text-center">
          <p className="font-[family-name:var(--font-display)] text-[20px] font-medium italic text-ink-900">
            Hoy tu agenda está libre.
          </p>
          <p className="mt-2 text-[14px] text-ink-500">
            Buen día para ordenar pendientes, o para descansar un rato.
          </p>
        </Card>
      )}
    </section>
  );
}
