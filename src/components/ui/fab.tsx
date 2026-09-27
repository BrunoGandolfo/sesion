"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { BOTTOM_FAB_MOVIL } from "@/lib/lupita-presencia";

// En el teléfono el "+" se apoya ARRIBA de Lupita posada, que ocupa la
// esquina derecha sobre el menú de abajo (docs/diseno/06-lupita-presencia.md,
// D0). Antes estaba en `bottom-20`, justo delante de ella. El toast se apoya
// arriba del "+" (ui/toast.tsx).

interface FabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function Fab({ label, className = "", type, ...rest }: FabProps) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      style={{ bottom: BOTTOM_FAB_MOVIL }}
      className={`lg:hidden fixed right-5 z-30 inline-flex items-center justify-center w-14 h-14 rounded-full bg-sage-500 text-white shadow-raised hover:bg-sage-600 active:bg-sage-700 transition-colors duration-[var(--duration-fast)] ${className}`}
      {...rest}
    >
      <Plus size={24} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
