"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { SUAVE } from "./movimiento";
import estilosFormulario from "./sheet-formulario.module.css";

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

/**
 * Cómo se para el panel en desktop. En mobile no cambia nada: los dos suben
 * desde abajo, que es de donde llega el pulgar.
 *
 *   "centrado" — el diálogo de siempre, en el medio de la pantalla. Es lo
 *                que usan el cobro, el turno nuevo y la firma: cosas que se
 *                resuelven y se cierran.
 *   "lateral"  — una columna a la derecha, de alto completo, que entra
 *                deslizándose. Para lo que acompaña a la pantalla de atrás
 *                en vez de interrumpirla: hoy, la ayuda.
 */
export type VarianteSheet = "centrado" | "lateral";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  ariaLabel?: string;
  variante?: VarianteSheet;
  className?: string;
  /** Las altas usan el scroll del panel, incluso si el formulario trae uno propio. */
  formulario?: boolean;
}

export function Sheet({
  open,
  onClose,
  children,
  maxWidth = 560,
  ariaLabel,
  variante = "centrado",
  className = "",
  formulario = false,
}: SheetProps) {
  const [montado, setMontado] = React.useState(false);
  const mobileRef = React.useRef<HTMLDivElement>(null);
  const desktopRef = React.useRef<HTMLDivElement>(null);

  // El diálogo sale del stacking context de quien lo abre y vive junto a
  // los demás overlays, directamente en body. El primer render del cliente
  // replica el SSR (sin portal); recién después de montar existe document.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guardia de hidratación requerida por createPortal(document.body)
    setMontado(true);
  }, []);

  // Cuál de los dos paneles está a la vista en este viewport.
  const panelActivo = React.useCallback((): HTMLDivElement | null => {
    const mobile = mobileRef.current;
    if (mobile && esVisible(mobile)) return mobile;
    const desktop = desktopRef.current;
    if (desktop && esVisible(desktop)) return desktop;
    return null;
  }, []);

  React.useEffect(() => {
    if (!open || !montado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, montado, onClose]);

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
    if (!open || !montado) return;
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
  }, [open, montado, panelActivo]);

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

  const lateral = variante === "lateral";

  // prefers-reduced-motion: el overlay aparece sin fundido y el panel sin
  // desplazamiento ni escala. Está o no está. No es un fundido más corto:
  // quien pide menos movimiento no quiere 90 vh de pantalla desplazándose,
  // ni rápido ni despacio (docs/diseno/03-plan-de-movimiento.md, D1).
  //
  // Lo que NO cambia es el foco: el panel se sigue enfocando al abrir, la
  // trampa de Tab sigue igual y el foco vuelve al disparador al cerrar. Eso
  // es lo que hace que el sheet sea un diálogo, y no depende de que se mueva.
  const reducido = useReducedMotion();

  const entradaOverlay = reducido
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.2 },
      };

  const entradaMobile = reducido
    ? {}
    : {
        initial: { y: "100%" },
        animate: { y: 0 },
        exit: { y: "100%" },
        transition: { duration: 0.28, ease: SUAVE },
      };

  // El panel lateral es una columna de alto completo: no scrollea entero
  // —eso dejaría el campo de escribir fuera de la vista— sino que le pasa un
  // contexto de flex column con min-h-0 al contenido, que decide qué parte
  // de él scrollea.
  const clasesDesktop = lateral
    ? "hidden lg:flex fixed z-50 inset-y-0 right-0 w-full flex-col bg-white shadow-raised outline-none"
    : "hidden lg:block fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-48px)] bg-white rounded-lg shadow-raised max-h-[85vh] overflow-y-auto outline-none";

  const entradaDesktop = reducido
    ? {}
    : {
        ...(lateral
          ? { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } }
          : {
              initial: { opacity: 0, scale: 0.96 },
              animate: { opacity: 1, scale: 1 },
              exit: { opacity: 0, scale: 0.96 },
            }),
        transition: { duration: lateral ? 0.28 : 0.2, ease: SUAVE },
      };

  if (!montado) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            {...entradaOverlay}
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
            {...entradaMobile}
            style={formulario ? { maxHeight: "90dvh" } : undefined}
            className={`lg:hidden fixed z-50 bottom-0 left-0 right-0 flex max-h-[90vh] flex-col bg-white rounded-t-xl outline-none ${className}`}
          >
            <div className="shrink-0 bg-white flex justify-center pt-3 pb-2">
              <span
                aria-hidden="true"
                className="block w-10 h-1 rounded-full bg-ink-300"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" style={formulario ? { overscrollBehaviorY: "contain" } : undefined}>
              <div className={formulario ? estilosFormulario.contenido : "px-6 pb-6"}>{children}</div>
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
            {...entradaDesktop}
            style={{ maxWidth, ...(formulario ? { maxHeight: "85dvh", overscrollBehaviorY: "contain" } : {}) }}
            className={`${clasesDesktop} ${className}`}
          >
            <div className={formulario ? estilosFormulario.contenido : lateral ? "flex min-h-0 flex-1 flex-col p-7" : "p-7"}>
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
