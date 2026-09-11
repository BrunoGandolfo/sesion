"use client";

// Sesiones del día y cobrado del mes; la deuda vive en Pendientes.

import Link from "next/link";

import { Card } from "@/components/ui";
import { Contador } from "@/components/ui/movimiento";
import { fechaLarga, moneyShort } from "@/lib/format";
import { ESTE_MES, SESIONES_HOY, pluralizar } from "@/lib/glosario";
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
      <div className="grid grid-cols-2">
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
