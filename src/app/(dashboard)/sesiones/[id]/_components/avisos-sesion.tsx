"use client";

// Los dos avisos de la pantalla de una sesión: el que queda después de
// aprobar y el de algo que falló (la carga o la nota que no se escribió).

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import type * as React from "react";

import { hrefDeVista } from "./selector-vista";
import { LEER_PARA_VOS, NOTA_APROBADA_AVISO } from "./textos";

/**
 * Lo que queda en la nota después de aprobar: que quedó guardada, y el
 * camino a "Para vos".
 *
 * Es una confirmación, no una celebración. Sin Lupita, sin check dibujado,
 * sin felicitación: la nota clínica no lleva personaje ni celebración
 * (docs/diseno/04-personaje.md), y esto está en la misma pantalla que el
 * bloque de riesgo. Verde salvia porque algo salió bien, y nada más.
 *
 * El enlace no se dibuja si no hay análisis: ofrecer una pantalla vacía
 * justo después de aprobar sería la peor primera impresión posible de la
 * mitad del producto que esta tanda vino a poner a la vista.
 */
export function AvisoAprobada({
  id,
  conParaVos,
}: {
  id: string;
  conParaVos: boolean;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sage-200 bg-sage-50 px-4 py-3"
    >
      <p className="font-sans text-[14px] leading-[1.5] text-ink-900">
        {NOTA_APROBADA_AVISO}
      </p>
      {conParaVos ? (
        <Link
          href={hrefDeVista(id, "para-vos")}
          className="inline-flex min-h-[44px] items-center font-sans text-[14px] font-semibold text-sage-600 transition-colors duration-[var(--duration-fast)] hover:text-sage-700"
        >
          {LEER_PARA_VOS}
        </Link>
      ) : null}
    </div>
  );
}

export function Aviso({
  titulo,
  detalle,
  children,
}: {
  titulo: string;
  detalle?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-terracotta-100 bg-terracotta-50 px-4 py-4"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          size={18}
          strokeWidth={1.9}
          aria-hidden="true"
          className="mt-[2px] shrink-0 text-terracotta-500"
        />
        <div className="flex flex-col gap-1">
          <p className="font-sans text-[15px] font-semibold text-ink-900">
            {titulo}
          </p>
          {detalle ? (
            <p className="font-sans text-[13px] leading-[1.55] text-ink-700">
              {detalle}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}
