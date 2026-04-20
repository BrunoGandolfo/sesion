import * as React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  clickable?: boolean;
  elevated?: boolean;
}

export function Card({
  clickable = false,
  elevated = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const base =
    "bg-white border border-[color:var(--border-subtle)] rounded-lg p-6 md:p-7";
  const interactive = clickable
    ? "cursor-pointer hover:border-sage-300 transition-colors duration-150"
    : "";
  const shadow = elevated ? "shadow-subtle" : "";

  return (
    <div
      className={`${base} ${interactive} ${shadow} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
