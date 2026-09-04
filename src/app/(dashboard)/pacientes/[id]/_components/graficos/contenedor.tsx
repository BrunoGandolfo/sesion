"use client";

// Contenedor del Recorrido ("Cómo va"): selector de período, carga de
// /progreso para ese período y la secuencia de gráficos.
//
// El período viaja en la URL (?rango=): así el enlace que ella se manda a sí
// misma, o el back del navegador, vuelven a lo que estaba mirando. La carga
// se dispara por el período, no por un botón.
//
// El ratio de habla no se muestra: el dato está bajo diagnóstico y hasta que
// sea confiable no se grafica (ver progreso-lecturas.ts, lecturaRatioHabla).

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronDown } from "lucide-react";

import { Button, Card, EditorialRule } from "@/components/ui";
import { apiGet, esAbort } from "@/lib/api-client";
import { ALGO_FALLO, COMO_VA, REINTENTAR } from "@/lib/glosario";

import { contieneTerminosDeterioro } from "../progreso-lecturas";
import { AlianzaChart } from "./alianza";
import {
  esRango,
  fechaDe,
  type ProgresoResponse,
  type RangoProgreso,
} from "./base";
import { FlagsRiesgoTimeline } from "./flags";
import { IntensidadChart } from "./intensidad";
import { IntervencionesChart } from "./intervenciones";
import { SelectorRango } from "./selector-rango";
import { TemasTable } from "./temas";
import {
  DESDE_LA_TERCERA,
  OBSERVACION_IA,
  POCO_RECORRIDO_DETALLE,
  POCO_RECORRIDO_TITULO,
  PROGRESO_PERCIBIDO,
  RANGO_SIN_SESIONES,
  SIN_SESIONES_DETALLE,
  SIN_SESIONES_TITULO,
  VER_LA_SESION,
} from "./textos";

const SESIONES_PARA_GRAFICOS = 3;
const RANGO_POR_DEFECTO: RangoProgreso = "10s";

// Resultado atado al paciente y al período que lo pidieron: si cambia
// cualquiera de los dos, el anterior deja de aplicar por derivación, sin
// resetear estado dentro de un efecto.
type Carga =
  | { tipo: "cargando"; clave: string }
  | { tipo: "lista"; clave: string; data: ProgresoResponse }
  | { tipo: "error"; clave: string; mensaje: string };

function claveDe(pacienteId: string, rango: RangoProgreso): string {
  return `${pacienteId}·${rango}`;
}

export function GraficosProgreso({ pacienteId }: { pacienteId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const enUrl = searchParams.get("rango");
  const rango: RangoProgreso = esRango(enUrl) ? enUrl : RANGO_POR_DEFECTO;
  const clave = claveDe(pacienteId, rango);

  const [carga, setCarga] = React.useState<Carga>({ tipo: "cargando", clave });
  const [reloadKey, setReloadKey] = React.useState(0);
  // null = todavía no lo tocó: se abre solo cuando hay recorrido suficiente.
  const [abiertoManual, setAbiertoManual] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<ProgresoResponse>(
      `/api/pacientes/${pacienteId}/progreso?rango=${rango}`,
      { signal: controller.signal },
    )
      .then((data) => setCarga({ tipo: "lista", clave, data }))
      .catch((err: unknown) => {
        if (esAbort(err)) return;
        setCarga({
          tipo: "error",
          clave,
          mensaje: err instanceof Error ? err.message : ALGO_FALLO,
        });
      });
    return () => controller.abort();
  }, [pacienteId, rango, clave, reloadKey]);

  const cambiarRango = (siguiente: RangoProgreso) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("rango", siguiente);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const actual: Carga =
    carga.clave === clave ? carga : { tipo: "cargando", clave };

  const data = actual.tipo === "lista" ? actual.data : null;
  const totalSesiones = data?.totalSesiones ?? 0;
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
            <span>{DESDE_LA_TERCERA}</span>
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
        <div className="flex flex-col gap-5 lg:gap-6">
          {haySuficiente ? (
            <div className="overflow-x-auto">
              <SelectorRango valor={rango} onCambio={cambiarRango} />
            </div>
          ) : null}

          <CuerpoGraficos
            carga={actual}
            totalSesiones={totalSesiones}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      ) : null}
    </section>
  );
}

function CuerpoGraficos({
  carga,
  totalSesiones,
  onRetry,
}: {
  carga: Carga;
  totalSesiones: number;
  onRetry: () => void;
}) {
  if (carga.tipo === "cargando") return <ProgresoSkeleton />;
  if (carga.tipo === "error") {
    return <ErrorState mensaje={carga.mensaje} onRetry={onRetry} />;
  }
  if (totalSesiones === 0) return <EmptyState variante="sin-sesiones" />;
  if (totalSesiones < SESIONES_PARA_GRAFICOS) {
    return <EmptyState variante="poco-recorrido" />;
  }

  const { temas, riesgos } = carga.data;
  // Orden cronológico ascendente, explícito: los gráficos leen "la última"
  // como la última del arreglo y los tramos de la línea dependen del orden.
  // Si la API ya los manda ordenados, esto no cambia nada.
  const sesiones = [...(carga.data.sesiones ?? [])].sort(
    (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
  );

  // El período elegido puede no tener ninguna sesión (un proceso que estuvo
  // en pausa y se mira a "3 meses"). No es un error ni un vacío del paciente:
  // es un período vacío, y se dice así.
  if (sesiones.length === 0) {
    return (
      <>
        <FlagsRiesgoTimeline riesgos={riesgos ?? []} />
        <p className="rounded-lg border border-dashed border-[color:var(--border-strong,#C2D4CB)] bg-cream-50 px-6 py-8 text-center text-[13px] text-ink-500">
          {RANGO_SIN_SESIONES}
        </p>
      </>
    );
  }

  const ultima = sesiones[sesiones.length - 1];

  return (
    <>
      <FlagsRiesgoTimeline riesgos={riesgos ?? []} />
      <IntensidadChart sesiones={sesiones} />
      <AlianzaChart sesiones={sesiones} />
      <TemasTable temas={temas ?? []} sesiones={sesiones} />
      <IntervencionesChart sesiones={sesiones} />
      <CardDeLaUltima
        rotulo={PROGRESO_PERCIBIDO}
        texto={ultima.progresoPercibido}
        sesionId={ultima.sesionId}
        fecha={fechaDe(ultima)}
        alerta={contieneTerminosDeterioro(ultima.progresoPercibido ?? "")}
      />
      <CardDeLaUltima
        rotulo={OBSERVACION_IA}
        texto={ultima.observacionIA}
        sesionId={ultima.sesionId}
        fecha={fechaDe(ultima)}
      />
    </>
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
          {REINTENTAR}
        </Button>
      </div>
    </Card>
  );
}

const EMPTY_STATE_TEXTOS = {
  "sin-sesiones": {
    titulo: SIN_SESIONES_TITULO,
    detalle: SIN_SESIONES_DETALLE,
  },
  "poco-recorrido": {
    titulo: POCO_RECORRIDO_TITULO,
    detalle: POCO_RECORRIDO_DETALLE,
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

// ────────────────────────────────────────────────────────────────────────────
// Progreso percibido y Observación IA: SIEMPRE de la última sesión del
// período, dicho con su fecha y con enlace a esa nota. Antes se buscaba
// "la última que tuviera texto", que mezclaba una lectura de hace ocho
// sesiones con un gráfico de hoy.
// ────────────────────────────────────────────────────────────────────────────

function CardDeLaUltima({
  rotulo,
  texto,
  sesionId,
  fecha,
  alerta = false,
}: {
  rotulo: string;
  texto: string | null;
  sesionId: string;
  fecha: Date;
  alerta?: boolean;
}) {
  const contenido = texto?.trim();
  if (!contenido) return null;

  return (
    <section
      className={
        alerta
          ? "rounded-lg border border-terracotta-100 border-l-2 border-l-terracotta-500 bg-terracotta-50/40 p-4 lg:p-5"
          : "rounded-lg border border-[color:var(--border-subtle)] border-l-2 border-l-sage-500 bg-cream-50 p-4 lg:p-5"
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          {rotulo} — última sesión del período
        </p>
        <Link
          href={`/sesiones/${sesionId}`}
          className="font-sans text-[12px] text-sage-600 underline-offset-2 hover:underline"
        >
          {VER_LA_SESION}
        </Link>
      </div>
      <p className="mt-2 font-[family-name:var(--font-display)] text-[17px] italic leading-[1.5] text-ink-900">
        «{contenido}»
      </p>
      <p className="mt-2 text-[11px] tabular-nums text-ink-500">
        {fecha.toLocaleDateString("es-UY", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      </p>
    </section>
  );
}
