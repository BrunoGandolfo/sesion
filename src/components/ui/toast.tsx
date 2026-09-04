"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";

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

interface ToastProps {
  open: boolean;
  message: string;
  onClose: () => void;
  duration?: number;
}

export function Toast({
  open,
  message,
  onClose,
  duration = 2800,
}: ToastProps) {
  React.useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [open, duration, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          style={
            {
              "--toast-bottom": `${BOTTOM_MOBILE}px`,
              "--toast-bottom-lg": `${BOTTOM_DESKTOP}px`,
            } as React.CSSProperties
          }
          className="fixed z-50 bottom-[var(--toast-bottom)] left-1/2 -translate-x-1/2 lg:bottom-[var(--toast-bottom-lg)] lg:right-8 lg:left-auto lg:translate-x-0 inline-flex max-w-[calc(100vw-40px)] items-center gap-2 bg-ink-900 text-cream-50 rounded-md px-4 py-3 shadow-raised"
        >
          <Check
            size={16}
            strokeWidth={1.6}
            aria-hidden="true"
            className="shrink-0"
          />
          <span className="font-sans text-[14px] leading-[1.35]">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
