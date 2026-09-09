"use client";

// Los tres números del día: deuda, sesiones y cobrado del mes.
//
// "Por cobrar" va primero y ocupa el ancho: es el único que pide hacer algo
// y el único que enlaza. Los otros dos son estado, no tarea, y comparten la
// fila de abajo. Antes eran tres columnas fijas de ~110 px en un teléfono de
// 390: "$ 45.3k" partía en dos líneas ("$" arriba, "45.3k" abajo) y los
// rótulos también ("SESIONES / HOY"). El bloque más "dato" de la pantalla
// era el peor compuesto.
//
// La cuenta de pacientes que deben sale de `pendientes.totalSinCobrar`, que
// es la misma fuente que dice el bloque de arriba y la que ordena "Te
// deben". Antes salía de `deudores.length`, que es una lista con tope 10:
// arriba decía 11 y acá 10.
//
// MOVIMIENTO (delta D5). Cuentan los dos que son cifras —"Por cobrar" y
// "Este mes"—, y cuentan en 360 ms, no en 600: lo que hace falta para leer
// "$ 12,4k" y ni un cuadro más. "Sesiones hoy" se escribe directo: es un
// dígito, y mientras sube no hay nada que leer, hay un número ilegible
// durante medio segundo.

import Link from "next/link";

import { Card } from "@/components/ui";
import { Contador } from "@/components/ui/movimiento";
import { fechaLarga, moneyShort } from "@/lib/format";
import { ESTE_MES, POR_COBRAR, SESIONES_HOY, pluralizar } from "@/lib/glosario";
import type { DashboardData } from "@/types/domain";

/** Segundos del conteo. El default del primitivo son 600 ms. */
const DURACION_CONTEO = 0.36;

export function Kpis({ ahora, data }: { ahora: Date; data: DashboardData }) {
  const mes = fechaLarga(ahora).split(" de ").at(-1) ?? "";
  const pagas = data.sesionesHoy.filter(
    (turno) => turno.pagoEstado === "pagado",
  ).length;

  const items = [
    {
      label: POR_COBRAR,
      valor: data.kpis.deudaAcumulada,
      formato: moneyShort,
      contar: true,
      pie: pluralizar(
        data.pendientes.totalSinCobrar.pacientes,
        "paciente",
        "pacientes",
      ),
      acento: data.kpis.deudaAcumulada > 0,
      href: "/cobros" as string | null,
      // Ancho completo en el teléfono: es el número que pide acción.
      clases: "col-span-2 lg:col-span-1 border-b lg:border-b-0 lg:border-r",
      tamano: "text-[30px]",
    },
    {
      label: SESIONES_HOY,
      valor: data.kpis.sesionesHoy,
      formato: (n: number) => String(n),
      contar: false,
      pie: pluralizar(pagas, "paga", "pagas"),
      acento: false,
      href: null as string | null,
      clases: "border-r",
      tamano: "text-[24px] lg:text-[30px]",
    },
    {
      label: ESTE_MES,
      valor: data.kpis.ingresosMes,
      formato: moneyShort,
      contar: true,
      pie: `cobrado ${mes}`,
      acento: false,
      href: null as string | null,
      clases: "",
      tamano: "text-[24px] lg:text-[30px]",
    },
  ];

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <div className="grid grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const clases = `min-w-0 border-[color:var(--border-subtle)] p-4 lg:p-5 ${item.clases}`;
          const numero = `mt-2 block font-[family-name:var(--font-display)] font-medium leading-none tabular-nums ${
            item.tamano
          } ${item.acento ? "text-terracotta-600" : "text-ink-900"}`;
          const cuerpo = (
            <>
              {/* 12 px, que es el piso que declara chip.tsx: a un brazo de
                  distancia, 10 px no se leen. */}
              <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                {item.label}
              </span>
              {item.contar ? (
                <Contador
                  valor={item.valor}
                  formato={item.formato}
                  duracion={DURACION_CONTEO}
                  className={numero}
                />
              ) : (
                <span className={numero}>{item.formato(item.valor)}</span>
              )}
              <span className="mt-1.5 block text-[12px] text-ink-500">
                {item.pie}
              </span>
            </>
          );
          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              className={`${clases} block transition-colors duration-150 hover:bg-cream-50`}
            >
              {cuerpo}
            </Link>
          ) : (
            <div key={item.label} className={clases}>
              {cuerpo}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
