"use client";

import { AlertTriangle } from "lucide-react";

import { EvidenceItem } from "@/components/grabacion/FeedbackTerapeutaView";
import {
  LO_QUE_DIJO,
  REVISE_ESTA_SENAL,
  SENAL_DE_RIESGO,
} from "@/lib/glosario";
import type { FlagRiesgo } from "@/lib/sesion-clinica/schema";
import { normalizarRiesgo } from "@/types/domain";
import type { FlagsRiesgo, NivelRiesgo } from "@/types/domain";

// UN solo bloque de riesgo por nota.
//
// Antes eran dos: NotaClinicaView dibujaba a mano las casillas de los flags
// booleanos (flagsRiesgo) y este banner mostraba aparte la señal graduada
// (riesgoDetectado), con dos títulos distintos para lo mismo. Acá se
// absorben los dos: un título, una lista de "Lo que dijo" y todas las
// casillas obligatorias juntas.
//
// El contrato de riesgo clínico no cambia: la señal acompaña el juicio
// clínico, no lo reemplaza, y la casilla por señal es obligatoria antes de
// aprobar (la exige quien renderiza la barra de acciones, con
// clavesDeRiesgo).
//
// SIN MOVIMIENTO, Y ES A PROPÓSITO
//
// Este bloque no entra: estaba. Se dibuja con la nota, sin fundido, sin
// desplazamiento y sin retraso de cascada. Cero milisegundos.
//
// No es un olvido ni un delta pendiente: una señal de riesgo que "aparece"
// se convierte en un aviso de app —algo que la interfaz decidió mostrarle—,
// y esto es un dato clínico que estaba en la sesión antes de que se abriera
// la pantalla. Por el mismo motivo Lupita no pasa ni cerca
// (docs/diseno/04-personaje.md) y no hay nada acá que dependa de
// prefers-reduced-motion: con la preferencia puesta o sin ella, se ve igual.
//
// Si algún día alguien envuelve esta sección en Aparece o en una cascada,
// está rompiendo docs/diseno/03-plan-de-movimiento.md, D10.

/** Clave de la casilla de la señal graduada (riesgoDetectado). Las demás
 *  claves son las de FlagsRiesgo, que ya son únicas. */
export const CLAVE_RIESGO_GRADUADO = "riesgoGraduado";

const FLAGS_EN_ORDEN: readonly FlagRiesgo[] = [
  "ideacionSuicida",
  "autolesion",
  "violenciaTerceros",
  "sintomasPsicoticos",
  "crisisPanico",
];

/** Nombre clínico de cada flag. No se ablandan ni se agrupan. */
const NOMBRE_FLAG: Record<FlagRiesgo, string> = {
  ideacionSuicida: "Ideación suicida",
  autolesion: "Autolesión",
  violenciaTerceros: "Violencia hacia terceros",
  sintomasPsicoticos: "Síntomas psicóticos",
  crisisPanico: "Crisis de pánico",
};

const NOMBRE_NIVEL: Record<Exclude<NivelRiesgo, "ninguno">, string> = {
  bajo: "nivel bajo",
  moderado: "nivel moderado",
  alto: "nivel alto",
};

function flagsActivos(flags: FlagsRiesgo | null | undefined): FlagRiesgo[] {
  if (!flags) return [];
  return FLAGS_EN_ORDEN.filter((clave) => flags[clave]);
}

/**
 * Claves de las casillas que hay que marcar antes de aprobar: una por flag
 * activo, más la de la señal graduada si el nivel no es "ninguno". Es la
 * misma cuenta que hace el banner al dibujarlas, expuesta para que quien
 * habilita "Aprobar nota" no la vuelva a escribir.
 */
export function clavesDeRiesgo(
  riesgoDetectado: unknown,
  flagsRiesgo?: FlagsRiesgo | null,
): string[] {
  const claves: string[] = flagsActivos(flagsRiesgo);
  if (normalizarRiesgo(riesgoDetectado).nivel !== "ninguno") {
    claves.push(CLAVE_RIESGO_GRADUADO);
  }
  return claves;
}

interface RiesgoDetectadoBannerProps {
  /** Valor crudo de datosEstructurados.riesgoDetectado. Es unknown porque
   *  hay rutas de lectura que no validan shape (coerceDatosEstructurados,
   *  JSON.parse directo en historia-tab); la normalización del contrato
   *  ocurre acá adentro. */
  riesgoDetectado: unknown;
  /** Flags booleanos de la misma nota. Se absorben en este bloque. */
  flagsRiesgo?: FlagsRiesgo | null;
  /** Claves ya marcadas. Vive en quien controla el botón de aprobar: la
   *  casilla es un requisito de esa acción, no un estado del banner. */
  revisadas?: ReadonlySet<string>;
  onRevisar?: (clave: string, marcada: boolean) => void;
  /** Sin esto el banner es informativo y no dibuja casillas (nota aprobada,
   *  timeline, recorrido). */
  editable?: boolean;
}

/** Señal de riesgo clínico sobre la nota (ver docs/contrato-riesgo-clinico.md).
 *  Acompaña el juicio clínico, no lo reemplaza. Sin nivel graduado y sin
 *  flags activos no renderiza nada. */
export function RiesgoDetectadoBanner({
  riesgoDetectado,
  flagsRiesgo = null,
  revisadas,
  onRevisar,
  editable = false,
}: RiesgoDetectadoBannerProps) {
  const riesgo = normalizarRiesgo(riesgoDetectado);
  const { nivel, indicadores, evidencia, notaParaTerapeuta } = riesgo;
  const flags = flagsActivos(flagsRiesgo);

  if (nivel === "ninguno" && flags.length === 0) return null;

  const esAlto = nivel === "alto";
  const nota = notaParaTerapeuta?.trim();
  const detalleFlags = flagsRiesgo?.detalle?.trim();
  const conCasillas = editable && onRevisar !== undefined;

  const titulo =
    nivel === "ninguno"
      ? SENAL_DE_RIESGO
      : `${SENAL_DE_RIESGO} · ${NOMBRE_NIVEL[nivel]}`;

  const casilla = (clave: string, etiqueta: string) => (
    <label
      key={clave}
      className="flex items-start gap-3 rounded-md border border-terracotta-100 bg-white/80 px-3 py-3"
    >
      <input
        type="checkbox"
        checked={revisadas?.has(clave) ?? false}
        onChange={(evento) => onRevisar?.(clave, evento.target.checked)}
        className="mt-[3px] h-[18px] w-[18px] shrink-0 cursor-pointer accent-sage-500"
      />
      <span className="flex flex-1 flex-col gap-1">
        <span className="font-sans text-[15px] font-semibold leading-[1.5] text-ink-900">
          {etiqueta}
        </span>
        <span className="font-sans text-[13px] text-ink-500">
          {REVISE_ESTA_SENAL}
        </span>
      </span>
    </label>
  );

  return (
    <section
      role={esAlto || flags.length > 0 ? "alert" : "status"}
      aria-label={titulo}
      className={
        esAlto || flags.length > 0
          ? "rounded-lg border-2 border-terracotta-500 bg-terracotta-50/70 px-4 py-4 sm:px-5"
          : "rounded-lg border border-terracotta-100 border-l-4 border-l-terracotta-500 bg-terracotta-50/70 px-4 py-4 sm:px-5"
      }
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          size={20}
          strokeWidth={1.9}
          aria-hidden="true"
          className="mt-[2px] shrink-0 text-terracotta-500"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h2 className="font-display text-[18px] font-medium text-ink-900">
            {titulo}
          </h2>

          {flags.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {flags.map((clave) => (
                <li
                  key={clave}
                  className="font-sans text-[15px] font-semibold leading-[1.5] text-ink-900"
                >
                  {NOMBRE_FLAG[clave]}
                </li>
              ))}
            </ul>
          )}

          {indicadores.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {indicadores.map((indicador, indice) => (
                <li
                  key={`${indicador}-${indice}`}
                  className="font-sans text-[14px] leading-[1.6] text-ink-900"
                >
                  {indicador}
                </li>
              ))}
            </ul>
          )}

          {nota ? (
            <p className="font-sans text-[14px] leading-[1.65] text-ink-900">
              {nota}
            </p>
          ) : null}

          {(evidencia.length > 0 || detalleFlags) && (
            <div className="flex flex-col gap-2">
              <p className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-terracotta-500">
                {LO_QUE_DIJO}
              </p>
              {evidencia.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {evidencia.map((ev, indice) => (
                    <EvidenceItem
                      key={`${ev.timestamp}-${indice}`}
                      evidencia={ev}
                    />
                  ))}
                </ul>
              )}
              {detalleFlags ? (
                <p className="border-l-2 border-cream-200 pl-3 font-sans text-[13px] italic leading-[1.5] text-ink-700">
                  {detalleFlags}
                </p>
              ) : null}
            </div>
          )}

          {conCasillas && (
            <div className="flex flex-col gap-2">
              {flags.map((clave) => casilla(clave, NOMBRE_FLAG[clave]))}
              {nivel !== "ninguno"
                ? casilla(CLAVE_RIESGO_GRADUADO, titulo)
                : null}
            </div>
          )}

          <p className="font-sans text-[12px] italic leading-[1.5] text-ink-500">
            Detectado desde la transcripción — evaluá con tu criterio clínico.
          </p>
        </div>
      </div>
    </section>
  );
}
