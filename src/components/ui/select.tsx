"use client";

import { useId, type SelectHTMLAttributes } from "react";

/** Mismo campo, etiqueta y foco que Input/Textarea, con selección nativa. */
export function Select({ label, id, className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const generado = useId();
  const campoId = id ?? generado;
  return <div className="flex flex-col gap-2">
    <label htmlFor={campoId} className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500">{label}</label>
    <select id={campoId} className={`min-h-11 w-full rounded-sm border border-[color:var(--border-control)] bg-cream-50 px-[14px] py-[10px] text-[15px] text-ink-900 transition-colors duration-[var(--duration-fast)] focus:border-sage-500 focus:bg-white focus:ring-[3px] focus:ring-sage-500/20 ${className}`} {...props}>{children}</select>
  </div>;
}
