"use client";

// Cabecera de la ficha: quién es, qué debe, cuándo viene, un solo Editar.
// Debajo, solo si falta, el aviso de autorización de grabación con la firma
// ahí mismo (ConsentimientoBadge en su variante "aviso").

import { Edit3 } from "lucide-react";

import { Avatar, Button, Chip } from "@/components/ui";
import { ConsentimientoBadge } from "@/components/grabacion/ConsentimientoBadge";
import { fechaCorta, hora, money } from "@/lib/format";
import type { Configuracion, PacienteConDeuda, Turno } from "@/types/domain";

interface CabeceraFichaProps {
  paciente: PacienteConDeuda;
  proximoTurno: Turno | null;
  /** null mientras se verifica. */
  consentimientoVigente: boolean | null;
  config: Configuracion | null;
  /** Cambia cuando la ficha se recarga: remonta el aviso para que relea. */
  reloadKey: number;
  onEditar: () => void;
  onConsentimientoCambio: () => void;
}

export function CabeceraFicha({
  paciente,
  proximoTurno,
  consentimientoVigente,
  config,
  reloadKey,
  onEditar,
  onConsentimientoCambio,
}: CabeceraFichaProps) {
  const nombreCompleto = `${paciente.nombre} ${paciente.apellido}`;

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar nombre={paciente.nombre} apellido={paciente.apellido} size={64} />
          <div className="min-w-0">
            <h1 className="truncate font-display text-[26px] font-medium leading-tight tracking-[-0.02em] text-ink-900 lg:text-[32px]">
              {nombreCompleto}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-500">
              {!paciente.activo ? (
                <Chip variant="neutral" size="sm">
                  Archivado
                </Chip>
              ) : null}
              {paciente.deudaTotal > 0 ? (
                <span className="font-display font-medium tabular-nums text-terracotta-500">
                  Debe {money(paciente.deudaTotal)}
                </span>
              ) : null}
              {proximoTurno ? (
                <span className="tabular-nums">
                  Próxima: {fechaCorta(proximoTurno.fecha)} · {hora(proximoTurno.fecha)}
                </span>
              ) : (
                <span>Sin próximo turno</span>
              )}
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
      </div>

      {consentimientoVigente === false ? (
        <ConsentimientoBadge
          key={reloadKey}
          variante="aviso"
          pacienteId={paciente.id}
          nombrePaciente={nombreCompleto}
          nombreProfesional={config?.nombreProfesional ?? ""}
          direccionConsultorio={config?.direccion ?? ""}
          onCambio={onConsentimientoCambio}
        />
      ) : null}
    </header>
  );
}
