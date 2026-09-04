// Los tres números del día: sesiones, deuda y cobrado del mes.
//
// "Por cobrar" es el único que enlaza: es el que pide hacer algo. Los otros
// dos son estado, no tarea.

import Link from "next/link";

import { Card } from "@/components/ui";
import { fechaLarga, moneyShort } from "@/lib/format";
import { ESTE_MES, POR_COBRAR, SESIONES_HOY, pluralizar } from "@/lib/glosario";
import type { DashboardData } from "@/app/api/_lib/domain";

export function Kpis({ ahora, data }: { ahora: Date; data: DashboardData }) {
  const mes = fechaLarga(ahora).split(" de ").at(-1) ?? "";
  const pagas = data.sesionesHoy.filter(
    (turno) => turno.pagoEstado === "pagado",
  ).length;

  const items = [
    {
      label: SESIONES_HOY,
      valor: data.kpis.sesionesHoy,
      pie: pluralizar(pagas, "paga", "pagas"),
      acento: false,
      href: null as string | null,
    },
    {
      label: POR_COBRAR,
      valor: moneyShort(data.kpis.deudaAcumulada),
      pie: pluralizar(data.deudores.length, "paciente", "pacientes"),
      acento: data.kpis.deudaAcumulada > 0,
      href: "/cobros",
    },
    {
      label: ESTE_MES,
      valor: moneyShort(data.kpis.ingresosMes),
      pie: `cobrado ${mes}`,
      acento: false,
      href: null as string | null,
    },
  ];

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <div className="grid grid-cols-3">
        {items.map((item, i) => {
          const clases = `min-w-0 p-4 lg:p-5 ${
            i < 2 ? "border-r border-[color:var(--border-subtle)]" : ""
          }`;
          const cuerpo = (
            <>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                {item.label}
              </span>
              <span
                className={`mt-2 block font-[family-name:var(--font-display)] text-[26px] font-medium leading-none tabular-nums lg:text-[30px] ${
                  item.acento ? "text-terracotta-600" : "text-ink-900"
                }`}
              >
                {item.valor}
              </span>
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
