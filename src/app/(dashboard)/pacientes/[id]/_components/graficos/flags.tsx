"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Chip } from "@/components/ui";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { fechaCompleta } from "@/lib/format";
import { LO_QUE_DIJO, SENAL_DE_RIESGO, pluralizar } from "@/lib/glosario";

import type { RiesgoProgreso } from "./base";
import { SUBTITULO_SENALES, VER_LA_SESION } from "./textos";

// Línea de tiempo de señales de riesgo.
//
// Antes era una matriz señal × sesión con banderitas y círculos vacíos: con
// 40 columnas, una señal de la sesión 9 quedaba fuera de la pantalla, sin
// fecha y sin la cita que la sostiene. Ahora cada señal es una fila con su
// fecha completa, su nivel y la cita literal a un toque.
//
// La sección NUNCA se pliega y la lista NUNCA se recorta: se muestran todas
// las señales del período, más reciente primero.

export function FlagsRiesgoTimeline({ riesgos }: { riesgos: RiesgoProgreso[] }) {
  const ordenados = React.useMemo(
    () =>
      [...riesgos].sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
      ),
    [riesgos],
  );

  if (ordenados.length === 0) return null;

  return (
    <section className="rounded-lg border border-terracotta-100 bg-terracotta-50/40 p-4 lg:p-5">
      <header className="mb-4 flex items-start gap-2">
        <AlertTriangle
          size={18}
          strokeWidth={1.9}
          aria-hidden="true"
          className="mt-[3px] shrink-0 text-terracotta-500"
        />
        <div>
          <h3 className="font-[family-name:var(--font-display)] text-[18px] font-medium leading-tight tracking-[-0.01em] text-ink-900">
            {SENAL_DE_RIESGO} ·{" "}
            {pluralizar(ordenados.length, "señal", "señales")}
          </h3>
          <p className="mt-1 text-[12px] leading-[1.4] text-ink-500">
            {SUBTITULO_SENALES}
          </p>
        </div>
      </header>

      <ol className="flex flex-col gap-2">
        {ordenados.map((riesgo, indice) => (
          <FilaSenal
            key={`${riesgo.sesionId}-${riesgo.flag}-${indice}`}
            riesgo={riesgo}
          />
        ))}
      </ol>
    </section>
  );
}

function FilaSenal({ riesgo }: { riesgo: RiesgoProgreso }) {
  const [citaAbierta, setCitaAbierta] = React.useState(false);
  const citaId = React.useId();
  const fecha = new Date(riesgo.fecha);
  const cita = riesgo.cita?.trim();

  return (
    <li className="rounded-md border border-terracotta-100 bg-white/70 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-sans text-[13px] font-semibold tabular-nums text-ink-900">
          {Number.isNaN(fecha.getTime())
            ? riesgo.fecha.slice(0, 10)
            : fechaCompleta(fecha)}
        </span>
        <Chip variant="terracotta" size="sm">
          {formatearEtiqueta(riesgo.flag)}
        </Chip>
        {riesgo.nivel && riesgo.nivel !== "ninguno" ? (
          <span className="font-sans text-[12px] text-terracotta-600">
            nivel {riesgo.nivel}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {cita ? (
          <button
            type="button"
            aria-expanded={citaAbierta}
            aria-controls={citaId}
            onClick={() => setCitaAbierta((abierta) => !abierta)}
            className="font-sans text-[12px] font-semibold text-ink-500 underline-offset-2 hover:text-ink-700 hover:underline"
          >
            {LO_QUE_DIJO}
          </button>
        ) : null}
        <Link
          href={`/sesiones/${riesgo.sesionId}`}
          className="font-sans text-[12px] text-sage-600 underline-offset-2 hover:underline"
        >
          {VER_LA_SESION}
        </Link>
      </div>

      {cita && citaAbierta ? (
        <p
          id={citaId}
          className="mt-2 border-l-2 border-terracotta-100 pl-3 font-sans text-[13px] italic leading-[1.6] text-ink-900"
        >
          “{cita}”
        </p>
      ) : null}
    </li>
  );
}
