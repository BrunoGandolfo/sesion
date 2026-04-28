"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, Sparkles } from "lucide-react";
import { Button, Chip } from "@/components/ui";

type AlianzaTerapeutica = "fragil" | "inestable" | "estable" | "fuerte";

interface DatosEstructurados {
  temas: string[];
  emocionesPaciente: string[];
  intensidadEmocional: number;
  alianzaTerapeutica: AlianzaTerapeutica;
  intervenciones: string[];
  compromisos: string[];
  senalesAlerta: string[];
  progresoPercibido: string;
}

interface NotaClinicaViewProps {
  sesionClinicaId: string;
  nota: {
    subjetivo: string;
    objetivo: string;
    analisis: string;
    plan: string;
  };
  datosEstructurados: DatosEstructurados | null;
  pacienteNombre: string;
  fechaSesion: string;
  onAprobado: () => void;
}

interface AutoTextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function AutoTextarea({ label, value, onChange, disabled }: AutoTextareaProps) {
  const id = React.useId();
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const adjustHeight = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500"
      >
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="bg-cream-100 border border-[color:var(--border-subtle)] rounded-md px-4 py-3 font-sans text-[14px] leading-[1.6] text-ink-900 outline-none transition-colors duration-150 focus-visible:border-sage-500 focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-sage-500/20 disabled:opacity-60 resize-none overflow-hidden"
      />
    </div>
  );
}

function alianzaTone(a: AlianzaTerapeutica): "sage" | "terracotta" | "gold" | "neutral" {
  if (a === "fragil") return "terracotta";
  if (a === "inestable") return "gold";
  if (a === "estable") return "neutral";
  return "sage";
}

function alianzaLabel(a: AlianzaTerapeutica): string {
  if (a === "fragil") return "Frágil";
  if (a === "inestable") return "Inestable";
  if (a === "estable") return "Estable";
  return "Fuerte";
}

function intensidadColor(intensidad: number): string {
  if (intensidad <= 3) return "var(--color-sage-500)";
  if (intensidad <= 6) return "var(--color-gold-500)";
  return "var(--color-terracotta-500)";
}

export function NotaClinicaView({
  sesionClinicaId,
  nota,
  datosEstructurados,
  pacienteNombre,
  fechaSesion,
  onAprobado,
}: NotaClinicaViewProps) {
  const [subjetivo, setSubjetivo] = React.useState(nota.subjetivo);
  const [objetivo, setObjetivo] = React.useState(nota.objetivo);
  const [analisis, setAnalisis] = React.useState(nota.analisis);
  const [plan, setPlan] = React.useState(nota.plan);

  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDescartar, setConfirmDescartar] = React.useState(false);
  const [datosAbierto, setDatosAbierto] = React.useState(true);

  const handleAprobar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sesion-clinica/${sesionClinicaId}/aprobar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sesionClinicaId,
            notaEditada: { subjetivo, objetivo, analisis, plan },
          }),
        },
      );
      if (!res.ok) {
        throw new Error("No pudimos guardar la nota. Intentá de nuevo.");
      }
      onAprobado();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No pudimos guardar la nota. Intentá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  };

  const handleDescartar = async () => {
    if (!confirmDescartar) {
      setConfirmDescartar(true);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinicaId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("No pudimos descartar la nota. Intentá de nuevo.");
      }
      onAprobado();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No pudimos descartar la nota. Intentá de nuevo.",
      );
      setConfirmDescartar(false);
    } finally {
      setEnviando(false);
    }
  };

  const tieneAlertas =
    datosEstructurados !== null && datosEstructurados.senalesAlerta.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Nota clínica
        </p>
        <h2 className="font-display text-[22px] md:text-[28px] font-medium tracking-[-0.01em] text-ink-900">
          {pacienteNombre}
        </h2>
        <p className="font-sans text-[14px] text-ink-500">{fechaSesion}</p>
      </header>

      <div className="flex items-center gap-2 rounded-md border border-gold-50 bg-gold-50 px-3 py-2">
        <Sparkles
          size={14}
          strokeWidth={1.8}
          aria-hidden="true"
          className="shrink-0 text-gold-500"
        />
        <Chip variant="gold" size="sm">
          Generada por IA
        </Chip>
        <span className="font-sans text-[13px] leading-[1.4] text-gold-500">
          Revisá antes de aprobar.
        </span>
      </div>

      <div className="flex flex-col gap-5">
        <AutoTextarea
          label="Subjetivo (S)"
          value={subjetivo}
          onChange={setSubjetivo}
          disabled={enviando}
        />
        <AutoTextarea
          label="Objetivo (O)"
          value={objetivo}
          onChange={setObjetivo}
          disabled={enviando}
        />
        <AutoTextarea
          label="Análisis (A)"
          value={analisis}
          onChange={setAnalisis}
          disabled={enviando}
        />
        <AutoTextarea
          label="Plan (P)"
          value={plan}
          onChange={setPlan}
          disabled={enviando}
        />
      </div>

      {datosEstructurados && (
        <section className="rounded-lg border border-[color:var(--border-subtle)] bg-white">
          <button
            type="button"
            aria-expanded={datosAbierto}
            aria-controls="datos-extraidos-panel"
            onClick={() => setDatosAbierto((open) => !open)}
            className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
          >
            <span className="font-display text-[16px] font-medium text-ink-900">
              Datos extraídos
            </span>
            <ChevronDown
              size={18}
              strokeWidth={1.8}
              aria-hidden="true"
              className={`shrink-0 text-ink-500 transition-transform duration-150 ${
                datosAbierto ? "rotate-180" : ""
              }`}
            />
          </button>

          {datosAbierto && (
            <div
              id="datos-extraidos-panel"
              className="flex flex-col gap-5 border-t border-[color:var(--border-subtle)] px-5 py-5"
            >
              {tieneAlertas && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-terracotta-100 bg-terracotta-50 px-3 py-3"
                >
                  <AlertTriangle
                    size={18}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className="mt-[2px] shrink-0 text-terracotta-500"
                  />
                  <div className="flex flex-col gap-1">
                    <p className="font-sans text-[13px] font-semibold uppercase tracking-[0.08em] text-terracotta-500">
                      Señales de alerta
                    </p>
                    <ul className="flex flex-col gap-1">
                      {datosEstructurados.senalesAlerta.map((s, i) => (
                        <li
                          key={i}
                          className="font-sans text-[14px] leading-[1.5] text-ink-900"
                        >
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {datosEstructurados.temas.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Temas
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {datosEstructurados.temas.map((t, i) => (
                      <Chip key={i} variant="neutral">
                        {t}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              {datosEstructurados.emocionesPaciente.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Emociones del paciente
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {datosEstructurados.emocionesPaciente.map((e, i) => (
                      <Chip key={i} variant="sage">
                        {e}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Intensidad emocional
                  </span>
                  <span className="font-display text-[14px] font-medium text-ink-900">
                    {datosEstructurados.intensidadEmocional}
                    <span className="text-ink-500"> / 10</span>
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={1}
                  aria-valuemax={10}
                  aria-valuenow={datosEstructurados.intensidadEmocional}
                  aria-label="Intensidad emocional"
                  className="h-2 w-full overflow-hidden rounded-full bg-cream-100"
                >
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{
                      width: `${Math.min(100, Math.max(0, datosEstructurados.intensidadEmocional * 10))}%`,
                      backgroundColor: intensidadColor(
                        datosEstructurados.intensidadEmocional,
                      ),
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Alianza terapéutica
                </span>
                <div>
                  <Chip
                    variant={alianzaTone(datosEstructurados.alianzaTerapeutica)}
                  >
                    {alianzaLabel(datosEstructurados.alianzaTerapeutica)}
                  </Chip>
                </div>
              </div>

              {datosEstructurados.intervenciones.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Intervenciones
                  </span>
                  <ul className="list-disc pl-5 flex flex-col gap-1">
                    {datosEstructurados.intervenciones.map((it, i) => (
                      <li
                        key={i}
                        className="font-sans text-[14px] leading-[1.6] text-ink-900"
                      >
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {datosEstructurados.compromisos.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Compromisos
                  </span>
                  <ul className="list-disc pl-5 flex flex-col gap-1">
                    {datosEstructurados.compromisos.map((c, i) => (
                      <li
                        key={i}
                        className="font-sans text-[14px] leading-[1.6] text-ink-900"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {datosEstructurados.progresoPercibido && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Progreso percibido
                  </span>
                  <p className="font-sans text-[14px] leading-[1.6] text-ink-900">
                    {datosEstructurados.progresoPercibido}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="font-sans text-[14px] text-[color:var(--color-error)]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={handleDescartar}
            disabled={enviando}
            className={confirmDescartar ? "!text-terracotta-500" : "!text-terracotta-500"}
          >
            {confirmDescartar ? "Confirmá: descartar" : "Descartar nota"}
          </Button>
          {confirmDescartar && (
            <button
              type="button"
              onClick={() => setConfirmDescartar(false)}
              className="font-sans text-[13px] text-ink-500 underline-offset-2 hover:underline"
              disabled={enviando}
            >
              Cancelar
            </button>
          )}
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={handleAprobar}
          disabled={enviando}
          aria-disabled={enviando}
        >
          {enviando ? "Aprobando…" : "Aprobar nota"}
        </Button>
      </div>
    </div>
  );
}
