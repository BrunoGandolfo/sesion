"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Alto del menú inferior, en píxeles. Derivado de bottom-nav.tsx:30
 * (py-2.5 = 20 + ícono 22 + gap-1 = 4 + label de 10px ≈ 15), redondeado
 * hacia arriba.
 *
 * El sheet mobile está fijo a `bottom-0` y el menú también, ambos en z-50;
 * como el menú se monta después en el layout, gana y tapa la franja
 * inferior del panel. Por eso el contenido reserva esta altura al final:
 * sin ella, el último botón de cada sheet queda debajo del menú.
 */
export const ALTURA_NAV_MOBILE = 64;

// Elementos que reciben foco con Tab. Se filtran después por visibilidad:
// el sheet renderiza el panel mobile y el de desktop a la vez y esconde uno
// con `lg:hidden` / `hidden lg:block`.
const FOCUSABLES =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function esVisible(el: Element): boolean {
  return el.getClientRects().length > 0;
}

function focusablesDe(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLES)).filter(
    esVisible,
  );
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  ariaLabel?: string;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  children,
  maxWidth = 560,
  ariaLabel,
  className = "",
}: SheetProps) {
  const mobileRef = React.useRef<HTMLDivElement>(null);
  const desktopRef = React.useRef<HTMLDivElement>(null);

  // Cuál de los dos paneles está a la vista en este viewport.
  const panelActivo = React.useCallback((): HTMLDivElement | null => {
    const mobile = mobileRef.current;
    if (mobile && esVisible(mobile)) return mobile;
    const desktop = desktopRef.current;
    if (desktop && esVisible(desktop)) return desktop;
    return null;
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Foco: entra al panel al abrir y vuelve al disparador al cerrar. Sin
  // esto, quien navega con teclado o lector de pantalla sigue parado en la
  // página de atrás mientras el diálogo está abierto, y al cerrarlo pierde
  // el lugar donde estaba.
  React.useEffect(() => {
    if (!open) return;
    const previo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const panel = panelActivo();
    const primero = focusablesDe(panel)[0] ?? panel;
    primero?.focus();

    return () => {
      // El panel puede seguir montado durante la animación de salida; el
      // foco vuelve igual, en el mismo tick en que se pidió cerrar.
      previo?.focus();
    };
  }, [open, panelActivo]);

  // Trampa de foco: Tab y Shift+Tab circulan dentro del panel abierto.
  const atraparTab = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;

      const panel = panelActivo();
      const items = focusablesDe(panel);

      if (items.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }

      const primero = items[0];
      const ultimo = items[items.length - 1];
      const activo = document.activeElement;
      const dentro = activo instanceof Node && panel?.contains(activo);

      if (event.shiftKey) {
        if (!dentro || activo === primero) {
          event.preventDefault();
          ultimo.focus();
        }
        return;
      }

      if (!dentro || activo === ultimo) {
        event.preventDefault();
        primero.focus();
      }
    },
    [panelActivo],
  );

  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-[rgba(26,38,40,0.3)] backdrop-blur-[2px]"
          />
          {/* Mobile drawer — alto según contenido, tope 90vh */}
          <motion.div
            ref={mobileRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={atraparTab}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.28, ease }}
            className={`lg:hidden fixed z-50 bottom-0 left-0 right-0 flex max-h-[90vh] flex-col bg-white rounded-t-xl outline-none ${className}`}
          >
            <div className="shrink-0 bg-white flex justify-center pt-3 pb-2">
              <span
                aria-hidden="true"
                className="block w-10 h-1 rounded-full bg-ink-300"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="px-6 pb-6">{children}</div>
              {/* Franja que el menú inferior tapa. Va fuera del bloque con
                  padding para que los formularios a sangre completa (que
                  cancelan px-6/pb-6 con márgenes negativos) igual la
                  conserven. */}
              <div
                aria-hidden="true"
                style={{ height: ALTURA_NAV_MOBILE }}
              />
            </div>
          </motion.div>
          {/* Desktop modal */}
          <motion.div
            ref={desktopRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={atraparTab}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease }}
            style={{ maxWidth }}
            className={`hidden lg:block fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-48px)] bg-white rounded-lg shadow-raised max-h-[85vh] overflow-y-auto outline-none ${className}`}
          >
            <div className="p-7">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
