"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";

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
          className="fixed z-50 bottom-[96px] left-1/2 -translate-x-1/2 lg:bottom-6 lg:right-6 lg:left-auto lg:translate-x-0 inline-flex items-center gap-2 bg-ink-900 text-cream-50 rounded-md px-4 py-3 shadow-raised"
        >
          <Check size={16} strokeWidth={1.6} aria-hidden="true" />
          <span className="font-sans text-[14px] leading-none">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
