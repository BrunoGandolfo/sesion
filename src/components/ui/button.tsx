"use client";

import * as React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "default" | "sm";

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  icon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-sage-500 text-white hover:bg-sage-600 active:bg-sage-700",
  secondary:
    "bg-transparent border border-[color:var(--border-strong)] text-ink-700 hover:bg-cream-100",
  ghost:
    "bg-transparent text-ink-500 hover:bg-cream-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "px-5 py-[11px] text-[14px] min-h-[44px]",
  sm: "px-[14px] py-[7px] text-[13px] min-h-[44px] lg:min-h-[36px]",
};

export function Button({
  variant = "primary",
  size = "default",
  asChild = false,
  icon,
  className = "",
  children,
  type,
  ref,
  ...rest
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-md font-sans font-semibold leading-none transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      className?: string;
      children?: React.ReactNode;
    }>;
    const mergedChildren = icon ? (
      <>
        {icon}
        {child.props.children}
      </>
    ) : (
      child.props.children
    );
    return React.cloneElement(
      child,
      {
        className: `${classes} ${child.props.className ?? ""}`,
        ...rest,
      },
      mergedChildren,
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
