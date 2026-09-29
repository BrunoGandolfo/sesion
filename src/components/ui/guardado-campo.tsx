"use client";

import { CAMPO_GUARDADO, CAMPO_NO_SE_GUARDO, CAMPO_SIN_GUARDAR, GUARDANDO } from "@/lib/glosario";

export type EstadoCampo = "idle" | "pendiente" | "guardando" | "guardado" | "error";
export function GuardadoCampo({ estado }: { estado: EstadoCampo }) {
  if (estado === "idle") return null;
  const texto = { pendiente: CAMPO_SIN_GUARDAR, guardando: GUARDANDO, guardado: CAMPO_GUARDADO, error: CAMPO_NO_SE_GUARDO }[estado];
  return <p role="status" className={"mt-2 text-[13px] leading-normal " + (estado === "error" ? "text-[color:var(--color-error)]" : "text-ink-500")}>{texto}</p>;
}
