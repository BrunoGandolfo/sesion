"use client";

// Textos para integrar al glosario: docs/pendientes/movimiento.md.
export type EstadoCampo = "idle" | "pendiente" | "guardando" | "guardado" | "error";
export function GuardadoCampo({ estado }: { estado: EstadoCampo }) {
  if (estado === "idle") return null;
  const texto = { pendiente: "Sin guardar todavía.", guardando: "Guardando…", guardado: "Guardado.", error: "No se guardó. Revisá los campos y reintentá." }[estado];
  return <p role="status" className={"mt-2 text-[13px] leading-normal " + (estado === "error" ? "text-[color:var(--color-error)]" : "text-ink-500")}>{texto}</p>;
}
