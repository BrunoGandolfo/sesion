"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

import { Card } from "@/components/ui";
import { ContextoGoldenThreadView } from "@/components/clinico/ContextoGoldenThreadView";

import { ProgresoClinico } from "./progreso-clinico";

interface ProgresoTabProps {
  pacienteId: string;
  nombrePaciente: string;
}

// Probe ligero al endpoint del contexto para decidir si mostramos el empty
// state unificado ("paciente nuevo, sin datos en ningún lado") en lugar de
// renderizar dos cards vacías. El endpoint ya devuelve totalSesionesAprobadas
// y creadoEn, así que con una sola llamada sabemos si hay algo que mostrar.
type ProbeState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready" }
  | { kind: "error" };

export function ProgresoTab({ pacienteId, nombrePaciente }: ProgresoTabProps) {
  const [probe, setProbe] = React.useState<ProbeState>({ kind: "loading" });

  React.useEffect(() => {
    let cancelado = false;
    setProbe({ kind: "loading" });

    fetch(`/api/pacientes/${pacienteId}/contexto-clinico`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("probe failed");
        }
        const json = (await res.json()) as {
          creadoEn: string | null;
          totalSesionesAprobadas: number;
        };
        if (cancelado) return;
        if (json.creadoEn === null && json.totalSesionesAprobadas === 0) {
          setProbe({ kind: "empty" });
        } else {
          setProbe({ kind: "ready" });
        }
      })
      .catch(() => {
        if (cancelado) return;
        // Si el probe falla, dejamos que los hijos hagan su propio fetch y
        // muestren su error individual — es info más accionable que la del
        // wrapper.
        setProbe({ kind: "error" });
      });

    return () => {
      cancelado = true;
    };
  }, [pacienteId]);

  if (probe.kind === "loading") {
    return <ProbeSkeleton />;
  }

  if (probe.kind === "empty") {
    return <EmptyUnificado nombrePaciente={nombrePaciente} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="contexto-clinico-heading">
        <h2
          id="contexto-clinico-heading"
          className="sr-only"
        >
          Contexto clínico de {nombrePaciente}
        </h2>
        <ContextoGoldenThreadView pacienteId={pacienteId} />
      </section>

      <section aria-labelledby="evolucion-clinica-heading">
        <Card>
          <div className="flex flex-col gap-4">
            <header className="flex flex-col gap-1">
              <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Evolución por sesión
              </p>
              <h3
                id="evolucion-clinica-heading"
                className="font-display text-[20px] italic font-medium text-ink-900"
              >
                Evolución clínica
              </h3>
            </header>
            <ProgresoClinico pacienteId={pacienteId} />
          </div>
        </Card>
      </section>
    </div>
  );
}

function ProbeSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Cargando progreso clínico…</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-6 md:p-7"
        >
          <div className="flex flex-col gap-3">
            <div className="h-4 w-40 rounded bg-cream-100 animate-pulse" />
            <div className="h-3 w-full rounded bg-cream-100 animate-pulse" />
            <div className="h-3 w-5/6 rounded bg-cream-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyUnificado({ nombrePaciente }: { nombrePaciente: string }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Sparkles
          size={28}
          strokeWidth={1.6}
          aria-hidden="true"
          className="text-sage-500"
        />
        <h2 className="font-display text-[20px] italic font-medium text-ink-900">
          Todavía no hay datos de progreso para {nombrePaciente}.
        </h2>
        <p className="max-w-[440px] font-sans text-[14px] leading-[1.6] text-ink-500">
          Se generarán automáticamente después de la primera sesión grabada y
          aprobada.
        </p>
      </div>
    </Card>
  );
}
