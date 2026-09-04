"use client";

import * as React from "react";

import { Button } from "./button";

// Confirmación inline, un solo patrón para toda la app.
//
// Reemplaza a los tres que conviven hoy: el window.confirm del navegador
// (datos-tab al archivar, ConsentimientoBadge al revocar), el panel corto de
// turno-detail-sheet (de donde sale este componente) y el panel largo de
// NotaClinicaView al descartar una nota.
//
// Por qué inline y no un modal del navegador: window.confirm no se puede
// escribir en castellano rioplatense, no respeta la tipografía ni la paleta,
// y en Android aparece como un diálogo del sistema con el dominio arriba —
// justo lo que asusta a alguien que no quiere pensar en "la aplicación".
//
// El foco arranca en Cancelar a propósito: la acción destructiva nunca es la
// que responde a un Enter distraído.

export interface ConfirmarProps {
  /** Pregunta corta, en una línea. Ej: "¿Cancelar este turno?" */
  titulo: string;
  /** Qué va a pasar y qué se conserva. Una o dos frases, o un bloque propio
   *  cuando hace falta enumerar (descartar una nota). */
  mensaje?: React.ReactNode;
  /** Texto del botón que confirma. Nombra la acción, no dice "Sí".
   *  Ej: "Archivar", "Eliminar", "Descartar la nota". */
  accion: string;
  /** Texto del botón que cancela. */
  cancelar?: string;
  /** "peligro" para lo irreversible o lo que borra datos. */
  variante?: "peligro" | "normal";
  /** Deshabilita ambos botones y cambia el label mientras la acción corre. */
  enviando?: boolean;
  /** Label del botón de confirmar mientras `enviando` es true. */
  enviandoLabel?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
  className?: string;
}

export function Confirmar({
  titulo,
  mensaje,
  accion,
  cancelar = "Cancelar",
  variante = "normal",
  enviando = false,
  enviandoLabel,
  onConfirmar,
  onCancelar,
  className = "",
}: ConfirmarProps) {
  const cancelarRef = React.useRef<HTMLButtonElement>(null);
  const tituloId = React.useId();
  const mensajeId = React.useId();

  // El foco entra en Cancelar al montar: quien abrió esto está a un Enter de
  // una acción que no siempre se puede deshacer.
  React.useEffect(() => {
    cancelarRef.current?.focus();
  }, []);

  // Escape cancela, igual que en Sheet. Se registra en el propio panel y no
  // en document para no robarle el Escape al sheet que lo contiene.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || enviando) return;
    event.stopPropagation();
    onCancelar();
  };

  const esPeligro = variante === "peligro";

  const marco = esPeligro
    ? "border-terracotta-500/30 bg-terracotta-50"
    : "border-[color:var(--border-subtle)] bg-cream-100";

  const tituloColor = esPeligro ? "text-terracotta-600" : "text-ink-900";

  const confirmarClase = esPeligro
    ? "flex-1 !bg-terracotta-500 hover:!bg-terracotta-600 active:!bg-terracotta-600"
    : "flex-1";

  return (
    <div
      role="alertdialog"
      aria-labelledby={tituloId}
      aria-describedby={mensaje ? mensajeId : undefined}
      onKeyDown={onKeyDown}
      className={`rounded-md border px-4 py-4 ${marco} ${className}`}
    >
      <p
        id={tituloId}
        className={`font-sans text-[14px] font-semibold leading-[1.4] ${tituloColor}`}
      >
        {titulo}
      </p>

      {mensaje ? (
        <div
          id={mensajeId}
          className="mt-1 font-sans text-[13px] leading-[1.55] text-ink-700"
        >
          {mensaje}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row">
        <Button
          ref={cancelarRef}
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={onCancelar}
          disabled={enviando}
        >
          {cancelar}
        </Button>
        <Button
          type="button"
          variant="primary"
          className={confirmarClase}
          onClick={onConfirmar}
          disabled={enviando}
        >
          {enviando ? (enviandoLabel ?? accion) : accion}
        </Button>
      </div>
    </div>
  );
}
