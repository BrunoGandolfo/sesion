"use client";

import * as React from "react";
import { useMovimientoReducido } from "@/hooks/useMovimientoReducido";
import { AnimatePresence, motion } from "framer-motion";

import { CheckDibujado, SUAVE, DURACION_BREVE } from "./movimiento";

// Posición: por encima del botón flotante, nunca sobre él.
//
// En mobile hay dos flotantes y no siempre el mismo: el "+" de agendar
// (ui/fab.tsx: bottom-20, alto 56 → borde superior a 136px) y el de grabar
// de la ficha de paciente (paciente-detail-view: bottom-24, alto 56 → borde
// superior a 152px). El toast se apoya arriba del más alto de los dos.
//
// Antes vivía en bottom-[96px]: quedaba justo encima del "+" pero pisaba el
// de grabar, y por ~3 segundos tapaba el botón más importante de la app.
const BOTTOM_MOBILE = 160; // 152 del flotante más alto + 8 de aire
// En desktop solo existe el de grabar (lg:bottom-8, alto 48 → tope a 80px).
const BOTTOM_DESKTOP = 104;

/**
 * Qué acompaña al mensaje. Son dos y no hay una tercera:
 *
 *   "confirmacion" — el CheckDibujado de siempre. Lo que pediste se hizo.
 *                    Es lo que lleva el cobro, incluida su frase alegre
 *                    ("Cobrado. Ese ya está.").
 *   "aviso"        — sin ícono. Es lo que va cuando el mensaje es un error:
 *                    un tilde verde sobre "No se pudo cobrar" es la peor
 *                    confirmación posible.
 *
 * ACÁ NO ENTRA LUPITA, Y NO ES POR LA REGLA DEL RIESGO
 *
 * El toast se dibuja sobre ink-900, y la paleta que 04-personaje.md le fija
 * a Lupita —sage-500, sage-300 y el punto gold-500— está pensada sobre
 * blanco o crema: sobre el fondo oscuro la hoja grande se apaga y el dibujo
 * deja de leerse. Hubo una variante "celebracion" con Lupita a 32 px y se
 * sacó por eso. Si alguna vez el personaje tiene que celebrar un cobro, el
 * lugar es una superficie clara, no este chip.
 *
 * (La regla del riesgo sigue valiendo igual donde Lupita sí aparece: una
 * sesión con señal no se celebra con el personaje en ninguna pantalla.)
 */
export type VarianteToast = "confirmacion" | "aviso";

/** Cuánto queda a la vista antes de irse solo. */
const DURACION_TOAST_MS = 2800;

/** Lo que el Toast necesita: `<Toast {...toast.props} />`. */
interface ToastProps {
  open: boolean;
  message: string;
  onClose: () => void;
  variante?: VarianteToast;
  /** Cambia con cada aviso nuevo (lo pone useToast): el tiempo a la vista
   *  vuelve a empezar aunque el toast ya estuviera abierto. */
  clave?: number;
}

export function Toast({
  open,
  message,
  onClose,
  variante = "confirmacion",
  clave,
}: ToastProps) {
  // Entra y sale sin desplazamiento con la preferencia declarada: aparece y
  // desaparece. El texto y el aria-live no cambian.
  const reducido = useMovimientoReducido();

  const entrada = reducido
    ? {}
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 16 },
        transition: { duration: DURACION_BREVE, ease: SUAVE },
      };

  React.useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onClose, DURACION_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [open, onClose, clave]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="status"
          aria-live="polite"
          {...entrada}
          style={
            {
              "--toast-bottom": `${BOTTOM_MOBILE}px`,
              "--toast-bottom-lg": `${BOTTOM_DESKTOP}px`,
            } as React.CSSProperties
          }
          className="fixed z-50 bottom-[var(--toast-bottom)] left-1/2 -translate-x-1/2 lg:bottom-[var(--toast-bottom-lg)] lg:right-8 lg:left-auto lg:translate-x-0 inline-flex max-w-[calc(100vw-40px)] items-center gap-2 bg-ink-900 text-cream-50 rounded-md px-4 py-3 shadow-raised"
        >
          {/* El check se traza al entrar: es la confirmación de que lo que
              se pidió (cobrar, aprobar, agendar) efectivamente pasó. En un
              aviso ese lugar no lo ocupa nadie. */}
          {variante === "confirmacion" ? (
            <CheckDibujado tamano={16} className="shrink-0" />
          ) : null}
          <span className="font-sans text-[14px] leading-[1.35]">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * El estado de un toast, que cada pantalla escribía a mano (nueve copias de
 * `useState<{ open, message, variante }>`). `onClose` es estable: el Toast
 * arma su temporizador sobre él, y una flecha nueva en cada render lo
 * reiniciaba cada vez que la pantalla se volvía a dibujar.
 *
 *   const toast = useToast();
 *   toast.confirmar("Paciente creado");
 *   <Toast {...toast.props} />
 */
export function useToast(): {
  confirmar: (mensaje: string) => void;
  avisar: (mensaje: string) => void;
  cerrar: () => void;
  props: ToastProps;
} {
  const [estado, setEstado] = React.useState<{
    open: boolean;
    message: string;
    variante: VarianteToast;
    clave: number;
  }>({ open: false, message: "", variante: "confirmacion", clave: 0 });
  const mostrar = React.useCallback(
    (variante: VarianteToast) => (mensaje: string) =>
      setEstado((actual) => ({ open: true, message: mensaje, variante, clave: actual.clave + 1 })),
    [],
  );
  const confirmar = React.useMemo(() => mostrar("confirmacion"), [mostrar]);
  const avisar = React.useMemo(() => mostrar("aviso"), [mostrar]);
  const cerrar = React.useCallback(
    () => setEstado((actual) => ({ ...actual, open: false })),
    [],
  );
  return { confirmar, avisar, cerrar, props: { ...estado, onClose: cerrar } };
}

