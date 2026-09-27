"use client";

// La lista de turnos del día. Cada fila ofrece lo que corresponde al momento
// del turno (SessionRow decide cuál); acá solo se enlaza a dónde va cada
// acción y se agenda uno nuevo.
//
// SIN CASCADA PROPIA (delta D4). Los turnos entran con el bloque, de una
// sola vez. Antes había una cascada acá adentro de la cascada de
// dashboard.tsx: el bloque llegaba a los 120 ms y recién ahí empezaban a
// entrar los turnos de a uno, así que el octavo aterrizaba casi 0,6 s
// después de abrir la pantalla que ella abre ocho a doce veces por día. La
// cascada de afuera se conserva; ésta no significaba nada que la de afuera
// no dijera ya.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button, Card, SessionRow } from "@/components/ui";
import { Lupita, TAMANOS_LUPITA } from "@/components/ui/lupita";
import {
  AGENDA_DEL_DIA,
  AGENDAR,
  HOY_SIN_TURNOS_DETALLE,
  HOY_SIN_TURNOS_TITULO,
} from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

import { Titulo } from "./titulo";

export function AgendaDelDia({
  turnos,
  ahora,
  notaPorTurno,
  sinAutorizacion,
  onCobrar,
  onAgendar,
  turnoCobrado = null,
  riesgoEnElDia = false,
}: {
  turnos: TurnoConPaciente[];
  ahora: Date;
  /** turnoId → sesionId de la nota que espera revisión. */
  notaPorTurno: Map<string, string>;
  /** turnoIds cuya paciente no firmó la autorización. */
  sinAutorizacion: Set<string>;
  onCobrar: (turnoId: string) => void;
  onAgendar: () => void;
  /** El turno cuyo cobro acaba de entrar y todavía se está confirmando en su
   *  propia fila (delta D9). Lo sostiene la pantalla mientras dura el trazo:
   *  el sheet se cierra y la marca queda donde ella tocó, en vez de que la
   *  fila cambie de chip sin que nada diga por qué. */
  turnoCobrado?: string | null;
  /** Alguna sesión del día tiene señal de riesgo. Con esto en true el estado
   *  vacío se dibuja sin Lupita: docs/diseno/04-personaje.md, "la regla de
   *  tono". El texto no cambia — el que habla siempre es el texto. */
  riesgoEnElDia?: boolean;
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
              {AGENDAR}
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
              cobroConfirmado={turno.id === turnoCobrado}
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
        <Card className="flex flex-col items-center rounded-[8px] p-4 text-center">
          {riesgoEnElDia ? null : (
            <span className="mb-2 inline-flex h-20 w-20 items-center justify-center rounded-full bg-cream-100">
              <Lupita pose="saluda" tamano={TAMANOS_LUPITA.encabezado} />
            </span>
          )}
          <p className="font-[family-name:var(--font-display)] text-[20px] font-medium italic text-ink-900">
            {HOY_SIN_TURNOS_TITULO}
          </p>
          <p className="mt-2 text-[14px] text-ink-500">
            {HOY_SIN_TURNOS_DETALLE}
          </p>
        </Card>
      )}
    </section>
  );
}
