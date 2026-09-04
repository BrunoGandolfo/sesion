"use client";

import { SENAL_DE_RIESGO } from "@/lib/glosario";

import { COLOR, type SesionProgreso } from "./base";

// ============================================
// 0. Señales de riesgo (timeline por sesión)
// ============================================
const FLAG_KEYS = [
  "ideacionSuicida",
  "autolesion",
  "violenciaTerceros",
  "sintomasPsicoticos",
  "crisisPanico",
] as const;

const FLAG_LABELS: Record<(typeof FLAG_KEYS)[number], string> = {
  ideacionSuicida: "Ideación suicida",
  autolesion: "Autolesión",
  violenciaTerceros: "Riesgo a terceros",
  sintomasPsicoticos: "Síntomas psicóticos",
  crisisPanico: "Crisis de pánico",
};

export function FlagsRiesgoTimeline({ sesiones }: { sesiones: SesionProgreso[] }) {
  const activeFlags = FLAG_KEYS.filter((key) =>
    sesiones.some((s) => s.flagsRiesgo?.[key] === true),
  );
  if (activeFlags.length === 0) return null;

  return (
    <section className="rounded-lg border border-terracotta-100 bg-terracotta-50/40 p-4 lg:p-5">
      <header className="mb-4 flex items-start gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-[3px] shrink-0 text-terracotta-500"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <div>
          <h3 className="font-[family-name:var(--font-display)] text-[18px] font-medium leading-tight tracking-[-0.01em] text-ink-900">
            {SENAL_DE_RIESGO}
          </h3>
          <p className="mt-1 text-[12px] leading-[1.4] text-ink-500">
            Sesiones donde la IA detectó señales de riesgo clínico. Permanecen
            visibles y nunca se ocultan silenciosamente.
          </p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] bg-terracotta-50/40 py-2 pr-3 text-left font-semibold uppercase tracking-[0.06em] text-[10px] text-ink-500">
                Señal
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
            {activeFlags.map((flag) => (
              <tr key={flag} className="border-t border-[color:var(--border-subtle)]">
                <td className="sticky left-0 z-[1] bg-terracotta-50/40 py-2 pr-3 text-ink-900">
                  {FLAG_LABELS[flag]}
                </td>
                {sesiones.map((s) => {
                  const present = s.flagsRiesgo?.[flag] === true;
                  return (
                    <td
                      key={s.numero}
                      className="px-1 py-2 text-center text-[16px] leading-none tabular-nums"
                      aria-label={
                        present
                          ? `${FLAG_LABELS[flag]} detectada en S${s.numero}`
                          : `Sin ${FLAG_LABELS[flag].toLowerCase()} en S${s.numero}`
                      }
                    >
                      <span style={{ color: present ? COLOR.terracotta : COLOR.inkSoft }}>
                        {present ? "🚩" : "○"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
