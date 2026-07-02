"use client";

import * as React from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { getSession, signOut } from "next-auth/react";
import {
  Button,
  Card,
  EditorialRule,
  Input,
  Textarea,
} from "@/components/ui";
import type { Configuracion, OrientacionTeorica } from "@/types/domain";

const PLACEHOLDERS = [
  { label: "nombre", key: "nombre" },
  { label: "apellido", key: "apellido" },
  { label: "fecha", key: "fecha" },
  { label: "hora", key: "hora" },
  { label: "dirección", key: "direccion" },
  { label: "profesional", key: "profesional" },
] as const;

const DEFAULT_TEMPLATE =
  "Hola {{nombre}}, te recuerdo tu sesión del {{fecha}} a las {{hora}}. Hasta pronto, {{profesional}}.";

type ConfigField =
  | "nombreProfesional"
  | "direccion"
  | "whatsappOrigen"
  | "tarifaDefault"
  | "horasAnticipacion"
  | "templateRecordatorio"
  | "orientacionTeorica";

type ConfigForm = {
  nombreProfesional: string;
  direccion: string;
  whatsappOrigen: string;
  tarifaDefault: string;
  horasAnticipacion: number;
  templateRecordatorio: string;
  orientacionTeorica: OrientacionTeorica;
};

type ConfigPatch = Partial<{
  nombreProfesional: string;
  direccion: string;
  whatsappOrigen: string;
  tarifaDefault: number;
  horasAnticipacion: number;
  templateRecordatorio: string;
  orientacionTeorica: OrientacionTeorica;
}>;

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEFAULT_FORM: ConfigForm = {
  nombreProfesional: "",
  direccion: "Rivera 2540, Montevideo",
  whatsappOrigen: "+598 99 876 543",
  tarifaDefault: "2200",
  horasAnticipacion: 24,
  templateRecordatorio: DEFAULT_TEMPLATE,
  orientacionTeorica: "cbt_mi",
};

function formFromConfig(config: Configuracion): ConfigForm {
  return {
    nombreProfesional: config.nombreProfesional,
    direccion: config.direccion,
    whatsappOrigen: config.whatsappOrigen,
    tarifaDefault: String(config.tarifaDefault),
    horasAnticipacion: config.horasAnticipacion,
    templateRecordatorio: config.templateRecordatorio,
    orientacionTeorica: config.orientacionTeorica,
  };
}

function patchFromFields(
  form: ConfigForm,
  fields: ConfigField[],
): { patch: ConfigPatch; fields: ConfigField[]; invalid: boolean } {
  const patch: ConfigPatch = {};
  const included: ConfigField[] = [];
  let invalid = false;

  for (const field of fields) {
    if (field === "tarifaDefault") {
      const value = Number(form.tarifaDefault);
      if (!form.tarifaDefault.trim() || !Number.isFinite(value) || value < 0) {
        invalid = true;
        continue;
      }
      patch.tarifaDefault = value;
      included.push(field);
      continue;
    }

    if (field === "horasAnticipacion") {
      patch.horasAnticipacion = form.horasAnticipacion;
      included.push(field);
      continue;
    }

    if (field === "orientacionTeorica") {
      patch.orientacionTeorica = form.orientacionTeorica;
      included.push(field);
      continue;
    }

    patch[field] = form[field];
    included.push(field);
  }

  return { patch, fields: included, invalid };
}

export function ConfigView() {
  const [form, setForm] = React.useState<ConfigForm>(DEFAULT_FORM);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [sessionEmail, setSessionEmail] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const formRef = React.useRef(form);
  const debounceTimerRef = React.useRef<number | null>(null);
  const savedTimerRef = React.useRef<number | null>(null);
  const savePendingChangesRef = React.useRef<() => Promise<void>>(async () => {});
  const dirtyFieldsRef = React.useRef<Set<ConfigField>>(new Set());
  const inFlightRef = React.useRef(false);
  const flushAfterFlightRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  const clearSavedTimer = React.useCallback(() => {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }, []);

  const showSavedTemporarily = React.useCallback(() => {
    clearSavedTimer();
    setSaveStatus("saved");
    savedTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        setSaveStatus("idle");
      }
      savedTimerRef.current = null;
    }, 2000);
  }, [clearSavedTimer]);

  const scheduleSave = React.useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void savePendingChangesRef.current();
    }, 2000);
  }, []);

  const savePendingChanges = React.useCallback(async () => {
    if (inFlightRef.current) {
      flushAfterFlightRef.current = true;
      return;
    }

    const fields = Array.from(dirtyFieldsRef.current);
    if (fields.length === 0) return;

    const { patch, fields: sentFields, invalid } = patchFromFields(
      formRef.current,
      fields,
    );

    if (invalid) {
      setSaveStatus("error");
      return;
    }

    if (sentFields.length === 0) return;

    for (const field of sentFields) {
      dirtyFieldsRef.current.delete(field);
    }

    inFlightRef.current = true;
    clearSavedTimer();
    setSaveStatus("saving");

    let saved = false;

    try {
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        throw new Error("No se pudo guardar la configuración");
      }

      saved = true;
    } catch {
      for (const field of sentFields) {
        dirtyFieldsRef.current.add(field);
      }
      if (mountedRef.current) {
        setSaveStatus("error");
      }
    } finally {
      inFlightRef.current = false;
      const shouldFlush = flushAfterFlightRef.current;
      flushAfterFlightRef.current = false;

      if (!mountedRef.current) return;

      if (saved && dirtyFieldsRef.current.size === 0) {
        showSavedTemporarily();
      }

      if (dirtyFieldsRef.current.size > 0 && (saved || shouldFlush)) {
        scheduleSave();
      }
    }
  }, [clearSavedTimer, scheduleSave, showSavedTemporarily]);

  React.useEffect(() => {
    savePendingChangesRef.current = savePendingChanges;
  }, [savePendingChanges]);

  const loadConfig = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);

    try {
      const [payload, session] = await Promise.all([
        fetch("/api/config").then(async (response) => {
          if (!response.ok) {
            throw new Error("No se pudo cargar la configuración");
          }

          return (await response.json()) as { data: Configuracion };
        }),
        getSession().catch(() => null),
      ]);
      const nextForm = formFromConfig(payload.data);

      formRef.current = nextForm;
      dirtyFieldsRef.current.clear();
      setForm(nextForm);
      setSessionEmail(session?.user?.email ?? null);
      setSaveStatus("idle");
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    const loadTimer = window.setTimeout(() => {
      void loadConfig();
    }, 0);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(loadTimer);
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, [loadConfig]);

  const updateField = React.useCallback(
    <T extends ConfigField>(field: T, value: ConfigForm[T]) => {
      setForm((current) => {
        const next = { ...current, [field]: value };
        formRef.current = next;
        return next;
      });

      dirtyFieldsRef.current.add(field);
      clearSavedTimer();
      if (saveStatus === "saved" || saveStatus === "error") {
        setSaveStatus("idle");
      }
      scheduleSave();
    },
    [clearSavedTimer, saveStatus, scheduleSave],
  );

  const retrySave = React.useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void savePendingChanges();
  }, [savePendingChanges]);

  const insertPlaceholder = (key: string) => {
    const token = `{{${key}}}`;
    const el = textareaRef.current;
    if (!el) {
      updateField(
        "templateRecordatorio",
        form.templateRecordatorio + token,
      );
      return;
    }
    const start = el.selectionStart ?? form.templateRecordatorio.length;
    const end = el.selectionEnd ?? form.templateRecordatorio.length;
    const next =
      form.templateRecordatorio.slice(0, start) +
      token +
      form.templateRecordatorio.slice(end);
    updateField("templateRecordatorio", next);
    queueMicrotask(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      const pos = start + token.length;
      node.setSelectionRange(pos, pos);
    });
  };

  const preview = React.useMemo(() => {
    return form.templateRecordatorio
      .replaceAll("{{nombre}}", "Lucía")
      .replaceAll("{{apellido}}", "Fernández")
      .replaceAll("{{fecha}}", "martes 21 de abril")
      .replaceAll("{{hora}}", "10:00")
      .replaceAll("{{direccion}}", form.direccion)
      .replaceAll("{{profesional}}", form.nombreProfesional);
  }, [form]);

  if (loading) {
    return (
      <div className="px-5 lg:px-12 py-6 lg:py-10 max-w-[800px] mx-auto">
        <h1 className="lg:hidden font-display text-[30px] font-medium text-ink-900 mb-6 leading-tight tracking-tight">
          Configuración
        </h1>
        <Card>
          <p className="text-[14px] text-ink-500">Cargando configuración…</p>
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="px-5 lg:px-12 py-6 lg:py-10 max-w-[800px] mx-auto">
        <h1 className="lg:hidden font-display text-[30px] font-medium text-ink-900 mb-6 leading-tight tracking-tight">
          Configuración
        </h1>
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-ink-700">
              No se pudo cargar la configuración.
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={loadConfig}>
              Reintentar
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-5 lg:px-12 py-6 lg:py-10 max-w-[800px] mx-auto">
      <h1 className="lg:hidden font-display text-[30px] font-medium text-ink-900 mb-6 leading-tight tracking-tight">
        Configuración
      </h1>
      <SaveIndicator status={saveStatus} onRetry={retrySave} />

      <div className="flex flex-col gap-9">
        <section>
          <SectionHeading>Datos profesionales</SectionHeading>
          <Card>
            <div className="flex flex-col gap-4">
              <Input
                label="Nombre"
                value={form.nombreProfesional}
                onChange={(e) =>
                  updateField("nombreProfesional", e.target.value)
                }
              />
              <Input
                label="Consultorio"
                value={form.direccion}
                onChange={(e) => updateField("direccion", e.target.value)}
              />
              <Input
                label="WhatsApp de origen"
                value={form.whatsappOrigen}
                onChange={(e) =>
                  updateField("whatsappOrigen", e.target.value)
                }
              />
            </div>
          </Card>
        </section>

        <section>
          <SectionHeading>Orientación teórica</SectionHeading>
          <Card>
            <OrientacionSelect
              value={form.orientacionTeorica}
              onChange={(value) => updateField("orientacionTeorica", value)}
            />
            <p className="mt-2 text-[12px] text-ink-500">
              Define el instrumento con el que se evalúa el feedback de tus
              sesiones. Cognitivo-conductual usa CTS-R + MITI; Gestalt usa la
              GTFS.
            </p>
          </Card>
        </section>

        <section>
          <SectionHeading>Tarifa por defecto</SectionHeading>
          <Card>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[14px] font-semibold text-ink-500 pointer-events-none z-10"
              >
                $UYU
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.tarifaDefault}
                onChange={(e) => updateField("tarifaDefault", e.target.value)}
                aria-label="Tarifa por defecto"
                className="pl-[56px] tabular-nums"
              />
            </div>
            <p className="mt-2 text-[12px] text-ink-500">
              Se aplica a pacientes nuevos. Cada paciente puede tener tarifa
              propia.
            </p>
          </Card>
        </section>

        <section>
          <SectionHeading>Recordatorios por WhatsApp</SectionHeading>
          <Card>
            <div className="flex flex-col gap-5">
              <AntelacionSlider
                value={form.horasAnticipacion}
                onChange={(value) =>
                  updateField("horasAnticipacion", value)
                }
              />

              <TemplateEditor
                template={form.templateRecordatorio}
                onChange={(value) =>
                  updateField("templateRecordatorio", value)
                }
                textareaRef={textareaRef}
                onInsert={insertPlaceholder}
              />

              <Preview text={preview} />
            </div>
          </Card>
        </section>

        <section className="pt-2">
          <SectionHeading>Cuenta</SectionHeading>
          <Card className="!p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-display text-[20px] font-medium leading-tight text-ink-900">
                  {form.nombreProfesional}
                </p>
                {sessionEmail ? (
                  <p className="mt-1 truncate text-[13px] text-ink-500">
                    {sessionEmail}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="secondary"
                icon={<LogOut size={16} strokeWidth={2} />}
                className="w-full sm:w-auto"
                onClick={() => {
                  void signOut({ callbackUrl: "/login" });
                }}
              >
                Cerrar sesión
              </Button>
            </div>
          </Card>
          <p className="mt-6 text-center text-[11px] text-ink-300">
            v1.0 · hecho con cuidado
          </p>
        </section>
      </div>

      <style>{SLIDER_CSS}</style>
    </div>
  );
}

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "idle") return null;

  return (
    <div className="mb-5 flex min-h-8 items-center justify-end">
      {status === "saving" && (
        <span className="text-[12px] font-semibold text-ink-500">
          Guardando…
        </span>
      )}
      {status === "saved" && (
        <span className="text-[12px] font-semibold text-sage-600">
          Guardado.
        </span>
      )}
      {status === "error" && (
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-[color:var(--color-error)]">
            Error al guardar
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-500 mb-3">
      <EditorialRule />
      <span>{children}</span>
    </h2>
  );
}

const ORIENTACIONES: Array<{ value: OrientacionTeorica; label: string }> = [
  {
    value: "cbt_mi",
    label: "Cognitivo-conductual / Entrevista Motivacional",
  },
  { value: "gestalt", label: "Terapia Gestalt" },
];

function OrientacionSelect({
  value,
  onChange,
}: {
  value: OrientacionTeorica;
  onChange: (v: OrientacionTeorica) => void;
}) {
  const selectId = React.useId();

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={selectId}
        className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500"
      >
        Orientación teórica
      </label>
      <div className="relative flex items-center bg-cream-50 border border-[color:var(--border-subtle)] rounded-sm transition-colors duration-150 focus-within:bg-white focus-within:border-sage-500 focus-within:ring-[3px] focus-within:ring-sage-500/20">
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value as OrientacionTeorica)}
          className="flex-1 min-w-0 appearance-none bg-transparent px-[14px] py-[10px] pr-10 text-[15px] text-ink-900 outline-none cursor-pointer"
        >
          {ORIENTACIONES.map((opcion) => (
            <option key={opcion.value} value={opcion.value}>
              {opcion.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-[14px] h-4 w-4 text-ink-500"
        />
      </div>
    </div>
  );
}

function AntelacionSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-500">
          Enviar con anticipación
        </span>
        <span className="font-display text-[20px] font-medium text-sage-600 tabular-nums leading-none">
          {value}h
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={72}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Horas de anticipación"
        className="sesion-slider block w-full"
      />
      <div className="flex items-center justify-between mt-2 text-[11px] text-ink-300 tabular-nums">
        <span>1h</span>
        <span>24h</span>
        <span>48h</span>
        <span>72h</span>
      </div>
    </div>
  );
}

function TemplateEditor({
  template,
  onChange,
  textareaRef,
  onInsert,
}: {
  template: string;
  onChange: (s: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (key: string) => void;
}) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-500 mb-2">
        Template
      </span>
      <div className="flex flex-wrap gap-2 mb-3">
        {PLACEHOLDERS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onInsert(p.key)}
            className="inline-flex min-h-[44px] items-center rounded-full font-sans font-semibold uppercase tracking-[0.08em] whitespace-nowrap text-[10px] px-3 py-2 bg-cream-100 text-ink-700 hover:bg-cream-200 transition-colors duration-150 cursor-pointer"
          >
            {p.label}
          </button>
        ))}
      </div>
      <Textarea
        ref={textareaRef}
        value={template}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Template del recordatorio"
      />
    </div>
  );
}

function Preview({ text }: { text: string }) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-500 mb-2">
        Preview
      </span>
      <div className="bg-cream-100 rounded-[10px] px-4 py-[14px] italic text-[14px] text-ink-900 leading-[1.5] border-l-[3px] border-l-sage-500 whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

const SLIDER_CSS = `
.sesion-slider {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: var(--color-cream-200);
  border-radius: 9999px;
  outline: none;
  cursor: pointer;
}
.sesion-slider:focus-visible {
  outline: 2px solid var(--color-sage-500);
  outline-offset: 4px;
}
.sesion-slider::-webkit-slider-runnable-track {
  height: 4px;
  background: var(--color-cream-200);
  border-radius: 9999px;
}
.sesion-slider::-moz-range-track {
  height: 4px;
  background: var(--color-cream-200);
  border-radius: 9999px;
}
.sesion-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -8px;
  background: var(--color-sage-500);
  border-radius: 9999px;
  border: 2px solid #fff;
  box-shadow: 0 1px 2px rgba(26,38,40,.04), 0 1px 3px rgba(26,38,40,.06);
  cursor: pointer;
}
.sesion-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  background: var(--color-sage-500);
  border-radius: 9999px;
  border: 2px solid #fff;
  box-shadow: 0 1px 2px rgba(26,38,40,.04), 0 1px 3px rgba(26,38,40,.06);
  cursor: pointer;
}
`;
