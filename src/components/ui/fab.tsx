"use client";

import * as React from "react";
import { Plus } from "lucide-react";

interface FabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function Fab({ label, className = "", type, ...rest }: FabProps) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      className={`lg:hidden fixed bottom-20 right-5 z-30 inline-flex items-center justify-center w-14 h-14 rounded-full bg-sage-500 text-white shadow-raised hover:bg-sage-600 active:bg-sage-700 transition-colors duration-150 ${className}`}
      {...rest}
    >
      <Plus size={24} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
