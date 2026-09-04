"use client";

// Contenedor de los gráficos de progreso ("Cómo va"): carga /progreso,
// decide el estado (cargando, error, sin sesiones, poco recorrido) y arma la
// secuencia. Plegado hasta la tercera sesión; desde ahí, abierto.
//
// El ratio de habla no se muestra: el dato está bajo diagnóstico y hasta que
// sea confiable no se grafica (ver progreso-lecturas.ts, lecturaRatioHabla).

import * as React from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";

import { Button, Card, EditorialRule } from "@/components/ui";
import { esAbort } from "@/lib/api-client";
import { ALGO_FALLO, COMO_VA } from "@/lib/glosario";

import { fetchProgreso } from "../api-ficha";
import { contieneTerminosDeterioro } from "../progreso-lecturas";
import { AlianzaChart } from "./alianza";
import type { ProgresoResponse, SesionProgreso } from "./base";
import { FlagsRiesgoTimeline } from "./flags";
import { IntensidadChart } from "./intensidad";
import { IntervencionesChart } from "./intervenciones";
import { TemasTable } from "./temas";

const SESIONES_PARA_GRAFICOS = 3;

// Resultado atado al paciente que lo cargó: si cambia el id, el anterior
// deja de aplicar por derivación, sin resetear estado en un efecto.
type Carga =
  | { tipo: "cargando"; pacienteId: string }
  | { tipo: "lista"; pacienteId: string; data: ProgresoResponse }
  | { tipo: "error"; pacienteId: string; mensaje: string };

export function GraficosProgreso({ pacienteId }: { pacienteId: string }) {
  const [carga, setCarga] = React.useState<Carga>({ tipo: "cargando", pacienteId });
  const [reloadKey, setReloadKey] = React.useState(0);
  // null = todavía no lo tocó: se abre solo cuando hay recorrido suficiente.
  const [abiertoManual, setAbiertoManual] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchProgreso<ProgresoResponse>(pacienteId, { signal: controller.signal })
      .then((data) => setCarga({ tipo: "lista", pacienteId, data }))
      .catch((err: unknown) => {
        if (esAbort(err)) return;
        setCarga({
          tipo: "error",
          pacienteId,
          mensaje: err instanceof Error ? err.message : ALGO_FALLO,
        });
      });
    return () => controller.abort();
  }, [pacienteId, reloadKey]);

  const actual: Carga =
    carga.pacienteId === pacienteId ? carga : { tipo: "cargando", pacienteId };

  const sesiones: SesionProgreso[] =
    actual.tipo === "lista" && Array.isArray(actual.data.sesiones)
      ? actual.data.sesiones
      : [];
  const totalSesiones =
    actual.tipo === "lista" ? (actual.data.totalSesiones ?? sesiones.length) : 0;
  const haySuficiente = totalSesiones >= SESIONES_PARA_GRAFICOS;
  const abierto = abiertoManual ?? haySuficiente;

  return (
    <section aria-labelledby="como-va-heading">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbiertoManual(!abierto)}
        className="mb-3 flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center">
          <EditorialRule />
          <span
            id="como-va-heading"
            className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500"
          >
            {COMO_VA}
          </span>
        </span>
        <span className="flex items-center gap-2 font-sans text-[12px] text-ink-500">
          {actual.tipo === "lista" && !haySuficiente ? (
            <span>A partir de la tercera sesión</span>
          ) : null}
          <ChevronDown
            size={16}
            strokeWidth={1.8}
            aria-hidden="true"
            className={`transition-transform duration-150 ${abierto ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {abierto ? (
        <CuerpoGraficos
          carga={actual}
          sesiones={sesiones}
          totalSesiones={totalSesiones}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : null}
    </section>
  );
}

function CuerpoGraficos({
  carga,
  sesiones,
  totalSesiones,
  onRetry,
}: {
  carga: Carga;
  sesiones: SesionProgreso[];
  totalSesiones: number;
  onRetry: () => void;
}) {
  if (carga.tipo === "cargando") return <ProgresoSkeleton />;
  if (carga.tipo === "error") return <ErrorState mensaje={carga.mensaje} onRetry={onRetry} />;
  if (totalSesiones === 0) return <EmptyState variante="sin-sesiones" />;
  if (totalSesiones < SESIONES_PARA_GRAFICOS) {
    return <EmptyState variante="poco-recorrido" />;
  }

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <ProgresoDestacado sesiones={sesiones} />
      <FlagsRiesgoTimeline sesiones={sesiones} />
      <IntensidadChart sesiones={sesiones} />
      <AlianzaChart sesiones={sesiones} />
      <TemasTable sesiones={sesiones} />
      <IntervencionesChart sesiones={sesiones} />
      <ObservacionIA sesiones={sesiones} />
    </div>
  );
}

function ProgresoSkeleton() {
  return (
    <div className="flex flex-col gap-5 lg:gap-6" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-[color:var(--border-subtle)] bg-white p-5"
        >
          <div className="h-4 w-40 rounded-sm bg-cream-200" />
          <div className="mt-2 h-3 w-64 max-w-full rounded-sm bg-cream-100" />
          <div className="mt-5 h-[140px] w-full rounded-sm bg-cream-100" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ mensaje, onRetry }: { mensaje: string; onRetry: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-3" role="alert">
        <div className="flex items-start gap-2">
          <AlertTriangle
            size={20}
            strokeWidth={1.8}
            aria-hidden="true"
            className="mt-[2px] shrink-0 text-terracotta-500"
          />
          <p className="font-sans text-[14px] leading-[1.6] text-ink-900">{mensaje}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    </Card>
  );
}

const EMPTY_STATE_TEXTOS = {
  "sin-sesiones": {
    titulo: "Todavía no hay sesiones para mirar en perspectiva.",
    detalle:
      "Cuando grabes y apruebes las primeras sesiones, acá vas a ver cómo evoluciona el recorrido.",
  },
  "poco-recorrido": {
    titulo: "Todavía no hay suficiente recorrido.",
    detalle: "Los gráficos aparecen a partir de la tercera sesión grabada.",
  },
} as const;

function EmptyState({ variante }: { variante: keyof typeof EMPTY_STATE_TEXTOS }) {
  const textos = EMPTY_STATE_TEXTOS[variante];
  return (
    <div className="rounded-lg border border-dashed border-[color:var(--border-strong,#C2D4CB)] bg-cream-50 px-6 py-10 text-center">
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        aria-hidden="true"
        className="mx-auto text-sage-500"
        fill="none"
      >
        <path
          d="M8 36 L18 24 L26 30 L40 12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 4"
        />
        <circle cx="40" cy="12" r="2.5" fill="currentColor" />
      </svg>
      <p className="mt-4 font-[family-name:var(--font-display)] text-[18px] font-medium italic text-ink-900">
        {textos.titulo}
      </p>
      <p className="mt-2 text-[13px] leading-[1.5] text-ink-500">{textos.detalle}</p>
    </div>
  );
}

// ============================================
// Progreso percibido (card destacada)
// ============================================
function ProgresoDestacado({ sesiones }: { sesiones: SesionProgreso[] }) {
  const ultima = [...sesiones]
    .reverse()
    .find((s) => s.progresoPercibido && s.progresoPercibido.trim().length > 0);
  if (!ultima) return null;

  const texto = (ultima.progresoPercibido ?? "").trim();
  const alerta = contieneTerminosDeterioro(texto);

  return (
    <section
      className={
        alerta
          ? "rounded-lg border border-terracotta-100 border-l-2 border-l-terracotta-500 bg-terracotta-50/40 p-4 lg:p-5"
          : "rounded-lg border border-[color:var(--border-subtle)] border-l-2 border-l-sage-500 bg-cream-50 p-4 lg:p-5"
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Progreso percibido — Sesión {ultima.numero}
      </p>
      <p className="mt-2 font-[family-name:var(--font-display)] text-[17px] italic leading-[1.5] text-ink-900">
        «{texto}»
      </p>
    </section>
  );
}

// ============================================
// Observación IA
// ============================================
function ObservacionIA({ sesiones }: { sesiones: SesionProgreso[] }) {
  const ultimaConObs = [...sesiones]
    .reverse()
    .find((s) => s.observacionIA && s.observacionIA.trim().length > 0);
  if (!ultimaConObs) return null;

  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] border-l-2 border-l-gold-500 bg-cream-50 p-4 lg:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Observación IA — Sesión {ultimaConObs.numero}
      </p>
      <p className="mt-2 font-[family-name:var(--font-display)] text-[16px] italic leading-[1.5] text-ink-900">
        «{ultimaConObs.observacionIA}»
      </p>
    </section>
  );
}
