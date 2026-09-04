"use client";

import * as React from "react";

import { Button } from "@/components/ui";

import { EDITAR } from "./textos";

// Una sección de la nota SOAP. La nota sigue siendo SOAP y la sección sigue
// llamándose como se llama: el título y la letra vienen del glosario, y
// debajo va su línea de ayuda.
//
// Editar es tocar el texto. El botón "Editar" está siempre visible al lado
// del título porque el toque no existe para quien navega con teclado o con
// lector de pantalla, y porque un texto que no parece editable no se toca.
//
// El texto se guarda al perder el foco, en el estado local de la pantalla.
// No viaja a la API hasta Aprobar, y viaja entero como notaEditada.

interface SeccionSoapProps {
  titulo: string;
  ayuda: string;
  valor: string;
  /** Ausente en la nota aprobada: ahí la sección es registro, no borrador. */
  onGuardar?: (valor: string) => void;
  editable?: boolean;
  deshabilitado?: boolean;
}

export function SeccionSoap({
  titulo,
  ayuda,
  valor,
  onGuardar,
  editable = false,
  deshabilitado = false,
}: SeccionSoapProps) {
  const [editando, setEditando] = React.useState(false);
  // Borrador de la edición en curso. Se siembra al entrar en edición, no en
  // un efecto: así el texto que llega de la API nunca pisa lo que ella está
  // escribiendo.
  const [borrador, setBorrador] = React.useState(valor);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const tituloId = React.useId();

  const puedeEditar = editable && onGuardar !== undefined && !deshabilitado;

  const ajustarAlto = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Al abrir la edición: foco al final del texto y alto ajustado. Son
  // efectos sobre el DOM, no estado derivado.
  React.useEffect(() => {
    if (!editando) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    ajustarAlto();
  }, [editando, ajustarAlto]);

  const abrirEdicion = () => {
    if (!puedeEditar) return;
    setBorrador(valor);
    setEditando(true);
  };

  const cerrarGuardando = () => {
    setEditando(false);
    if (borrador !== valor) {
      onGuardar?.(borrador);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2
            id={tituloId}
            className="font-display text-[17px] font-medium text-ink-900"
          >
            {titulo}
          </h2>
          <p className="font-sans text-[13px] leading-[1.5] text-ink-500">
            {ayuda}
          </p>
        </div>
        {puedeEditar && !editando ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={abrirEdicion}
            aria-label={`${EDITAR} — ${titulo}`}
            className="shrink-0"
          >
            {EDITAR}
          </Button>
        ) : null}
      </div>

      {editando ? (
        <textarea
          ref={textareaRef}
          aria-labelledby={tituloId}
          value={borrador}
          rows={3}
          onChange={(evento) => {
            setBorrador(evento.target.value);
            ajustarAlto();
          }}
          onBlur={cerrarGuardando}
          className="resize-none overflow-hidden rounded-md border border-sage-500 bg-white px-4 py-3 font-sans text-[15px] leading-[1.7] text-ink-900 outline-none ring-[3px] ring-sage-500/20"
        />
      ) : (
        <div
          onClick={abrirEdicion}
          className={`whitespace-pre-wrap rounded-md px-4 py-3 font-sans text-[15px] leading-[1.7] text-ink-900 ${
            puedeEditar
              ? "cursor-text bg-cream-100 hover:bg-cream-50"
              : "bg-cream-100"
          }`}
        >
          {valor.trim() ? valor : "—"}
        </div>
      )}
    </section>
  );
}
