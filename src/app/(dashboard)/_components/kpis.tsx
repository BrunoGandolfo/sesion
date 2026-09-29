"use client";

// Sesiones del día y cobrado del mes; la deuda vive en Pendientes.

import { Card } from "@/components/ui";
import { formatearMesMvd } from "@/lib/fechas-montevideo";
import { money } from "@/lib/format";
import { ESTE_MES, SESIONES_HOY, pluralizar } from "@/lib/glosario";
import type { DashboardData } from "@/types/domain";

export function Kpis({ ahora, data }: { ahora: Date; data: DashboardData }) {
  const pagas = data.sesionesHoy.filter(
    (turno) => turno.pagoEstado === "pagado",
  ).length;

  const items = [
    {
      label: SESIONES_HOY,
      valor: String(data.kpis.sesionesHoy),
      pie: pluralizar(pagas, "paga", "pagas"),
      clases: "border-r",
    },
    {
      label: ESTE_MES,
      valor: money(data.kpis.ingresosMes),
      pie: `cobrado ${formatearMesMvd(ahora)}`,
      clases: "",
    },
  ];

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <div className="grid grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className={`min-w-0 border-[color:var(--border-subtle)] p-4 lg:p-5 ${item.clases}`}
          >
            {/* 12 px, que es el piso que declara chip.tsx: a un brazo de
                distancia, 10 px no se leen. */}
            <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              {item.label}
            </span>
            <span className="mt-2 block text-[24px] font-medium leading-none tabular-nums text-ink-900 lg:text-[30px]">
              {item.valor}
            </span>
            <span className="mt-1.5 block text-[12px] text-ink-500">
              {item.pie}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
