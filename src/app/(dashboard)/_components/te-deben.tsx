// Los tres que más deben, con el monto. El resto está en Cobros.
//
// Es la ÚNICA lista de nombres de la deuda en esta pantalla, y los tres que
// muestra son los tres primeros de la fuente única (/api/dashboard →
// deudoresDeHoy, monto descendente, el mismo orden que la lista de Cobros).
// Antes era un `slice(0, 3)` sobre el orden crudo de la respuesta, y daba
// tres nombres distintos de los que decía el bloque de pendientes, para el
// mismo dato y en la misma pantalla.

import Link from "next/link";

import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import { NAV, TE_DEBEN } from "@/lib/glosario";
import type { DeudaPaciente } from "@/types/domain";

import { Titulo } from "./titulo";

/** Cuántos nombres entran. El resto vive en Cobros, que es la pantalla de
 *  la deuda: acá es un recordatorio, no la lista. */
const MAX_VISIBLES = 3;

export function TeDeben({ deudores }: { deudores: DeudaPaciente[] }) {
  return (
    <section>
      <Titulo
        accion={
          <Link
            href="/cobros"
            className="text-[13px] font-semibold text-sage-600 hover:text-sage-700"
          >
            {NAV.COBROS} →
          </Link>
        }
      >
        {TE_DEBEN}
      </Titulo>

      {deudores.length > 0 ? (
        <Card className="overflow-hidden rounded-[8px] p-0">
          <div className="divide-y divide-[color:var(--border-subtle)]">
            {deudores.slice(0, MAX_VISIBLES).map((deudor) => (
              <Link
                key={deudor.pacienteId}
                href={`/pacientes/${deudor.pacienteId}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-cream-50"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">
                  {deudor.nombre} {deudor.apellido}
                </span>
                <span className="font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-terracotta-600">
                  {money(deudor.montoTotal)}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="rounded-[8px] p-6 text-center text-[13px] text-ink-500">
          Nadie te debe. Día prolijo.
        </Card>
      )}
    </section>
  );
}
