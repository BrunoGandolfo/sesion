"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

// Bloque plegado, un solo patrón para la pantalla de sesión.
//
// Por qué existe: la nota tiene tres bloques que se pliegan ("Más de esta
// sesión", "Para vos", "Ver el borrador original") y cada uno se había
// escrito a mano, con su propio botón, su propio chevron y su propio
// aria-controls. Acá se escribe una vez.
//
// Dónde vive: el lugar natural sería src/components/ui/plegable.tsx, pero
// ese directorio no es editable por el agente que escribió esta pantalla.
// Vive en la ruta y lo importa también FeedbackTerapeutaView; mudarlo a ui/
// es mover el archivo y arreglar dos imports.

interface PlegableProps {
  /** Rótulo del bloque. Se dice como se llama: no se resume. */
  titulo: string;
  /** Línea de ayuda debajo del rótulo (la del glosario, cuando la hay). */
  ayuda?: string;
  /** Dato corto a la derecha del rótulo (ej. el nombre del instrumento). */
  detalle?: string;
  abiertoPorDefecto?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Plegable({
  titulo,
  ayuda,
  detalle,
  abiertoPorDefecto = false,
  children,
  className = "",
}: PlegableProps) {
  const [abierto, setAbierto] = React.useState(abiertoPorDefecto);
  const panelId = React.useId();

  return (
    <section
      className={`rounded-lg border border-[color:var(--border-subtle)] bg-white ${className}`}
    >
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={panelId}
        onClick={() => setAbierto((previo) => !previo)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-display text-[16px] font-medium text-ink-900">
            {titulo}
          </span>
          {ayuda ? (
            <span className="font-sans text-[13px] leading-[1.5] text-ink-500">
              {ayuda}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {detalle ? (
            <span className="hidden font-sans text-[12px] text-ink-500 sm:inline">
              {detalle}
            </span>
          ) : null}
          <ChevronDown
            size={18}
            strokeWidth={1.8}
            aria-hidden="true"
            className={`text-ink-500 transition-transform duration-150 ${
              abierto ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      {abierto ? (
        <div
          id={panelId}
          className="flex flex-col gap-5 border-t border-[color:var(--border-subtle)] px-5 py-5"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
