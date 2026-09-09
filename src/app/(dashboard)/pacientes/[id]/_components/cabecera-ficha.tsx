"use client";

// Cabecera de la ficha: quién es, qué debe, cuándo viene, y las dos acciones
// de la pantalla —grabar y editar los datos—. Debajo, solo si falta, el aviso
// de autorización de grabación con la firma ahí mismo (ConsentimientoBadge en
// su variante "aviso").
//
// POR QUÉ "GRABAR" ESTÁ ACÁ Y NO EN UN FLOTANTE
//
// Era un botón `fixed bottom-24 right-5`, opaco, que en las tres pestañas
// tapaba texto clínico: el resumen de la última sesión, el título "El
// recorrido hasta hoy" y —lo peor— el rótulo de la autorización y parte del
// botón "Revocar" (docs/diseno/01-auditoria-frontend.md, sección 4). Un
// flotante que tapa una acción irreversible no se arregla corriéndolo cinco
// píxeles.
//
// De los dos caminos posibles —una barra de acciones fija al pie, o traer el
// botón al flujo del documento— se eligió el segundo, porque el primero
// agrega un tercer elemento flotante (menú inferior + barra + toast) sobre
// una pantalla que ya tiene dos, y esta app resuelve sacando antes que
// agregando. Acá el botón no puede tapar nada: ocupa su lugar, empuja lo que
// sigue y se scrollea con la ficha.

import { ChevronLeft, Edit3, Mic } from "lucide-react";
import Link from "next/link";

import { AccesoConsultorio } from "@/components/layout/cabecera-usuario";
import { Avatar, Button, Chip } from "@/components/ui";
import { ConsentimientoBadge } from "@/components/grabacion/ConsentimientoBadge";
import { fechaCorta, hora, money } from "@/lib/format";
import { EDITAR_DATOS, GRABAR } from "@/lib/glosario";
import type { Configuracion, PacienteConDeuda, Turno } from "@/types/domain";

interface CabeceraFichaProps {
  paciente: PacienteConDeuda;
  proximoTurno: Turno | null;
  /** null mientras se verifica. */
  consentimientoVigente: boolean | null;
  config: Configuracion | null;
  /** Cambia cuando la ficha se recarga: remonta el aviso para que relea. */
  reloadKey: number;
  /** A dónde lleva Grabar: el turno de hoy, o una sesión nueva. */
  hrefGrabar: string;
  onEditar: () => void;
  onConsentimientoCambio: () => void;
}

export function CabeceraFicha({
  paciente,
  proximoTurno,
  consentimientoVigente,
  config,
  reloadKey,
  hrefGrabar,
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
        <div className="flex items-center gap-2 lg:shrink-0">
          <Button
            asChild
            size="sm"
            icon={<Mic size={16} strokeWidth={1.8} aria-hidden="true" />}
          >
            <Link href={hrefGrabar}>{GRABAR}</Link>
          </Button>
          {/* "Editar datos" y no "Editar": el Recorrido tiene su propio
              Editar, para el hilo, y los dos decían lo mismo. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onEditar}
            icon={<Edit3 size={14} strokeWidth={1.6} aria-hidden="true" />}
          >
            {EDITAR_DATOS}
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

export function CabeceraNavegacionFicha() {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <Link
        href="/pacientes"
        className="inline-flex items-center gap-1 text-[13px] text-ink-500 transition-colors duration-150 hover:text-ink-700"
      >
        <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
        <span>Pacientes</span>
      </Link>
      <AccesoConsultorio />
    </div>
  );
}

