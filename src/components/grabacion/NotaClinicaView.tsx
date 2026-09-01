"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, Sparkles } from "lucide-react";
import { Button, Chip } from "@/components/ui";
import { RiesgoDetectadoBanner } from "@/components/grabacion/RiesgoDetectadoBanner";
import { normalizarRiesgo } from "@/types/domain";
import type {
  AlianzaTerapeutica,
  ConfianzaModelo,
  DatosEstructurados as DatosEstructuradosBase,
  FlagsRiesgo,
  IntervencionTerapeuta,
  NotaSOAP,
} from "@/types/domain";

type RiesgoKey =
  | "ideacionSuicida"
  | "autolesion"
  | "violenciaTerceros"
  | "sintomasPsicoticos"
  | "crisisPanico";

type DatosEstructurados = Omit<DatosEstructuradosBase, "intervenciones"> & {
  intervenciones: IntervencionTerapeuta[] | string[];
  senalesAlerta?: string[] | null;
};

interface NotaClinicaViewProps {
  sesionClinicaId: string;
  nota: NotaSOAP | null;
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

interface RiesgoActivo {
  key: RiesgoKey;
  label: string;
}

interface IntervencionNormalizada {
  id: string;
  tipo: string;
  descripcion: string;
  timestamp: string | null;
}

const RIESGO_LABELS: Record<RiesgoKey, string> = {
  ideacionSuicida: "Ideación suicida",
  autolesion: "Autolesión",
  violenciaTerceros: "Violencia hacia terceros",
  sintomasPsicoticos: "Síntomas psicóticos",
  crisisPanico: "Crisis de pánico",
};

const RIESGO_KEYS: RiesgoKey[] = [
  "ideacionSuicida",
  "autolesion",
  "violenciaTerceros",
  "sintomasPsicoticos",
  "crisisPanico",
];

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

function alianzaTone(
  alianza: AlianzaTerapeutica,
): "sage" | "terracotta" | "gold" | "neutral" {
  if (alianza === "fragil") return "terracotta";
  if (alianza === "inestable") return "gold";
  if (alianza === "estable") return "neutral";
  return "sage";
}

function alianzaLabel(alianza: AlianzaTerapeutica): string {
  if (alianza === "fragil") return "Frágil";
  if (alianza === "inestable") return "Inestable";
  if (alianza === "estable") return "Estable";
  return "Fuerte";
}

function intensidadColor(intensidad: number): string {
  if (intensidad <= 3) return "var(--color-sage-500)";
  if (intensidad <= 6) return "var(--color-gold-500)";
  return "var(--color-terracotta-500)";
}

function confianzaTone(
  confianza: ConfianzaModelo,
): "sage" | "terracotta" | "gold" {
  if (confianza === "alta") return "sage";
  if (confianza === "media") return "gold";
  return "terracotta";
}

function confianzaLabel(confianza: ConfianzaModelo): string {
  if (confianza === "alta") return "Confianza alta";
  if (confianza === "media") return "Confianza media";
  return "Confianza baja";
}

function normalizarTexto(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Intervención";
  return trimmed.replace(/[_-]+/g, " ");
}

function parseTimestampSeconds(timestamp: string | number | null): number {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (typeof timestamp !== "string") {
    return Number.POSITIVE_INFINITY;
  }

  const trimmed = timestamp.trim();
  if (!trimmed) {
    return Number.POSITIVE_INFINITY;
  }

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return Number.POSITIVE_INFINITY;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return Number.POSITIVE_INFINITY;
}

function formatTimestamp(timestamp: string | number | null): string | null {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const total = Math.max(0, Math.round(timestamp));
    const minutes = Math.floor(total / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (total % 60).toString().padStart(2, "0");
    return `~${minutes}:${seconds}`;
  }

  if (typeof timestamp === "string") {
    const trimmed = timestamp.trim();
    if (trimmed) {
      const numericValue = Number(trimmed);
      if (Number.isFinite(numericValue)) {
        return formatTimestamp(numericValue);
      }
      return `~${trimmed}`;
    }
  }

  return null;
}

function getRiesgosActivos(flagsRiesgo: FlagsRiesgo | null | undefined): RiesgoActivo[] {
  if (!flagsRiesgo) {
    return [];
  }

  return RIESGO_KEYS.filter((key) => flagsRiesgo[key]).map((key) => ({
    key,
    label: RIESGO_LABELS[key],
  }));
}

function normalizarIntervenciones(
  intervenciones: DatosEstructurados["intervenciones"] | undefined,
): IntervencionNormalizada[] {
  if (!intervenciones || intervenciones.length === 0) {
    return [];
  }

  return intervenciones
    .map((intervencion, index) => {
      if (typeof intervencion === "string") {
        return {
          id: `intervencion-${index}-${intervencion}`,
          tipo: "Intervención",
          descripcion: intervencion,
          timestamp: null,
        };
      }

      return {
        id: `intervencion-${index}-${intervencion.tipo}-${intervencion.timestampAprox}`,
        tipo: normalizarTexto(intervencion.tipo),
        descripcion: intervencion.descripcion,
        timestamp: intervencion.timestampAprox,
      };
    })
    .sort(
      (a, b) =>
        parseTimestampSeconds(a.timestamp) - parseTimestampSeconds(b.timestamp),
    );
}

export function NotaClinicaView({
  sesionClinicaId,
  nota,
  datosEstructurados,
  pacienteNombre,
  fechaSesion,
  onAprobado,
}: NotaClinicaViewProps) {
  // Los hooks van antes de la guarda de nota nula (reglas de hooks).
  const [subjetivo, setSubjetivo] = React.useState(nota?.subjetivo ?? "");
  const [objetivo, setObjetivo] = React.useState(nota?.objetivo ?? "");
  const [analisis, setAnalisis] = React.useState(nota?.analisis ?? "");
  const [plan, setPlan] = React.useState(nota?.plan ?? "");

  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDescartar, setConfirmDescartar] = React.useState(false);
  const [datosAbierto, setDatosAbierto] = React.useState(true);
  const [flagsDismissed, setFlagsDismissed] = React.useState<
    Record<string, boolean>
  >({});
  // Confirmación de la señal de riesgo graduada (riesgoDetectado). Separada
  // de los flags booleanos: el backend (/aprobar) exige confirmoRiesgo=true
  // cuando el nivel es alto o moderado.
  const [riesgoRevisado, setRiesgoRevisado] = React.useState(false);

  const riesgo = normalizarRiesgo(datosEstructurados?.riesgoDetectado);
  const nivelExigeConfirmacion =
    riesgo.nivel === "alto" || riesgo.nivel === "moderado";

  const riesgosActivos = getRiesgosActivos(datosEstructurados?.flagsRiesgo);
  const flagsDismissedActivos = riesgosActivos.reduce<Record<string, boolean>>(
    (acc, { key }) => {
      acc[key] = flagsDismissed[key] ?? false;
      return acc;
    },
    {},
  );
  const todosLosRiesgosRevisados =
    riesgosActivos.length === 0 ||
    riesgosActivos.every(({ key }) => flagsDismissedActivos[key]);
  const requiereRevisionRiesgo =
    !todosLosRiesgosRevisados || (nivelExigeConfirmacion && !riesgoRevisado);
  const mostrarAlertasLegacy =
    riesgosActivos.length === 0 &&
    datosEstructurados !== null &&
    (datosEstructurados.senalesAlerta?.length ?? 0) > 0;
  const intervenciones = normalizarIntervenciones(datosEstructurados?.intervenciones);

  // Guarda defensiva: los padres ya chequean sesion.nota, pero si la nota
  // todavía no llegó no hay nada que revisar ni aprobar.
  if (!nota) {
    return (
      <p
        role="status"
        className="font-sans text-[14px] leading-[1.6] text-ink-500"
      >
        La nota todavía no está disponible.
      </p>
    );
  }

  // Lee el mensaje `error` del JSON de un 400/409 (ApiError del backend);
  // para cualquier otro fallo devuelve el genérico.
  const mensajeDeRespuesta = async (
    res: Response,
    generico: string,
  ): Promise<string> => {
    if (res.status === 400 || res.status === 409) {
      try {
        const json: unknown = await res.json();
        if (
          json &&
          typeof json === "object" &&
          typeof (json as { error?: unknown }).error === "string"
        ) {
          return (json as { error: string }).error;
        }
      } catch {
        // body no-JSON: cae al genérico
      }
    }
    return generico;
  };

  const handleAprobar = async () => {
    if (requiereRevisionRiesgo) {
      setError("Revisá y marcá cada señal de riesgo antes de aprobar la nota.");
      return;
    }

    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinicaId}/aprobar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sesionClinicaId,
          notaEditada: { subjetivo, objetivo, analisis, plan },
          ...(nivelExigeConfirmacion ? { confirmoRiesgo: true } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(
          await mensajeDeRespuesta(
            res,
            "No pudimos guardar la nota. Intentá de nuevo.",
          ),
        );
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

  // Paso 2 del descarte (el paso 1 arma el panel de confirmación explícito).
  // El DELETE para "revision" limpia SOLO la nota y los datos generados: la
  // transcripción y el audio no se tocan y la sesión queda reprocesable.
  const ejecutarDescarte = async () => {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinicaId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(
          await mensajeDeRespuesta(
            res,
            "No pudimos descartar la nota. Intentá de nuevo.",
          ),
        );
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

  const toggleFlagDismissed = (key: RiesgoKey, checked: boolean) => {
    setFlagsDismissed((prev) => ({
      ...prev,
      [key]: checked,
    }));
  };

  return (
    <div className="flex flex-col gap-6">
      {riesgosActivos.length > 0 && (
        <section
          role="alert"
          className="rounded-lg border-2 border-terracotta-500 bg-terracotta-50 px-4 py-4 sm:px-5"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={26}
                strokeWidth={1.9}
                aria-hidden="true"
                className="mt-[2px] shrink-0 text-terracotta-500"
              />
              <div className="flex flex-col gap-1">
                <h2 className="font-display text-[20px] font-medium text-ink-900">
                  ⚠ Señales de riesgo detectadas
                </h2>
                <p className="font-sans text-[14px] leading-[1.6] text-ink-700">
                  Antes de aprobar la nota, revisá y confirmá cada señal marcada.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {riesgosActivos.map(({ key, label }) => {
                const checkboxId = `riesgo-${key}`;
                return (
                  <label
                    key={key}
                    htmlFor={checkboxId}
                    className="flex items-start gap-3 rounded-md border border-terracotta-100 bg-white/80 px-3 py-3"
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={Boolean(flagsDismissedActivos[key])}
                      onChange={(event) =>
                        toggleFlagDismissed(key, event.target.checked)
                      }
                      className="mt-[3px] h-[18px] w-[18px] shrink-0 cursor-pointer accent-sage-500"
                    />
                    <div className="flex flex-1 flex-col gap-1">
                      <span className="font-sans text-[15px] font-semibold leading-[1.5] text-ink-900">
                        {label}
                      </span>
                      <span className="font-sans text-[13px] text-ink-500">
                        Revisé esta señal
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>

            {datosEstructurados?.flagsRiesgo?.detalle && (
              <div className="rounded-md border border-terracotta-100 bg-white/80 px-4 py-3">
                <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-terracotta-500">
                  Segmento citado
                </p>
                <p className="mt-2 font-sans text-[14px] leading-[1.7] text-ink-900">
                  {datosEstructurados.flagsRiesgo.detalle}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <RiesgoDetectadoBanner
        riesgoDetectado={datosEstructurados?.riesgoDetectado}
      />

      {nivelExigeConfirmacion && (
        <label
          htmlFor="riesgo-detectado-revisado"
          className="flex items-start gap-3 rounded-md border border-terracotta-100 bg-white/80 px-3 py-3"
        >
          <input
            id="riesgo-detectado-revisado"
            type="checkbox"
            checked={riesgoRevisado}
            onChange={(event) => setRiesgoRevisado(event.target.checked)}
            className="mt-[3px] h-[18px] w-[18px] shrink-0 cursor-pointer accent-sage-500"
          />
          <div className="flex flex-1 flex-col gap-1">
            <span className="font-sans text-[15px] font-semibold leading-[1.5] text-ink-900">
              Revisé esta señal de riesgo
            </span>
            <span className="font-sans text-[13px] text-ink-500">
              Nivel {riesgo.nivel}: la aprobación requiere confirmar que la
              revisaste.
            </span>
          </div>
        </label>
      )}

      <header className="flex flex-col gap-2">
        <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Nota clínica
        </p>
        <h2 className="font-display text-[22px] md:text-[28px] font-medium tracking-[-0.01em] text-ink-900">
          {pacienteNombre}
        </h2>
        <p className="font-sans text-[14px] text-ink-500">{fechaSesion}</p>
      </header>

      <div className="flex flex-col gap-2 rounded-md border border-gold-50 bg-gold-50 px-3 py-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Sparkles
            size={14}
            strokeWidth={1.8}
            aria-hidden="true"
            className="shrink-0 text-gold-500"
          />
          <Chip variant="gold" size="sm">
            Generada por IA
          </Chip>
          {datosEstructurados?.confianzaModelo && (
            <Chip
              variant={confianzaTone(datosEstructurados.confianzaModelo)}
              size="sm"
            >
              {confianzaLabel(datosEstructurados.confianzaModelo)}
            </Chip>
          )}
        </div>
        <span className="font-sans text-[13px] leading-[1.4] text-gold-500">
          Revisá antes de aprobar.
        </span>
      </div>

      {(datosEstructurados?.resumenSesion ||
        datosEstructurados?.estadoEmocionalObservado) && (
        <div className="flex flex-col gap-3">
          {datosEstructurados?.resumenSesion && (
            <section className="rounded-lg bg-cream-100 px-4 py-4">
              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Resumen de la sesión
              </p>
              <p className="mt-2 font-sans text-[14px] leading-[1.7] text-ink-900">
                {datosEstructurados.resumenSesion}
              </p>
            </section>
          )}

          {datosEstructurados?.estadoEmocionalObservado && (
            <section className="rounded-lg bg-cream-100 px-4 py-4">
              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Estado emocional observado
              </p>
              <p className="mt-2 font-sans text-[14px] leading-[1.7] text-ink-900">
                {datosEstructurados.estadoEmocionalObservado}
              </p>
            </section>
          )}
        </div>
      )}

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
              {mostrarAlertasLegacy && (
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
                      {datosEstructurados.senalesAlerta?.map((senal, index) => (
                        <li
                          key={`${senal}-${index}`}
                          className="font-sans text-[14px] leading-[1.5] text-ink-900"
                        >
                          {senal}
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
                    {datosEstructurados.temas.map((tema, index) => (
                      <Chip key={`${tema}-${index}`} variant="neutral">
                        {tema}
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
                    {datosEstructurados.emocionesPaciente.map((emocion, index) => (
                      <Chip key={`${emocion}-${index}`} variant="sage">
                        {emocion}
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
                      width: `${Math.min(
                        100,
                        Math.max(0, datosEstructurados.intensidadEmocional * 10),
                      )}%`,
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

              {intervenciones.length > 0 && (
                <div className="flex flex-col gap-3">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Intervenciones de la terapeuta
                  </span>
                  <div className="flex flex-col gap-3">
                    {intervenciones.map((intervencion) => (
                      <div
                        key={intervencion.id}
                        className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip variant="neutral">{intervencion.tipo}</Chip>
                            {formatTimestamp(intervencion.timestamp) && (
                              <span className="font-sans text-[12px] text-ink-500">
                                {formatTimestamp(intervencion.timestamp)}
                              </span>
                            )}
                          </div>
                          <p className="font-sans text-[14px] leading-[1.6] text-ink-900 sm:max-w-[70%]">
                            {intervencion.descripcion}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(datosEstructurados.materialRecurrente?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Material recurrente
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {datosEstructurados.materialRecurrente?.map((material, index) => (
                      <Chip key={`${material}-${index}`} variant="neutral">
                        {material}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              {(datosEstructurados.materialNuevo?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Material nuevo
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {datosEstructurados.materialNuevo?.map((material, index) => (
                      <Chip key={`${material}-${index}`} variant="sage">
                        {material}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              {datosEstructurados.compromisos.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Compromisos
                  </span>
                  <ul className="list-disc pl-5 flex flex-col gap-1">
                    {datosEstructurados.compromisos.map((compromiso, index) => (
                      <li
                        key={`${compromiso}-${index}`}
                        className="font-sans text-[14px] leading-[1.6] text-ink-900"
                      >
                        {compromiso}
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

              {datosEstructurados.focoProximaSesion && (
                <div className="rounded-md bg-cream-100 px-4 py-4">
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Foco sugerido para próxima sesión
                  </span>
                  <p className="mt-2 font-sans text-[14px] leading-[1.6] text-ink-900">
                    {datosEstructurados.focoProximaSesion}
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

      <div className="flex flex-col gap-2">
        {requiereRevisionRiesgo && (
          <p className="font-sans text-[13px] leading-[1.5] text-terracotta-500">
            Para aprobar la nota, primero tenés que revisar y marcar cada señal de
            riesgo detectada.
          </p>
        )}

        {confirmDescartar && (
          <section
            role="alertdialog"
            aria-label="Confirmar descarte de la nota"
            className="rounded-lg border-2 border-terracotta-500 bg-terracotta-50 px-4 py-4"
          >
            <h3 className="font-display text-[17px] font-medium text-ink-900">
              ¿Descartar esta nota?
            </h3>
            <ul className="mt-2 flex flex-col gap-1">
              <li className="font-sans text-[14px] leading-[1.6] text-ink-900">
                <strong>Se descarta:</strong> la nota generada y los datos
                extraídos.
              </li>
              <li className="font-sans text-[14px] leading-[1.6] text-ink-900">
                <strong>Se conserva:</strong> la transcripción, y el audio si
                todavía está disponible. La sesión queda para reprocesar.
              </li>
            </ul>
            <p className="mt-2 font-sans text-[13px] leading-[1.5] text-ink-700">
              Esto no elimina la sesión: el borrado definitivo es una acción
              separada, con su propia confirmación, disponible después del
              descarte.
            </p>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-3">
              <button
                type="button"
                onClick={() => setConfirmDescartar(false)}
                className="font-sans text-[13px] text-ink-500 underline-offset-2 hover:underline"
                disabled={enviando}
              >
                Cancelar
              </button>
              <Button
                type="button"
                variant="secondary"
                onClick={ejecutarDescarte}
                disabled={enviando}
                className="!text-terracotta-500"
              >
                {enviando ? "Descartando…" : "Sí, descartar la nota"}
              </Button>
            </div>
          </section>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmDescartar(true)}
            disabled={enviando || confirmDescartar}
            className="!text-terracotta-500"
          >
            Descartar nota
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleAprobar}
            disabled={enviando || requiereRevisionRiesgo}
            aria-disabled={enviando || requiereRevisionRiesgo}
            className="w-full sm:w-auto"
          >
            {enviando ? "Aprobando…" : "Aprobar nota"}
          </Button>
        </div>
      </div>
    </div>
  );
}
