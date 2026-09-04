"use client";

import * as React from "react";

import { Chip } from "@/components/ui";
import type {
  AlianzaTerapeutica,
  DatosEstructurados,
  TipoIntervencion,
} from "@/lib/sesion-clinica/schema";

import { Plegable } from "./plegable";
import {
  ALIANZA_TERAPEUTICA,
  APARECIO_POR_PRIMERA_VEZ,
  EMOCIONES,
  INTENSIDAD_EMOCIONAL,
  INTERVENCIONES,
  MAS_DE_ESTA_SESION,
  PARA_LA_PROXIMA,
  SE_LLEVO,
  TEMAS,
  VUELVE_A_APARECER,
} from "./textos";

// Todo lo que devolvió el análisis y no es la nota. Va plegado: la nota es
// lo que ella vino a leer; esto es material de consulta.
//
// Nada se resume ni se recorta acá: si la API mandó ocho temas, se muestran
// los ocho. Los bloques vacíos no se dibujan.

// Los nombres técnicos de las intervenciones no se ablandan: son las
// palabras con las que ella piensa su trabajo.
const NOMBRE_INTERVENCION: Record<TipoIntervencion, string> = {
  reformulacion: "Reformulación",
  senalamiento: "Señalamiento",
  confrontacion: "Confrontación",
  interpretacion: "Interpretación",
  pregunta_circular: "Pregunta circular",
  validacion: "Validación",
  silencio_terapeutico: "Silencio terapéutico",
  otra: "Otra",
};

const NOMBRE_ALIANZA: Record<AlianzaTerapeutica, string> = {
  fragil: "Frágil",
  inestable: "Inestable",
  estable: "Estable",
  fuerte: "Fuerte",
};

const TONO_ALIANZA: Record<
  AlianzaTerapeutica,
  "sage" | "gold" | "terracotta" | "neutral"
> = {
  fragil: "terracotta",
  inestable: "gold",
  estable: "neutral",
  fuerte: "sage",
};

function colorIntensidad(intensidad: number): string {
  if (intensidad <= 3) return "var(--color-sage-500)";
  if (intensidad <= 6) return "var(--color-gold-500)";
  return "var(--color-terracotta-500)";
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
      {children}
    </span>
  );
}

function ListaChips({
  rotulo,
  valores,
  variante = "neutral",
}: {
  rotulo: string;
  valores: readonly string[] | undefined;
  variante?: "neutral" | "sage";
}) {
  if (!valores || valores.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <Rotulo>{rotulo}</Rotulo>
      <div className="flex flex-wrap gap-1.5">
        {valores.map((valor, indice) => (
          <Chip key={`${valor}-${indice}`} variant={variante}>
            {valor}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function MasDeEstaSesion({
  datos,
}: {
  datos: DatosEstructurados | null;
}) {
  if (!datos) return null;

  const intervenciones = datos.intervenciones ?? [];
  const seLlevo = datos.compromisos ?? [];
  const intensidad = datos.intensidadEmocional;
  const alianza = datos.alianzaTerapeutica;

  const hayAlgo =
    (datos.temas?.length ?? 0) > 0 ||
    (datos.emocionesPaciente?.length ?? 0) > 0 ||
    intervenciones.length > 0 ||
    (datos.materialNuevo?.length ?? 0) > 0 ||
    (datos.materialRecurrente?.length ?? 0) > 0 ||
    seLlevo.length > 0 ||
    intensidad !== undefined ||
    alianza !== undefined ||
    Boolean(datos.focoProximaSesion);

  if (!hayAlgo) return null;

  return (
    <Plegable titulo={MAS_DE_ESTA_SESION}>
      <ListaChips rotulo={TEMAS} valores={datos.temas} />
      <ListaChips
        rotulo={EMOCIONES}
        valores={datos.emocionesPaciente}
        variante="sage"
      />

      {intervenciones.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Rotulo>{INTERVENCIONES}</Rotulo>
          <ul className="flex flex-col gap-3">
            {intervenciones.map((intervencion, indice) => (
              <li
                key={`${intervencion.tipo}-${indice}`}
                className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip variant="neutral">
                    {NOMBRE_INTERVENCION[intervencion.tipo]}
                  </Chip>
                  {intervencion.timestampAprox ? (
                    <span className="font-mono text-[12px] tabular-nums text-ink-500">
                      {intervencion.timestampAprox}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-sans text-[14px] leading-[1.6] text-ink-900">
                  {intervencion.descripcion}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ListaChips
        rotulo={APARECIO_POR_PRIMERA_VEZ}
        valores={datos.materialNuevo}
        variante="sage"
      />
      <ListaChips
        rotulo={VUELVE_A_APARECER}
        valores={datos.materialRecurrente}
      />

      {seLlevo.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Rotulo>{SE_LLEVO}</Rotulo>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {seLlevo.map((compromiso, indice) => (
              <li
                key={`${compromiso}-${indice}`}
                className="font-sans text-[14px] leading-[1.6] text-ink-900"
              >
                {compromiso}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {intensidad !== undefined ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <Rotulo>{INTENSIDAD_EMOCIONAL}</Rotulo>
            <span className="font-display text-[14px] font-medium text-ink-900">
              {intensidad}
              <span className="text-ink-500"> / 10</span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={10}
            aria-valuenow={intensidad}
            aria-label={INTENSIDAD_EMOCIONAL}
            className="h-2 w-full overflow-hidden rounded-full bg-cream-100"
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, intensidad * 10))}%`,
                backgroundColor: colorIntensidad(intensidad),
              }}
            />
          </div>
        </div>
      ) : null}

      {alianza !== undefined ? (
        <div className="flex flex-col gap-2">
          <Rotulo>{ALIANZA_TERAPEUTICA}</Rotulo>
          <div>
            <Chip variant={TONO_ALIANZA[alianza]}>
              {NOMBRE_ALIANZA[alianza]}
            </Chip>
          </div>
        </div>
      ) : null}

      {datos.focoProximaSesion ? (
        <div className="rounded-md bg-cream-100 px-4 py-4">
          <Rotulo>{PARA_LA_PROXIMA}</Rotulo>
          <p className="mt-2 font-sans text-[14px] leading-[1.6] text-ink-900">
            {datos.focoProximaSesion}
          </p>
        </div>
      ) : null}
    </Plegable>
  );
}
