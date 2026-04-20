import type { ReactNode } from "react";

type ChipVariant = "sage" | "terracotta" | "gold" | "neutral";
type ChipSize = "default" | "sm";

interface ChipProps {
  variant?: ChipVariant;
  size?: ChipSize;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<ChipVariant, string> = {
  sage: "bg-sage-100 text-sage-700",
  terracotta: "bg-terracotta-50 text-terracotta-600",
  gold: "bg-gold-50 text-gold-500",
  neutral: "bg-cream-100 text-ink-700",
};

const sizeClasses: Record<ChipSize, string> = {
  default: "px-[10px] py-[3px] text-[10px]",
  sm: "px-2 py-[2px] text-[9px]",
};

export function Chip({
  variant = "neutral",
  size = "default",
  children,
  className = "",
}: ChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-sans font-semibold uppercase tracking-[0.08em] whitespace-nowrap ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </span>
  );
}
