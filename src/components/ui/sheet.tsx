"use client";

import * as React from "react";
import { useMovimientoReducido } from "@/hooks/useMovimientoReducido";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { SUAVE, DURACION_BREVE, DURACION_PANEL } from "./movimiento";
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

/**
 * UN SOLO PANEL.
 *
 * Hasta el 18/9 el sheet montaba sus children DOS veces —un panel para el
 * teléfono y otro para el escritorio, con uno escondido por CSS— y eso rompía
 * cualquier formulario que viviera adentro: react-hook-form guarda UNA
 * referencia por campo (la del último input registrado, o sea la copia de
 * escritorio) y al escribir lee el valor DE ESA referencia, no del input que
 * recibió la tecla (react-hook-form/dist/index.esm.mjs:1899 y :1001). En el
 * teléfono, reprogramar un turno mandaba la hora vieja y perdía la nota.
 *
 * Ahora el panel es uno y cambia de forma con clases responsive: lo que antes
 * distinguían dos árboles distintos hoy lo distingue el breakpoint `lg:`.
 */
const FOCUSABLES =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesDe(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLES));
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

const CONSULTA_ESCRITORIO = "(min-width: 1024px)";

/**
 * ¿El viewport está en `lg:` o más? Sólo decide la animación de entrada, que
 * framer-motion necesita como números y no puede leer de una clase. La forma
 * del panel NO depende de esto: la deciden las clases responsive.
 */
function useEsEscritorio(): boolean {
  const suscribir = React.useCallback((avisar: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia(CONSULTA_ESCRITORIO);
    mq.addEventListener?.("change", avisar);
    return () => mq.removeEventListener?.("change", avisar);
  }, []);
  const enCliente = React.useCallback(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia(CONSULTA_ESCRITORIO).matches,
    [],
  );
  return React.useSyncExternalStore(suscribir, enCliente, () => false);
}

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
  const panelRef = React.useRef<HTMLDivElement>(null);

  // El diálogo sale del stacking context de quien lo abre y vive junto a
  // los demás overlays, directamente en body. El primer render del cliente
  // replica el SSR (sin portal); recién después de montar existe document.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guardia de hidratación requerida por createPortal(document.body)
    setMontado(true);
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

    const panel = panelRef.current;
    const primero = focusablesDe(panel)[0] ?? panel;
    primero?.focus();

    return () => {
      // El panel puede seguir montado durante la animación de salida; el
      // foco vuelve igual, en el mismo tick en que se pidió cerrar.
      previo?.focus();
    };
  }, [open, montado]);

  // Trampa de foco: Tab y Shift+Tab circulan dentro del panel abierto.
  const atraparTab = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
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
    [],
  );

  const lateral = variante === "lateral";

  // prefers-reduced-motion: el overlay aparece sin fundido y el panel sin
  // desplazamiento ni escala. Está o no está. No es un fundido más corto:
  // quien pide menos movimiento no quiere 90 vh de pantalla desplazándose,
  // ni rápido ni despacio.
  //
  // Lo que NO cambia es el foco: el panel se sigue enfocando al abrir, la
  // trampa de Tab sigue igual y el foco vuelve al disparador al cerrar. Eso
  // es lo que hace que el sheet sea un diálogo, y no depende de que se mueva.
  const reducido = useMovimientoReducido();
  const escritorio = useEsEscritorio();

  const entradaOverlay = reducido
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: DURACION_BREVE, ease: SUAVE },
      };

  // Desde abajo en el teléfono; en escritorio, el lateral entra por la
  // derecha y el centrado aparece con una escala mínima.
  const entradaPanel = reducido
    ? {}
    : !escritorio
      ? {
          initial: { y: "100%" },
          animate: { y: 0 },
          exit: { y: "100%" },
          transition: { duration: DURACION_PANEL, ease: SUAVE },
        }
      : lateral
        ? {
            initial: { x: "100%" },
            animate: { x: 0 },
            exit: { x: "100%" },
            transition: { duration: DURACION_PANEL, ease: SUAVE },
          }
        : {
            initial: { opacity: 0, scale: 0.96 },
            animate: { opacity: 1, scale: 1 },
            exit: { opacity: 0, scale: 0.96 },
            transition: { duration: DURACION_BREVE, ease: SUAVE },
          };

  // Teléfono: cajón pegado abajo, a todo el ancho. Escritorio: el lateral se
  // vuelve columna a la derecha y el centrado, un diálogo en el medio. El tope
  // de ancho (`maxWidth`) es sólo de escritorio: en el teléfono el panel va
  // siempre a sangre, y por eso viaja como variable y no como `style.maxWidth`.
  const clasesMobile =
    "fixed z-50 bottom-0 left-0 right-0 flex flex-col bg-white rounded-t-xl outline-none";
  const clasesDesktop = lateral
    ? "lg:inset-y-0 lg:right-0 lg:left-auto lg:bottom-auto lg:h-full lg:rounded-none lg:shadow-raised lg:max-w-[var(--sheet-max-w)]"
    : "lg:bottom-auto lg:left-1/2 lg:right-auto lg:top-1/2 lg:w-[calc(100%-48px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-lg lg:shadow-raised lg:max-w-[var(--sheet-max-w)]";
  const clasesAlto = lateral
    ? "max-h-[90vh] lg:max-h-none"
    : formulario
      ? "max-h-[90dvh] lg:max-h-[85dvh]"
      : "max-h-[90vh] lg:max-h-[85vh]";

  const claseContenido = formulario
    ? estilosFormulario.contenido
    : lateral
      ? "flex min-h-0 flex-1 flex-col px-6 pb-6 lg:p-7"
      : "px-6 pb-6 lg:p-7";

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
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={atraparTab}
            {...entradaPanel}
            style={{ "--sheet-max-w": `${maxWidth}px` } as React.CSSProperties}
            className={`${clasesMobile} ${clasesAlto} ${clasesDesktop} ${className}`}
          >
            {/* Tirador del cajón: sólo existe cuando el panel sube desde abajo. */}
            <div className="shrink-0 bg-white flex justify-center pt-3 pb-2 lg:hidden">
              <span
                aria-hidden="true"
                className="block w-10 h-1 rounded-full bg-ink-300"
              />
            </div>
            {/* El scroll del panel. El lateral lo suelta en escritorio: ahí es
                una columna de alto completo y quien la usa (la ayuda) decide
                qué parte de su contenido se desplaza, para que el campo de
                escribir no se vaya de la vista. */}
            <div
              className={`min-h-0 flex-1 overflow-y-auto${
                lateral ? " lg:flex lg:flex-col lg:overflow-visible" : ""
              }`}
              style={formulario ? { overscrollBehaviorY: "contain" } : undefined}
            >
              <div className={claseContenido}>{children}</div>
              {/* Franja que el menú inferior tapa. Va fuera del bloque con
                  padding para que los formularios a sangre completa (que
                  cancelan px-6/pb-6 con márgenes negativos) igual la
                  conserven. En escritorio no hay menú inferior. */}
              <div
                aria-hidden="true"
                className="lg:hidden"
                style={{ height: ALTURA_NAV_MOBILE }}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
