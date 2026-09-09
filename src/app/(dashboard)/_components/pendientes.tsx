"use client";

// Lo que espera a la terapeuta cuando abre la app, arriba de todo.
//
// Tres listas, cada una con una acción y un final: revisar la nota, ver
// quién debe, hacer firmar la autorización. Los datos vienen tal cual de
// /api/dashboard → casos-uso/pendientes-terapeuta.ts: acá no se recalcula
// ninguna regla clínica ni de cobro, solo se cuenta y se enlaza.
//
// La fila de cobros va agrupada por paciente y no por turno: quien debe seis
// sesiones es un pendiente, no seis. El cobro en sí se hace en Cobros o en
// la ficha, donde está la sesión concreta que se está pagando.
//
// Y va SIN nombres: es la cuenta y el camino, nada más. Los nombres los
// lista "Te deben", una sola vez y en un solo orden. Antes esta fila
// mostraba sus tres nombres y el bloque de abajo otros tres —dos listas del
// mismo dato, ordenadas distinto, a 400 px una de otra—.
//
// Los pasos iniciales requieren datos explícitos de la cuenta: no tener
// pendientes hoy no significa que todavía falten pacientes o turnos.
// Cuando todas las tareas se cumplieron, el bloque desaparece.

import * as React from "react";
import Link from "next/link";
import { FileText, ShieldAlert, Wallet } from "lucide-react";

import { Card } from "@/components/ui";
import { fechaCorta, money } from "@/lib/format";
import { INICIO_AGENDAR_SESION, INICIO_CARGAR_PACIENTE, INICIO_CARGAR_TARIFA, NAV, pluralizar } from "@/lib/glosario";
import type { DashboardData, PendientesTerapeuta } from "@/types/domain";

/** Cuántos ítems se listan por fila antes de resumir el resto. La fila es
 *  un recordatorio, no la pantalla de trabajo. */
const MAX_VISIBLES = 3;

interface PendientesProps {
  pendientes: PendientesTerapeuta;
  inicio?: DashboardData["inicio"];
}

function fecha(iso: string): string {
  return fechaCorta(new Date(iso));
}

function Fila({
  icono,
  titulo,
  restantes = 0,
  pie,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  /** Cuántos quedaron sin listar. Se resume con "y N más". */
  restantes?: number;
  /** Alternativa al resumen: un enlace a la pantalla donde está el resto. */
  pie?: React.ReactNode;
  /** La fila de la deuda no lista nombres: son la cuenta y el camino. */
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="flex items-center gap-2 font-sans text-[14px] font-semibold text-ink-900">
        {icono}
        {titulo}
      </p>
      {children ? (
        <ul className="mt-1.5 flex flex-col">{children}</ul>
      ) : null}
      {pie ? <div className="mt-1 pl-[26px]">{pie}</div> : null}
      {!pie && restantes > 0 ? (
        <p className="mt-1 pl-[26px] font-sans text-[12px] text-ink-500">
          y {restantes} más
        </p>
      ) : null}
    </div>
  );
}

const ITEM =
  "flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-cream-50";

export function Pendientes({ pendientes, inicio }: PendientesProps) {
  const { notasParaRevisar, sinCobrar, sinAutorizacion, totalSinCobrar } =
    pendientes;

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

  const pasosIniciales = inicio ? [
    { completo: inicio.tarifaCargada, texto: INICIO_CARGAR_TARIFA, href: "/config" },
    { completo: inicio.tienePacientes, texto: INICIO_CARGAR_PACIENTE, href: "/pacientes" },
    { completo: inicio.tieneTurnos, texto: INICIO_AGENDAR_SESION, href: "/agenda" },
  ].filter((paso) => !paso.completo) : [];

  if (
    notasParaRevisar.length === 0 &&
    sinCobrar.length === 0 &&
    pacientesSinAutorizacion.length === 0 &&
    pasosIniciales.length === 0
  ) {
    return null;
  }

  return (
    <Card className="overflow-hidden rounded-[8px] border-l-2 border-l-gold-500 p-0">
      <div className="divide-y divide-[color:var(--border-subtle)]">
        {pasosIniciales.length > 0 ? (
          <ol className="px-4 py-2">
            {pasosIniciales.map((paso) => (
              <li key={paso.href}>
                <Link href={paso.href} className={`${ITEM} min-h-11 font-sans text-[14px] font-semibold text-sage-700`}>
                  {paso.texto}
                </Link>
              </li>
            ))}
          </ol>
        ) : null}
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
              totalSinCobrar.pacientes,
              "paciente te debe",
              "pacientes te deben",
            )} · ${money(totalSinCobrar.monto)}`}
            pie={
              <Link
                href="/cobros"
                className="font-sans text-[12px] font-semibold text-sage-600 hover:text-sage-700"
              >
                Ver todos → {NAV.COBROS}
              </Link>
            }
          />
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
