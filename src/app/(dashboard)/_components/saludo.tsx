// El encabezado de Hoy: el saludo, el día en grande y cuántas sesiones hay.
//
// El engranaje al lado del nombre es el único acceso a "Tu consultorio" en
// mobile, donde no hay sidebar: antes había que saber que el nombre propio
// era un enlace. El nombre sigue siendo enlace; el ícono lo hace visible.

import Link from "next/link";
import { Settings } from "lucide-react";

import { EditorialRule } from "@/components/ui";
import { diaSemana, fechaCorta, fechaLarga, saludo } from "@/lib/format";
import { TU_CONSULTORIO, pluralizar } from "@/lib/glosario";

export function Saludo({
  ahora,
  nombre,
  sesiones,
}: {
  ahora: Date;
  nombre: string | null;
  sesiones: number;
}) {
  const [dia, mes] = fechaCorta(ahora).split(" ");

  return (
    <section aria-label={fechaLarga(ahora)} className="min-w-0">
      <div className="flex items-center gap-1 text-[13px] font-medium text-ink-500">
        <span className="flex min-w-0 items-center">
          <EditorialRule />
          <span>
            {saludo(ahora)}
            {nombre ? ", " : ""}
            {nombre ? (
              <Link
                href="/config"
                title={TU_CONSULTORIO}
                className="font-semibold text-ink-900 underline decoration-sage-300 underline-offset-4 hover:decoration-sage-500"
              >
                {nombre}
              </Link>
            ) : (
              <Link
                href="/config"
                className="ml-2 font-semibold text-sage-600 hover:text-sage-700"
              >
                {TU_CONSULTORIO}
              </Link>
            )}
          </span>
        </span>

        <Link
          href="/config"
          aria-label={TU_CONSULTORIO}
          title={TU_CONSULTORIO}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors duration-150 hover:bg-cream-100 hover:text-ink-900"
        >
          <Settings size={15} strokeWidth={1.7} aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-[52px] font-medium italic leading-[0.92] tracking-[-0.03em] text-ink-900 lg:text-[80px]">
          {diaSemana(ahora)}
        </h1>
        <span className="font-[family-name:var(--font-display)] text-[22px] font-medium leading-none text-ink-900 lg:text-[30px]">
          {dia} {mes}
        </span>
      </div>

      <p className="mt-2 text-[13px] text-ink-500">
        {sesiones > 0
          ? pluralizar(sesiones, "sesión en el día", "sesiones en el día")
          : "sin sesiones agendadas"}
      </p>
    </section>
  );
}
