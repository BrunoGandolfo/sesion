"use client";

// Los bloques de números de Finanzas. Cada uno dibuja una parte de la
// respuesta tal como vino: acá no se suma, no se divide ni se compara nada
// (docs/contrato-finanzas.md). Cuando el servidor dice `null`, la pantalla lo
// dice con palabras —"Sin datos para comparar", "—"— y nunca con un cero.

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { ResumenFinanzas } from "@/app/api/_lib/casos-uso/finanzas";
import { money } from "@/lib/format";
import {
  AUSENCIAS_Y_CANCELADAS,
  COBRADO_Y_FALTA,
  COMO_TE_PAGAN,
  CONTRA_ANIO_PASADO,
  CONTRA_ANTERIOR,
  DE_CADA_DIEZ,
  LO_QUE_ENTRO,
  LO_QUE_TRABAJASTE,
  METODO_PAGO_LABEL,
  NOTA_FINANZAS,
  NO_DISTE_SESIONES,
  PACIENTES_DISTINTAS,
  PACIENTES_EN_DOS_TRAMOS,
  SESIONES_REALIZADAS,
  SIN_CAMBIO,
  SIN_COBROS_EN_EL_PERIODO,
  SIN_DATOS_PARA_COMPARAR,
  SIN_METODO,
  TARIFA_PROMEDIO,
  TE_DEBEN_HOY,
  TRAMOS_DEUDA,
  VER_A_QUIENES,
  VER_A_QUIENES_EN_COBROS,
  pluralizar,
} from "@/lib/glosario";

import { nombreRango } from "./periodo";

type Comparacion = NonNullable<ResumenFinanzas["comparaciones"]["periodoAnterior"]>;
type Metodo = ResumenFinanzas["totales"]["cobradoPorMetodo"][number]["metodo"];

/** El contenedor de cada bloque: borde, sin sombra. */
export function Bloque({
  titulo,
  children,
  className = "",
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className={`min-w-0 rounded-md border border-[color:var(--border-subtle)] bg-white p-5 lg:p-6 ${className}`}
    >
      <h2 id={id} className="font-display text-[18px] font-medium leading-tight text-ink-900">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** "+ $ 3.900" / "− $ 1.200" / "Igual". */
function variacionEnPesos(variacion: number): string {
  if (variacion === 0) return SIN_CAMBIO;
  return `${variacion > 0 ? "+" : "−"} ${money(Math.abs(variacion))}`;
}

/** "+325 %" / "−12 %". `null` cuando aquel período fue cero: no hay "creció
 *  infinito por ciento", y la línea queda sólo con los pesos. */
function variacionEnPorcentaje(porcentaje: number | null): string | null {
  if (porcentaje === null || porcentaje === 0) return null;
  return `${porcentaje > 0 ? "+" : "−"}${Math.abs(porcentaje)} %`;
}

// ============================================
// Lo que entró: COBRADO del período, grande, y las dos comparaciones.
// ============================================
export function LoQueEntro({ datos }: { datos: ResumenFinanzas }) {
  const { totales, comparaciones } = datos;
  const unMes = datos.desde === datos.hasta;
  return (
    <Bloque titulo={LO_QUE_ENTRO}>
      <p className="mt-1 text-[12px] text-ink-500">{nombreRango(datos.desde, datos.hasta)}</p>
      <p data-dato="cobrado" className="mt-3 text-[30px] font-medium leading-none tabular-nums text-sage-700">
        {money(totales.cobrado)}
      </p>
      <p className="mt-2 text-[13px] text-ink-500">
        {pluralizar(totales.sesionesCobradas, "sesión cobrada", "sesiones cobradas")}
      </p>
      <dl className="mt-4 flex flex-col divide-y divide-[color:var(--border-subtle)] border-t border-[color:var(--border-subtle)]">
        <LineaComparacion rotulo={CONTRA_ANTERIOR(unMes)} comparacion={comparaciones.periodoAnterior} />
        <LineaComparacion rotulo={CONTRA_ANIO_PASADO(unMes)} comparacion={comparaciones.mismoPeriodoAnioAnterior} />
      </dl>
    </Bloque>
  );
}

function LineaComparacion({
  rotulo,
  comparacion,
}: {
  rotulo: string;
  comparacion: Comparacion | null;
}) {
  const porcentaje = comparacion ? variacionEnPorcentaje(comparacion.porcentajeCobrado) : null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-[13px] text-ink-700">
        {rotulo}
        {comparacion ? (
          <span className="block text-[12px] text-ink-500">
            {nombreRango(comparacion.desde, comparacion.hasta)}: {money(comparacion.cobrado)}
          </span>
        ) : null}
      </dt>
      <dd className="text-[14px] font-medium tabular-nums text-ink-900">
        {comparacion ? (
          <>
            {variacionEnPesos(comparacion.variacionCobrado)}
            {porcentaje ? <span className="ml-2 text-ink-500">{porcentaje}</span> : null}
          </>
        ) : (
          <span className="font-normal text-ink-500">{SIN_DATOS_PARA_COMPARAR}</span>
        )}
      </dd>
    </div>
  );
}

// ============================================
// Lo que trabajaste: TRABAJADO, tres números, la frase de cada diez y,
// aparte, ausencias y canceladas.
// ============================================
export function LoQueTrabajaste({ datos }: { datos: ResumenFinanzas }) {
  const { totales, proporcionCobrada } = datos;
  const cifras = [
    { rotulo: SESIONES_REALIZADAS, valor: String(totales.sesionesRealizadas) },
    { rotulo: PACIENTES_DISTINTAS, valor: String(totales.pacientesDistintas) },
    {
      rotulo: TARIFA_PROMEDIO,
      valor: totales.tarifaPromedio === null ? "—" : money(totales.tarifaPromedio),
    },
  ];
  return (
    <Bloque titulo={LO_QUE_TRABAJASTE}>
      <p className="mt-1 text-[12px] text-ink-500">{nombreRango(datos.desde, datos.hasta)}</p>
      <p data-dato="trabajado" className="mt-3 text-[22px] font-medium leading-none tabular-nums text-ink-900">
        {money(totales.trabajado)}
      </p>
      {totales.sesionesRealizadas > 0 ? (
        <p className="mt-2 text-[13px] text-ink-500">
          {COBRADO_Y_FALTA(money(totales.trabajadoCobrado), money(totales.trabajadoSinCobrar))}
        </p>
      ) : null}
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[color:var(--border-subtle)] pt-4">
        {cifras.map(({ rotulo, valor }) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">{rotulo}</dt>
            <dd className="mt-1 text-[16px] font-medium tabular-nums text-ink-900">{valor}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[14px] leading-[1.5] text-ink-700">
        {proporcionCobrada.deCadaDiez === null
          ? NO_DISTE_SESIONES
          : DE_CADA_DIEZ(proporcionCobrada.deCadaDiez)}
      </p>
      <p className="mt-2 text-[13px] leading-[1.5] text-ink-500">
        {AUSENCIAS_Y_CANCELADAS(totales.ausencias, money(totales.ausenciasMonto), totales.canceladas)}
      </p>
    </Bloque>
  );
}

// ============================================
// Te deben hoy: la deuda vigente, no la del período. Tres tramos siempre.
// ============================================
export function TeDebenHoy({ deuda }: { deuda: ResumenFinanzas["deudaHoy"] }) {
  return (
    <Bloque titulo={TE_DEBEN_HOY}>
      <p className="mt-3 flex items-baseline gap-2">
        <span
          className={`text-[22px] font-medium leading-none tabular-nums ${deuda.monto > 0 ? "text-terracotta-600" : "text-ink-900"}`}
        >
          {money(deuda.monto)}
        </span>
        <span className="text-[13px] text-ink-500">
          {pluralizar(deuda.sesiones, "sesión", "sesiones")}
        </span>
      </p>
      <ul className="mt-4 divide-y divide-[color:var(--border-subtle)] border-t border-[color:var(--border-subtle)]">
        {deuda.tramos.map((t) => (
          <li key={t.tramo} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-3">
            <span className="text-[14px] text-ink-900">{TRAMOS_DEUDA[t.tramo]}</span>
            <span
              className={`text-[14px] font-medium tabular-nums ${t.monto > 0 ? "text-terracotta-600" : "text-ink-500"}`}
            >
              {money(t.monto)}
            </span>
            <span className="col-span-2 text-[12px] text-ink-500">
              {pluralizar(t.sesiones, "sesión", "sesiones")} · {pluralizar(t.pacientes, "paciente", "pacientes")}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-ink-500">{PACIENTES_EN_DOS_TRAMOS}</p>
      <Link
        href="/cobros"
        aria-label={VER_A_QUIENES_EN_COBROS}
        className="mt-3 inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-sage-600"
      >
        {VER_A_QUIENES}
        <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
      </Link>
    </Bloque>
  );
}

// ============================================
// Cómo te pagan: los métodos de lo que entró, de mayor a menor, con una
// barra de proporción. La suma es siempre lo cobrado.
// ============================================
function nombreMetodo(metodo: Metodo): string {
  return metodo === "sin_metodo" ? SIN_METODO : METODO_PAGO_LABEL[metodo];
}

export function ComoTePagan({ totales }: { totales: ResumenFinanzas["totales"] }) {
  const { cobradoPorMetodo, cobrado } = totales;
  return (
    <Bloque titulo={COMO_TE_PAGAN}>
      {cobradoPorMetodo.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-500">{SIN_COBROS_EN_EL_PERIODO}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {cobradoPorMetodo.map((m) => (
            <li key={m.metodo} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1">
              <span className="text-[14px] text-ink-900">
                {nombreMetodo(m.metodo)}
                <span className="ml-2 text-[12px] text-ink-500">
                  {pluralizar(m.sesiones, "sesión", "sesiones")}
                </span>
              </span>
              <span className="text-[14px] font-medium tabular-nums text-ink-900">{money(m.monto)}</span>
              <span aria-hidden="true" className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-cream-100">
                <span
                  className="block h-full rounded-full bg-sage-500"
                  style={{ width: `${cobrado > 0 ? (m.monto / cobrado) * 100 : 0}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Bloque>
  );
}

export function NotaAlPie() {
  return <p className="text-[12px] leading-[1.5] text-ink-500">{NOTA_FINANZAS}</p>;
}
