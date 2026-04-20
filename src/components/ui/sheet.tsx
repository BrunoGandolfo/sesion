"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";

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
          {/* Mobile drawer */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.28, ease }}
            className={`lg:hidden fixed z-50 bottom-0 left-0 right-0 bg-white rounded-t-xl h-[90vh] overflow-y-auto ${className}`}
          >
            <div className="sticky top-0 bg-white flex justify-center pt-3 pb-2">
              <span
                aria-hidden="true"
                className="block w-10 h-1 rounded-full bg-ink-300"
              />
            </div>
            <div className="px-6 pb-6">{children}</div>
          </motion.div>
          {/* Desktop modal */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease }}
            style={{ maxWidth }}
            className={`hidden lg:block fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-48px)] bg-white rounded-lg shadow-raised max-h-[85vh] overflow-y-auto ${className}`}
          >
            <div className="p-7">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
