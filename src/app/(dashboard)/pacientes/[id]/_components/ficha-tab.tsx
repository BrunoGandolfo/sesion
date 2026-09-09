"use client";

// Pestaña Ficha: contacto, tarifa, notas privadas, autorización de
// grabación, turnos y pagos (plegado) y archivar. Sin Editar: el único
// Editar de la ficha está en la cabecera.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Calendar as CalendarIcon,
  ChevronDown,
  Mail,
  Phone,
  RotateCcw,
  Wallet,
} from "lucide-react";

import { Button, Confirmar, EditorialRule, Textarea, Toast } from "@/components/ui";
import { ConsentimientoBadge } from "@/components/grabacion/ConsentimientoBadge";
import { HotWordsManager } from "@/components/grabacion/HotWordsManager";
import { esDeudaPendiente } from "@/app/api/_lib/domain";
import { apiPatch } from "@/lib/api-client";
import { fechaCompleta, money } from "@/lib/format";
import {
  ALGO_FALLO,
  AUTORIZACION_GRABACION,
  VOCABULARIO_PACIENTE,
  VOCABULARIO_PACIENTE_AYUDA,
} from "@/lib/glosario";
import type { Configuracion, PacienteConDeuda, Turno } from "@/types/domain";

import { TurnosPagosTab } from "./turnos-pagos-tab";

interface FichaTabProps {
  paciente: PacienteConDeuda;
  turnos: Turno[];
  config: Configuracion | null;
  /** Cambia cuando la ficha se recarga: remonta la autorización para que relea. */
  reloadKey: number;
  onPacienteActualizado: () => void;
}

type ToastState = { open: boolean; message: string };

// La fecha de alta sale de format.ts como todas las demás. Con el
// Intl.DateTimeFormat("es-UY") que tenía acá decía "05 de setiembre de 2026"
// mientras la agenda decía "7 de septiembre" y Cobros "Septiembre 2026": dos
// ortografías del mismo mes en la misma sesión de uso. Y de paso se saltaba
// la regla de zona horaria de Montevideo que respeta el resto del proyecto
// (docs/diseno/01-auditoria-frontend.md, sección 4).

export function FichaTab({
  paciente,
  turnos,
  config,
  reloadKey,
  onPacienteActualizado,
}: FichaTabProps) {
  const router = useRouter();
  const [confirmandoArchivo, setConfirmandoArchivo] = React.useState(false);
  const [archivando, setArchivando] = React.useState(false);
  const [turnosAbiertos, setTurnosAbiertos] = React.useState(false);
  const [vocabularioAbierto, setVocabularioAbierto] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState>({ open: false, message: "" });

  async function cambiarActivo(proximoActivo: boolean) {
    setArchivando(true);
    try {
      await apiPatch(`/api/pacientes/${paciente.id}`, { activo: proximoActivo });
      setConfirmandoArchivo(false);
      if (proximoActivo) {
        setToast({ open: true, message: "Paciente reactivado" });
        onPacienteActualizado();
      } else {
        router.push("/pacientes?archivado=1");
      }
    } catch (err) {
      setToast({ open: true, message: err instanceof Error ? err.message : ALGO_FALLO });
    } finally {
      setArchivando(false);
    }
  }

  const impagas = turnos.filter(esDeudaPendiente).length;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionTitle title="Datos de contacto" />
        <div className="flex flex-col gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-white p-5">
          <DatoLinea
            icon={<Phone size={14} strokeWidth={1.6} aria-hidden="true" />}
            label="Teléfono"
          >
            <a
              href={`tel:${paciente.telefono.replace(/\s/g, "")}`}
              className="text-ink-900 underline decoration-sage-200 underline-offset-2 hover:text-sage-600"
            >
              {paciente.telefono}
            </a>
          </DatoLinea>
          <DatoLinea
            icon={<Mail size={14} strokeWidth={1.6} aria-hidden="true" />}
            label="Email"
          >
            {paciente.email ? (
              <a
                href={`mailto:${paciente.email}`}
                className="text-ink-900 underline decoration-sage-200 underline-offset-2 hover:text-sage-600"
              >
                {paciente.email}
              </a>
            ) : (
              <span className="text-ink-300">—</span>
            )}
          </DatoLinea>
          <DatoLinea
            icon={<Wallet size={14} strokeWidth={1.6} aria-hidden="true" />}
            label="Tarifa"
          >
            <span className="font-display font-medium tabular-nums text-ink-900">
              {money(paciente.tarifa)}
            </span>
            <span className="text-ink-500"> / sesión</span>
          </DatoLinea>
          <DatoLinea
            icon={<CalendarIcon size={14} strokeWidth={1.6} aria-hidden="true" />}
            label="Alta"
          >
            <span className="text-ink-700">
              {fechaCompleta(new Date(paciente.creadoEn))}
            </span>
          </DatoLinea>
        </div>
      </section>

      <section>
        <SectionTitle title="Notas privadas" />
        <NotasEditor
          pacienteId={paciente.id}
          initial={paciente.notas ?? ""}
          onSaved={onPacienteActualizado}
        />
      </section>

      <section>
        <SectionTitle title={AUTORIZACION_GRABACION} />
        <div className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-5">
          <ConsentimientoBadge
            key={reloadKey}
            variante="completo"
            pacienteId={paciente.id}
            nombrePaciente={`${paciente.nombre} ${paciente.apellido}`}
            nombreProfesional={config?.nombreProfesional ?? ""}
            direccionConsultorio={config?.direccion ?? ""}
            onCambio={onPacienteActualizado}
          />
        </div>
      </section>

      {/* Vocabulario de esta persona: los nombres y las palabras que aparecen
          solo en sus sesiones. Va acá, pegado a la autorización, porque las
          dos cosas son de la grabación. Se monta recién al abrir: si no, cada
          ficha que se abre pide una lista que casi nunca se mira. */}
      <section>
        <button
          type="button"
          aria-expanded={vocabularioAbierto}
          onClick={() => setVocabularioAbierto((v) => !v)}
          className="mb-3 flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            <EditorialRule />
            <span>{VOCABULARIO_PACIENTE}</span>
          </span>
          <ChevronDown
            size={16}
            strokeWidth={1.8}
            aria-hidden="true"
            className={`shrink-0 text-ink-500 transition-transform duration-150 ${vocabularioAbierto ? "rotate-180" : ""}`}
          />
        </button>
        {vocabularioAbierto ? (
          <div className="rounded-lg border border-[color:var(--border-subtle)] bg-white px-5 pb-5">
            <p className="pt-4 font-sans text-[12px] leading-[1.5] text-ink-500">
              {VOCABULARIO_PACIENTE_AYUDA}
            </p>
            <HotWordsManager
              compacto
              scope="paciente"
              pacienteId={paciente.id}
              pacienteNombre={`${paciente.nombre} ${paciente.apellido}`}
            />
          </div>
        ) : null}
      </section>

      <section>
        <button
          type="button"
          aria-expanded={turnosAbiertos}
          onClick={() => setTurnosAbiertos((v) => !v)}
          className="mb-3 flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            <EditorialRule />
            <span>Turnos y pagos</span>
          </span>
          <span className="flex items-center gap-2 font-sans text-[12px] text-ink-500">
            {impagas > 0 ? (
              <span className="text-terracotta-500">
                {impagas} sin cobrar
              </span>
            ) : null}
            <ChevronDown
              size={16}
              strokeWidth={1.8}
              aria-hidden="true"
              className={`transition-transform duration-150 ${turnosAbiertos ? "rotate-180" : ""}`}
            />
          </span>
        </button>
        {turnosAbiertos ? (
          <TurnosPagosTab turnos={turnos} onTurnoActualizado={onPacienteActualizado} />
        ) : null}
      </section>

      <section>
        <SectionTitle title="Archivo" />
        <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p className="font-sans text-[13px] font-medium text-ink-900">
                {paciente.activo ? "Paciente activo" : "Paciente archivado"}
              </p>
              <p className="font-sans text-[12px] text-ink-500">
                {paciente.activo
                  ? "Archivar lo oculta de la lista. No borra nada."
                  : "Reactivar lo vuelve a mostrar en la lista de pacientes activos."}
              </p>
            </div>
            {paciente.activo ? (
              !confirmandoArchivo ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmandoArchivo(true)}
                  icon={<Archive size={14} strokeWidth={1.6} aria-hidden="true" />}
                  className="text-terracotta-500 hover:bg-terracotta-50"
                >
                  Archivar paciente
                </Button>
              ) : null
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={archivando}
                onClick={() => void cambiarActivo(true)}
                icon={<RotateCcw size={14} strokeWidth={1.6} aria-hidden="true" />}
              >
                {archivando ? "Reactivando…" : "Reactivar"}
              </Button>
            )}
          </div>
          {confirmandoArchivo ? (
            <Confirmar
              titulo="¿Archivar este paciente?"
              mensaje="Deja de aparecer en la lista. Las sesiones, las notas y los pagos se conservan; podés reactivarlo cuando quieras."
              accion="Archivar"
              variante="peligro"
              enviando={archivando}
              enviandoLabel="Archivando…"
              onConfirmar={() => void cambiarActivo(false)}
              onCancelar={() => setConfirmandoArchivo(false)}
            />
          ) : null}
        </div>
      </section>

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((current) => ({ ...current, open: false }))}
      />
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="mb-3 flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
      <EditorialRule />
      <span>{title}</span>
    </h2>
  );
}

function DatoLinea({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[28px] items-center gap-3">
      <span className="inline-flex min-w-[88px] items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-500">
        <span aria-hidden="true" className="text-ink-300">
          {icon}
        </span>
        {label}
      </span>
      <span className="font-sans text-[13px] text-ink-900">{children}</span>
    </div>
  );
}

function NotasEditor({
  pacienteId,
  initial,
  onSaved,
}: {
  pacienteId: string;
  initial: string;
  onSaved: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  const [savedValue, setSavedValue] = React.useState(initial);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  // Autoguardado con espera: el estado solo cambia dentro del timer, nunca
  // en el cuerpo del efecto.
  React.useEffect(() => {
    if (value === savedValue) return;

    let cancelled = false;
    const nextValue = value;
    const timer = window.setTimeout(async () => {
      setStatus("saving");
      try {
        await apiPatch(`/api/pacientes/${pacienteId}`, { notas: nextValue });
        if (cancelled) return;
        setSavedValue(nextValue);
        onSaved();
        setStatus("saved");
      } catch {
        if (cancelled) return;
        setStatus("error");
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pacienteId, value, savedValue, onSaved]);

  const hint =
    status === "saving"
      ? "Guardando…"
      : status === "saved"
        ? "Guardado."
        : status === "error"
          ? ALGO_FALLO
          : "Se guarda solo. Solo vos las ves.";

  return (
    <div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Notas breves, visibles solo para vos."
        aria-label="Notas privadas del paciente"
      />
      <p
        className={`mt-2 font-sans text-[11px] ${
          status === "error" ? "text-[color:var(--color-error)]" : "text-ink-300"
        }`}
      >
        {hint}
      </p>
    </div>
  );
}
