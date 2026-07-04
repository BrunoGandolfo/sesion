"use client";

import * as React from "react";
import { isToday } from "date-fns";
import { ArrowRight, CalendarCheck, Edit3 } from "lucide-react";

import {
  Avatar,
  Button,
  Chip,
  EditorialRule,
  KpiCard,
} from "@/components/ui";
import { fechaCorta, fechaRelativa, hora, money } from "@/lib/format";
import type { Paciente, Turno } from "@/types/domain";

import { BriefPreSesion } from "./brief-pre-sesion";
import { RiesgoBanner } from "./riesgo-banner";

type TabKey = "historia" | "progreso" | "turnos" | "datos";

type Props = {
  paciente: Paciente;
  turnos: Turno[];
  config: { tarifaDefault: number };
  onEditar: () => void;
  onCambiarTab: (tab: TabKey) => void;
};

type SesionProgresoApi = {
  fecha: string;
  numero: number;
  temas?: string[] | null;
};

type ProgresoApiResponse = {
  sesiones: SesionProgresoApi[];
};

function useTemasRecurrentes(pacienteId: string) {
  const [temas, setTemas] = React.useState<
    { tema: string; count: number }[]
  >([]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pacientes/${pacienteId}/progreso`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => (r.ok ? (r.json() as Promise<ProgresoApiResponse>) : null))
      .then((json) => {
        if (!json) return;
        const conteo = new Map<string, number>();
        for (const sesion of json.sesiones) {
          for (const raw of sesion.temas ?? []) {
            const tema = raw.trim();
            if (!tema) continue;
            conteo.set(tema, (conteo.get(tema) ?? 0) + 1);
          }
        }
        const top = Array.from(conteo.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tema, count]) => ({ tema, count }));
        setTemas(top);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [pacienteId]);

  return temas;
}

export function ResumenTab({
  paciente,
  turnos,
  onEditar,
  onCambiarTab,
}: Props) {
  const ahora = React.useMemo(() => new Date(), []);

  const totalSesiones = React.useMemo(
    () => turnos.filter((t) => t.estado === "realizado").length,
    [turnos],
  );

  const deudaTotal = React.useMemo(
    () =>
      turnos
        .filter(
          (t) => t.estado === "realizado" && t.pagoEstado === "pendiente",
        )
        .reduce((acc, t) => acc + t.tarifaCobrada, 0),
    [turnos],
  );

  const ultimaSesion = React.useMemo(() => {
    const realizadas = turnos
      .filter((t) => t.estado === "realizado")
      .sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
    return realizadas[0] ?? null;
  }, [turnos]);

  const proximoTurno = React.useMemo(() => {
    const futuros = turnos
      .filter(
        (t) =>
          t.estado === "programado" && t.fecha.getTime() >= ahora.getTime(),
      )
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    return futuros[0] ?? null;
  }, [turnos, ahora]);

  const turnoHoy =
    proximoTurno && isToday(proximoTurno.fecha) ? proximoTurno : null;

  const temas = useTemasRecurrentes(paciente.id);

  const altaLabel = new Date(paciente.creadoEn)
    .toLocaleDateString("es-UY", {
      month: "short",
      year: "numeric",
    })
    .replace(/\.$/, "");

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar
            nombre={paciente.nombre}
            apellido={paciente.apellido}
            size={64}
          />
          <div className="min-w-0">
            <h1 className="font-display font-medium text-ink-900 text-[26px] lg:text-[32px] leading-tight tracking-[-0.02em] truncate">
              {paciente.nombre} {paciente.apellido}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500">
              <Chip variant={paciente.activo ? "sage" : "neutral"} size="sm">
                {paciente.activo ? "Activo" : "Archivado"}
              </Chip>
              <span className="tabular-nums">Desde {altaLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex lg:shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={onEditar}
            icon={<Edit3 size={14} strokeWidth={1.6} aria-hidden="true" />}
          >
            Editar
          </Button>
        </div>
      </section>

      <BriefPreSesion pacienteId={paciente.id} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiCard label="Sesiones" value={totalSesiones} />
        <KpiCard
          label="Deuda"
          value={deudaTotal > 0 ? money(deudaTotal) : "-"}
          accent={deudaTotal > 0 ? "terracotta" : "default"}
        />
        <KpiCard
          label="Última sesión"
          value={ultimaSesion ? fechaRelativa(ultimaSesion.fecha) : "-"}
          subtext={ultimaSesion ? fechaCorta(ultimaSesion.fecha) : undefined}
        />
        <KpiCard
          label="Próximo turno"
          value={proximoTurno ? fechaCorta(proximoTurno.fecha) : "Sin turno"}
          subtext={proximoTurno ? hora(proximoTurno.fecha) : "programado"}
        />
      </section>

      <RiesgoBanner pacienteId={paciente.id} />

      {turnoHoy && (
        <section className="rounded-lg border border-sage-200 bg-sage-50 p-5 lg:p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <CalendarCheck
              size={22}
              strokeWidth={1.8}
              aria-hidden="true"
              className="mt-[2px] shrink-0 text-sage-600"
            />
            <div className="min-w-0">
              <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-sage-700">
                Hoy
              </p>
              <p className="mt-1 font-display italic text-[20px] lg:text-[22px] font-medium text-ink-900 leading-tight">
                Sesión a las {hora(turnoHoy.fecha)}
              </p>
              <p className="mt-1 text-[12px] text-ink-500">
                {turnoHoy.duracion} min ·{" "}
                {turnoHoy.modalidad === "online" ? "Online" : "Presencial"}
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            onClick={() => onCambiarTab("historia")}
            icon={
              <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
            }
            className="sm:shrink-0"
          >
            Ir a sesión
          </Button>
        </section>
      )}

      {temas.length > 0 && (
        <section className="bg-white border border-[color:var(--border-subtle)] rounded-lg p-5 lg:p-6">
          <h2 className="flex items-center mb-4">
            <EditorialRule />
            <span className="font-display italic text-[15px] text-ink-700">
              Temas recurrentes
            </span>
          </h2>
          <ul className="flex flex-wrap gap-2">
            {temas.map(({ tema, count }) => (
              <li key={tema}>
                <Chip variant="neutral">
                  {tema} · {count}
                </Chip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
