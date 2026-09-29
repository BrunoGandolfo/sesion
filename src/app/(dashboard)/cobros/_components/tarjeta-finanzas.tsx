"use client";

// La entrada a Finanzas desde Cobros: una tarjeta tocable, arriba de la
// lista, que ya muestra un dato vivo —lo cobrado este mes y la variación
// contra el mes pasado— para que se entienda qué hay del otro lado.
//
// Pide su propio número (/api/finanzas/resumen del mes de hoy) y no depende
// de él: si falla, o si todavía no llegó, la tarjeta se ve igual, sin la
// cifra. Cobros nunca se rompe por esto.

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { ResumenFinanzas } from "@/app/api/_lib/casos-uso/finanzas";
import { apiGet, esAbort } from "@/lib/api-client";
import { mesIsoMvd } from "@/lib/fechas-montevideo";
import { money } from "@/lib/format";
import {
  COBRASTE_EN,
  CONTRA_MES,
  FINANZAS_DEL_CONSULTORIO,
  FINANZAS_TARJETA_SIN_DATO,
  MESES,
  SIN_CAMBIO,
  SIN_DATOS_CONTRA,
} from "@/lib/glosario";


interface Dato {
  mes: string;
  mesAnterior: string;
  cobrado: number;
  variacion: number | null;
  porcentaje: number | null;
}

function nombreMes(clave: string): string {
  return MESES[Number(clave.slice(5, 7)) - 1];
}

/** El mes anterior a una clave "AAAA-MM". */
function mesAnteriorDe(clave: string): string {
  const anio = Number(clave.slice(0, 4));
  const mes = Number(clave.slice(5, 7));
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, "0")}`;
}

/** Se lee sólo lo que la tarjeta usa, y se descarta una respuesta que no
 *  tenga esa forma: mejor sin número que con uno inventado. Los meses salen
 *  de la respuesta (el período que el servidor contó y el anterior contra
 *  el que comparó), no de una cuenta en el teléfono. */
function leer(respuesta: unknown): Dato | null {
  const r = respuesta as Partial<ResumenFinanzas> | null;
  const cobrado = r?.totales?.cobrado;
  const mes = r?.desde;
  if (typeof cobrado !== "number" || typeof mes !== "string") return null;
  const anterior = r?.comparaciones?.periodoAnterior ?? null;
  return {
    mes,
    // Sin comparación (el mes anterior no tuvo datos) igual hay que nombrarlo.
    mesAnterior: anterior?.desde ?? mesAnteriorDe(mes),
    cobrado,
    variacion: typeof anterior?.variacionCobrado === "number" ? anterior.variacionCobrado : null,
    porcentaje: typeof anterior?.porcentajeCobrado === "number" ? anterior.porcentajeCobrado : null,
  };
}

function variacionTexto(variacion: number, porcentaje: number | null): string {
  if (variacion === 0) return SIN_CAMBIO;
  const signo = variacion > 0 ? "+" : "−";
  const pesos = `${signo} ${money(Math.abs(variacion))}`;
  return porcentaje === null || porcentaje === 0 ? pesos : `${pesos} (${signo}${Math.abs(porcentaje)} %)`;
}

export function TarjetaFinanzas({ recarga = 0 }: { /** Cambia cuando Cobros vuelve a pedir sus datos. */ recarga?: number }) {
  const [dato, setDato] = React.useState<Dato | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    const mes = mesIsoMvd(new Date());
    apiGet<unknown>(`/api/finanzas/resumen?desde=${mes}&hasta=${mes}`, { signal: controller.signal })
      .then((respuesta) => setDato(leer(respuesta)))
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setDato(null);
      });
    return () => controller.abort();
  }, [recarga]);

  return (
    <Link
      href="/finanzas"
      className="group flex min-h-11 items-center gap-3 rounded-md border border-[color:var(--border-subtle)] bg-white px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:border-sage-300 lg:px-5 lg:py-4"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[16px] font-medium text-ink-900">
          {FINANZAS_DEL_CONSULTORIO}
        </span>
        {dato ? (
          <span className="mt-1 block text-[13px] leading-[1.5] text-ink-500">
            {COBRASTE_EN(nombreMes(dato.mes))}{" "}
            <span className="font-medium tabular-nums text-sage-700">{money(dato.cobrado)}</span>
            {" · "}
            {dato.variacion === null ? (
              SIN_DATOS_CONTRA(nombreMes(dato.mesAnterior))
            ) : (
              <>
                <span className="tabular-nums text-ink-700">{variacionTexto(dato.variacion, dato.porcentaje)}</span>{" "}
                {CONTRA_MES(nombreMes(dato.mesAnterior))}
              </>
            )}
          </span>
        ) : (
          <span className="mt-1 block text-[13px] leading-[1.5] text-ink-500">{FINANZAS_TARJETA_SIN_DATO}</span>
        )}
      </span>
      <ChevronRight size={18} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-ink-300 group-hover:text-ink-500" />
    </Link>
  );
}
