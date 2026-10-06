"use client";

// La lista de pacientes: tabla en escritorio, filas en el teléfono, y los
// estados de error y vacío. Solo presentación.

import Link from "next/link";
import { ChevronRight, Plus, RotateCcw } from "lucide-react";
import { Avatar, Button, Chip, Lupita } from "@/components/ui";
import { TAMANOS_LUPITA } from "@/components/ui/lupita";
import { ListaEnCascada } from "@/components/ui/movimiento";
import { fechaRelativa, money } from "@/lib/format";
import {
  DEBE,
  NUEVO_PACIENTE,
  PACIENTES_VACIO_LINEA,
  PACIENTES_VACIO_TITULO,
  REINTENTAR,
} from "@/lib/glosario";
import { formatPhoneDisplay } from "@/lib/phone";
import type { PacienteConDeuda } from "@/types/domain";

import type { TipoDeVacio } from "./pacientes-datos";

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg px-6 py-14 flex flex-col items-center text-center">
      <p className="font-display text-[18px] text-ink-900 font-medium">
        No pudimos cargar los pacientes.
      </p>
      <p className="mt-1 text-[13px] text-ink-500">{message}</p>
      <div className="mt-5">
        <Button variant="secondary" onClick={onRetry}>
          {REINTENTAR}
        </Button>
      </div>
    </div>
  );
}

export function DesktopTable({
  pacientes,
  archived,
  reactivatingId,
  onReactivar,
}: {
  pacientes: PacienteConDeuda[];
  archived: boolean;
  reactivatingId: string | null;
  onReactivar: (paciente: PacienteConDeuda) => void;
}) {
  const cols = archived
    ? "1.8fr 1fr 110px 1fr 140px 24px"
    : "1.8fr 1fr 110px 1fr 120px 24px";

  return (
    <div className="hidden lg:block bg-white border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
      <div
        className="grid items-center bg-cream-50 border-b border-[color:var(--border-subtle)] pl-[22px] pr-5 py-3 gap-4 text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-500"
        style={{ gridTemplateColumns: cols }}
      >
        <span>Nombre</span>
        <span>Teléfono</span>
        <span>Tarifa</span>
        <span>Última sesión</span>
        <span>{archived ? "Estado" : "Deuda"}</span>
        <span aria-hidden="true" />
      </div>
      <ListaEnCascada
        contenedor="ul"
        item="li"
        className="divide-y divide-[color:var(--border-subtle)]"
      >
        {pacientes.map((p) => (
          <Link
            key={p.id}
            href={`/pacientes/${p.id}`}
            className="grid items-center pl-5 pr-5 py-[14px] gap-4 text-left transition-colors duration-[var(--duration-fast)] border-l-[2px] border-l-transparent hover:bg-cream-50 hover:border-l-sage-500"
            style={{ gridTemplateColumns: cols }}
          >
            <span className="flex items-center gap-3 min-w-0">
              <Avatar nombre={p.nombre} apellido={p.apellido} size={36} />
              <span className="text-[14px] font-semibold text-ink-900 truncate">
                {p.nombre} {p.apellido}
              </span>
            </span>
            <span className="text-[13px] text-ink-700 tabular-nums">
              {formatPhoneDisplay(p.telefono)}
            </span>
            <span className="text-[13px] text-ink-700 tabular-nums">
              {money(p.tarifa)}
            </span>
            <span className="text-[13px] text-ink-500">
              {p.ultimaSesion ? fechaRelativa(p.ultimaSesion) : "-"}
            </span>
            {archived ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={reactivatingId === p.id}
                icon={<RotateCcw size={14} strokeWidth={1.6} aria-hidden="true" />}
                onClick={(event) => {
                  event.preventDefault();
                  onReactivar(p);
                }}
              >
                {reactivatingId === p.id ? "Reactivando..." : "Reactivar"}
              </Button>
            ) : (
              <span
                className={
                  p.deudaTotal > 0
                    ? "text-[15px] font-medium tabular-nums text-terracotta-600"
                    : "text-[15px] text-ink-300"
                }
              >
                {p.deudaTotal > 0 ? money(p.deudaTotal) : "-"}
              </span>
            )}
            <ChevronRight
              size={16}
              strokeWidth={1.6}
              className="text-ink-300 justify-self-end"
              aria-hidden="true"
            />
          </Link>
        ))}
      </ListaEnCascada>
    </div>
  );
}

export function MobileList({
  pacientes,
  archived,
  reactivatingId,
  onReactivar,
}: {
  pacientes: PacienteConDeuda[];
  archived: boolean;
  reactivatingId: string | null;
  onReactivar: (paciente: PacienteConDeuda) => void;
}) {
  return (
    <div className="lg:hidden bg-white border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
      <ListaEnCascada
        contenedor="ul"
        item="li"
        className="divide-y divide-[color:var(--border-subtle)]"
      >
        {pacientes.map((p) => (
          <Link
            key={p.id}
            href={`/pacientes/${p.id}`}
            className="grid items-center gap-4 px-5 py-[14px] transition-colors duration-[var(--duration-fast)] active:bg-cream-50"
            style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto" }}
          >
            <Avatar nombre={p.nombre} apellido={p.apellido} size={40} />
            <span className="flex flex-col min-w-0">
              <span className="break-words text-[15px] font-semibold text-ink-900">
                {p.nombre} {p.apellido}
              </span>
              {/* Sin `truncate`: la segunda línea decía "Hace 3 mes…" por
                  recortar una frase que entra en dos renglones. */}
              <span className="tabular-nums text-[12px] leading-[1.4] text-ink-500">
                {money(p.tarifa)} ·{" "}
                {p.ultimaSesion ? fechaRelativa(p.ultimaSesion) : "-"}
              </span>
              {!archived && p.deudaTotal > 0 ? (
                <Chip variant="terracotta" size="sm" className="mt-1 self-start">
                  {DEBE} {money(p.deudaTotal)}
                </Chip>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {archived ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={reactivatingId === p.id}
                  onClick={(event) => {
                    event.preventDefault();
                    onReactivar(p);
                  }}
                >
                  Reactivar
                </Button>
              ) : null}
              <ChevronRight
                size={16}
                strokeWidth={1.6}
                className="text-ink-300"
                aria-hidden="true"
              />
            </span>
          </Link>
        ))}
      </ListaEnCascada>
    </div>
  );
}

export function EmptyState({
  kind,
  onCrear,
}: {
  kind: TipoDeVacio;
  onCrear: () => void;
}) {
  return (
    <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg px-6 py-14 flex flex-col items-center text-center">
      {kind === "search" && (
        <>
          <p className="font-display text-[18px] text-ink-900 font-medium">
            Sin resultados.
          </p>
          <p className="mt-1 text-[13px] text-ink-500">Probá otro nombre.</p>
        </>
      )}
      {kind === "noPatients" && (
        <>
          {/* El único estado vacío de esta pantalla donde entra Lupita: la
              lista sin nadie es una pantalla que enseña el próximo paso, no
              una pantalla clínica (docs/diseno/04-personaje.md). Va a 96 px
              dentro del círculo crema, como manda el documento. */}
          <span className="inline-flex h-[132px] w-[132px] items-center justify-center rounded-full bg-cream-100">
            <Lupita pose="saluda" tamano={TAMANOS_LUPITA.vacio} />
          </span>
          <p className="mt-4 font-display italic text-[22px] text-ink-900 font-medium">
            {PACIENTES_VACIO_TITULO}
          </p>
          <p className="mt-2 max-w-[420px] text-[13px] leading-[1.5] text-ink-500">
            {PACIENTES_VACIO_LINEA}
          </p>
          <div className="mt-5">
            <Button
              onClick={onCrear}
              icon={<Plus size={16} strokeWidth={1.6} aria-hidden="true" />}
            >
              {NUEVO_PACIENTE}
            </Button>
          </div>
        </>
      )}
      {kind === "noArchived" && (
        <>
          <p className="font-display text-[18px] text-ink-900 font-medium">
            No tenés pacientes archivados.
          </p>
          <p className="mt-1 text-[13px] text-ink-500">
            Los pacientes que dejan de asistir se archivan, no se borran.
          </p>
        </>
      )}
    </div>
  );
}
