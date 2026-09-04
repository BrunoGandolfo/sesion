"use client";

import { lecturaTemas, topTemas } from "../progreso-lecturas";
import { COLOR, ChartCard, type SesionProgreso } from "./base";

// ============================================
// 3. Temas recurrentes (Tabla)
// ============================================
export function TemasTable({ sesiones }: { sesiones: SesionProgreso[] }) {
  const temasPorSesion = sesiones.map((s) => s.temas ?? []);
  const ordenados = topTemas(temasPorSesion, Infinity);

  if (ordenados.length === 0) {
    return (
      <ChartCard
        title="Temas recurrentes"
        subtitle="Qué temas se repiten a lo largo del recorrido."
      >
        <p className="py-6 text-center text-[13px] text-ink-500">
          Aún no hay temas registrados.
        </p>
      </ChartCard>
    );
  }

  const lectura = lecturaTemas(temasPorSesion);
  const top = ordenados.slice(0, 5);
  const totalSesiones = sesiones.length;

  return (
    <ChartCard
      title="Temas recurrentes"
      subtitle="Qué temas se repiten a lo largo del recorrido."
      lectura={lectura}
    >
      <ul>
        {top.map((t) => (
          <li
            key={t.tema}
            className="flex items-baseline justify-between gap-3 border-t border-[color:var(--border-subtle)] py-2 first:border-t-0"
          >
            <span className="text-[13px] capitalize text-ink-900">{t.tema}</span>
            <span className="text-[12px] tabular-nums text-ink-500">
              {t.apariciones} de {totalSesiones}{" "}
              {totalSesiones === 1 ? "sesión" : "sesiones"}
            </span>
          </li>
        ))}
      </ul>

      <details className="mt-4">
        <summary className="cursor-pointer text-[12px] font-medium text-sage-500">
          Ver detalle por sesión
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-white py-2 pr-3 text-left font-semibold uppercase tracking-[0.06em] text-[10px] text-ink-500">
                  Tema
                </th>
                {sesiones.map((s) => (
                  <th
                    key={s.numero}
                    className="px-1 py-2 text-center font-semibold uppercase tracking-[0.06em] text-[10px] text-ink-500"
                  >
                    S{s.numero}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenados.map(({ tema }) => (
                <tr key={tema} className="border-t border-[color:var(--border-subtle)]">
                  <td className="sticky left-0 z-[1] bg-white py-2 pr-3 text-ink-900 capitalize">
                    {tema}
                  </td>
                  {sesiones.map((s) => {
                    const present = (s.temas ?? []).includes(tema);
                    return (
                      <td
                        key={s.numero}
                        className="px-1 py-2 text-center text-[16px] leading-none tabular-nums"
                        aria-label={
                          present
                            ? `${tema} apareció en S${s.numero}`
                            : `${tema} no apareció en S${s.numero}`
                        }
                      >
                        <span style={{ color: present ? COLOR.sage : COLOR.inkSoft }}>
                          {present ? "●" : "○"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </ChartCard>
  );
}
