"use client";

// Lo que espera a la terapeuta cuando abre la app, arriba de todo.
//
// Tres listas, cada una con una acción y un final: revisar la nota, cobrar
// la sesión, hacer firmar la autorización. Los datos vienen tal cual de
// /api/dashboard → casos-uso/pendientes-terapeuta.ts: acá no se recalcula
// ninguna regla clínica ni de cobro, solo se cuenta y se enlaza.
//
// Cada fila se renderiza únicamente si tiene ítems, y si las tres están
// vacías el bloque entero desaparece: un cartel de "no tenés nada
// pendiente" ocuparía el lugar más caro de la pantalla para no decir nada.

import * as React from "react";
import Link from "next/link";
import { FileText, ShieldAlert, Wallet } from "lucide-react";

import { Card } from "@/components/ui";
import { fechaCorta, money } from "@/lib/format";
import { pluralizar } from "@/lib/glosario";
import type { PendientesTerapeuta } from "@/app/api/_lib/domain";

/** Cuántos ítems se listan por fila antes de resumir el resto. La fila es
 *  un recordatorio, no la pantalla de trabajo. */
const MAX_VISIBLES = 3;

interface PendientesProps {
  pendientes: PendientesTerapeuta;
  /** Abre el sheet de cobrar de la pantalla de Hoy — el mismo de la agenda. */
  onCobrar: (turnoId: string) => void;
}

function fecha(iso: string): string {
  return fechaCorta(new Date(iso));
}

function Fila({
  icono,
  titulo,
  restantes,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  restantes: number;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="flex items-center gap-2 font-sans text-[14px] font-semibold text-ink-900">
        {icono}
        {titulo}
      </p>
      <ul className="mt-1.5 flex flex-col">{children}</ul>
      {restantes > 0 ? (
        <p className="mt-1 pl-[26px] font-sans text-[12px] text-ink-500">
          y {restantes} más
        </p>
      ) : null}
    </div>
  );
}

const ITEM =
  "flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-cream-50";

export function Pendientes({ pendientes, onCobrar }: PendientesProps) {
  const { notasParaRevisar, sinCobrar, sinAutorizacion } = pendientes;

  // Un mismo turno se cuenta una vez, pero la autorización es de la paciente:
  // dos turnos de la misma persona en el día son un solo pendiente.
  const pacientesSinAutorizacion = React.useMemo(() => {
    const vistos = new Set<string>();
    return sinAutorizacion.filter((turno) => {
      if (vistos.has(turno.pacienteId)) return false;
      vistos.add(turno.pacienteId);
      return true;
    });
  }, [sinAutorizacion]);

  if (
    notasParaRevisar.length === 0 &&
    sinCobrar.length === 0 &&
    pacientesSinAutorizacion.length === 0
  ) {
    return null;
  }

  const total = sinCobrar.reduce((suma, sesion) => suma + sesion.tarifa, 0);

  return (
    <Card className="overflow-hidden rounded-[8px] border-l-2 border-l-gold-500 p-0">
      <div className="divide-y divide-[color:var(--border-subtle)]">
        {notasParaRevisar.length > 0 ? (
          <Fila
            icono={
              <FileText
                size={16}
                strokeWidth={1.8}
                aria-hidden="true"
                className="text-gold-500"
              />
            }
            titulo={pluralizar(
              notasParaRevisar.length,
              "nota para revisar",
              "notas para revisar",
            )}
            restantes={notasParaRevisar.length - MAX_VISIBLES}
          >
            {notasParaRevisar.slice(0, MAX_VISIBLES).map((nota) => (
              <li key={nota.sesionId}>
                <Link href={`/sesiones/${nota.sesionId}`} className={ITEM}>
                  <span className="min-w-0 truncate font-sans text-[13px] text-ink-900">
                    {nota.pacienteNombre}
                  </span>
                  <span className="shrink-0 font-sans text-[12px] tabular-nums text-ink-500">
                    {fecha(nota.fecha)}
                  </span>
                </Link>
              </li>
            ))}
          </Fila>
        ) : null}

        {sinCobrar.length > 0 ? (
          <Fila
            icono={
              <Wallet
                size={16}
                strokeWidth={1.8}
                aria-hidden="true"
                className="text-terracotta-500"
              />
            }
            titulo={`${pluralizar(
              sinCobrar.length,
              "sesión sin cobrar",
              "sesiones sin cobrar",
            )} · ${money(total)}`}
            restantes={sinCobrar.length - MAX_VISIBLES}
          >
            {sinCobrar.slice(0, MAX_VISIBLES).map((sesion) => (
              <li key={sesion.turnoId}>
                <button
                  type="button"
                  onClick={() => onCobrar(sesion.turnoId)}
                  className={ITEM}
                >
                  <span className="min-w-0 truncate font-sans text-[13px] text-ink-900">
                    {sesion.pacienteNombre}
                  </span>
                  <span className="shrink-0 font-sans text-[12px] tabular-nums text-ink-500">
                    {fecha(sesion.fecha)} · {money(sesion.tarifa)}
                  </span>
                </button>
              </li>
            ))}
          </Fila>
        ) : null}

        {pacientesSinAutorizacion.length > 0 ? (
          <Fila
            icono={
              <ShieldAlert
                size={16}
                strokeWidth={1.8}
                aria-hidden="true"
                className="text-terracotta-500"
              />
            }
            titulo={`${pluralizar(
              pacientesSinAutorizacion.length,
              "paciente sin autorización",
              "pacientes sin autorización",
            )} hoy`}
            restantes={pacientesSinAutorizacion.length - MAX_VISIBLES}
          >
            {pacientesSinAutorizacion.slice(0, MAX_VISIBLES).map((turno) => (
              <li key={turno.turnoId}>
                <Link href={`/pacientes/${turno.pacienteId}`} className={ITEM}>
                  <span className="min-w-0 truncate font-sans text-[13px] text-ink-900">
                    {turno.pacienteNombre}
                  </span>
                  <span className="shrink-0 font-sans text-[12px] tabular-nums text-ink-500">
                    {fecha(turno.fecha)}
                  </span>
                </Link>
              </li>
            ))}
          </Fila>
        ) : null}
      </div>
    </Card>
  );
}
