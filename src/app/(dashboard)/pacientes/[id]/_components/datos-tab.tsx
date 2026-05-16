"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Calendar as CalendarIcon,
  Edit3,
  Mail,
  Phone,
  RotateCcw,
  Wallet,
} from "lucide-react";

import { Button, EditorialRule, Sheet, Textarea, Toast } from "@/components/ui";
import { ConsentimientoBadge } from "@/components/grabacion/ConsentimientoBadge";
import { money } from "@/lib/format";
import type { Configuracion, Paciente } from "@/types/domain";

import { EditarPacienteForm } from "./editar-paciente-form";

interface DatosTabProps {
  paciente: Paciente;
  onPacienteActualizado?: () => void;
}

type PacientePatchResponse = { data: Paciente };

type ToastState = { open: boolean; message: string };

const fechaAltaFormatter = new Intl.DateTimeFormat("es-UY", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export function DatosTab({ paciente, onPacienteActualizado }: DatosTabProps) {
  const router = useRouter();
  const [config, setConfig] = React.useState<Configuracion | null>(null);
  const [showEditar, setShowEditar] = React.useState(false);
  const [archivando, setArchivando] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState>({
    open: false,
    message: "",
  });

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { data: Configuracion } | null) => {
        if (json) setConfig(json.data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  function handleEditSuccess() {
    setShowEditar(false);
    setToast({ open: true, message: "Paciente actualizado" });
    onPacienteActualizado?.();
  }

  async function toggleActivo() {
    const proximoActivo = !paciente.activo;
    const confirmar = window.confirm(
      proximoActivo
        ? "¿Reactivar este paciente?"
        : "¿Archivar este paciente? Podés reactivarlo después.",
    );
    if (!confirmar) return;

    setArchivando(true);
    try {
      const response = await fetch(`/api/pacientes/${paciente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: proximoActivo }),
      });

      if (!response.ok) {
        throw new Error("No se pudo actualizar.");
      }

      if (proximoActivo) {
        setToast({ open: true, message: "Paciente reactivado" });
        onPacienteActualizado?.();
      } else {
        router.push("/pacientes?archivado=1");
      }
    } catch {
      setToast({
        open: true,
        message: proximoActivo
          ? "No se pudo reactivar"
          : "No se pudo archivar",
      });
    } finally {
      setArchivando(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionTitle title="Datos de contacto" />
        <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
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
                icon={
                  <CalendarIcon
                    size={14}
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                }
                label="Alta"
              >
                <span className="text-ink-700">
                  {fechaAltaFormatter.format(new Date(paciente.creadoEn))}
                </span>
              </DatoLinea>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowEditar(true)}
              icon={<Edit3 size={14} strokeWidth={1.6} aria-hidden="true" />}
            >
              Editar
            </Button>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle title="Notas" />
        <NotasEditor
          pacienteId={paciente.id}
          initial={paciente.notas ?? ""}
          onSaved={() => onPacienteActualizado?.()}
        />
      </section>

      <section>
        <SectionTitle title="Grabación de sesiones" />
        <ConsentimientoBadge
          pacienteId={paciente.id}
          nombrePaciente={`${paciente.nombre} ${paciente.apellido}`}
          nombreProfesional={config?.nombreProfesional ?? ""}
          direccionConsultorio={config?.direccion ?? ""}
        />
      </section>

      <section>
        <SectionTitle title="Acciones" />
        <div className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p className="font-sans text-[13px] font-medium text-ink-900">
                {paciente.activo
                  ? "Paciente activo"
                  : "Paciente archivado"}
              </p>
              <p className="font-sans text-[12px] text-ink-500">
                {paciente.activo
                  ? "Archivar oculta al paciente de la lista. No borra historial."
                  : "Reactivar lo vuelve a mostrar en la lista de pacientes activos."}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={archivando}
              onClick={toggleActivo}
              icon={
                paciente.activo ? (
                  <Archive
                    size={14}
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                ) : (
                  <RotateCcw
                    size={14}
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                )
              }
              className={
                paciente.activo
                  ? "text-terracotta-500 hover:bg-terracotta-50"
                  : ""
              }
            >
              {paciente.activo
                ? archivando
                  ? "Archivando…"
                  : "Archivar paciente"
                : archivando
                  ? "Reactivando…"
                  : "Reactivar"}
            </Button>
          </div>
        </div>
      </section>

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((current) => ({ ...current, open: false }))}
      />

      <Sheet
        open={showEditar}
        onClose={() => setShowEditar(false)}
        maxWidth={520}
        ariaLabel="Editar paciente"
      >
        <EditarPacienteForm
          paciente={paciente}
          onSuccess={handleEditSuccess}
          onCancel={() => setShowEditar(false)}
        />
      </Sheet>
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
      <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-500 min-w-[88px]">
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
  onSaved: (notas: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  const [savedValue, setSavedValue] = React.useState(initial);
  const [status, setStatus] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  React.useEffect(() => {
    if (value === savedValue) return;

    let cancelled = false;
    const nextValue = value;
    const timer = window.setTimeout(async () => {
      setStatus("saving");
      try {
        const response = await fetch(`/api/pacientes/${pacienteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notas: nextValue }),
        });

        if (!response.ok) {
          throw new Error("No se pudieron guardar las notas.");
        }

        await (response.json() as Promise<PacientePatchResponse>);

        if (cancelled) return;
        setSavedValue(nextValue);
        onSaved(nextValue);
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
      ? "Guardando..."
      : status === "saved"
        ? "Guardado."
        : status === "error"
          ? "No se pudo guardar. Probá de nuevo."
          : "Se guarda automáticamente.";

  return (
    <div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Notas breves, visibles solo para vos."
        aria-label="Notas del paciente"
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
