import * as React from "react";

export function Card({
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  const base =
    "bg-white border border-[color:var(--border-subtle)] rounded-lg p-6 md:p-7";

  return (
    <div
      className={`${base} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
