"use client";

import * as React from "react";

interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  error?: string;
  prefix?: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function Input({
  label,
  error,
  prefix,
  className = "",
  id,
  ref,
  ...rest
}: InputProps) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  const errorId = error ? `${inputId}-error` : undefined;

  const wrapperBorder = error
    ? "border-[color:var(--color-error)]"
    : "border-[color:var(--border-subtle)] focus-within:border-sage-500";

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          htmlFor={inputId}
          className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500"
        >
          {label}
        </label>
      )}
      <div
        className={`flex items-center bg-cream-50 border rounded-sm transition-colors duration-150 focus-within:bg-white focus-within:ring-[3px] focus-within:ring-sage-500/20 ${wrapperBorder}`}
      >
        {prefix && (
          <span className="pl-[14px] text-[15px] text-ink-500 font-sans pointer-events-none select-none">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`flex-1 min-w-0 bg-transparent py-[10px] text-[15px] text-ink-900 outline-none placeholder:text-ink-300 ${prefix ? "pl-2 pr-[14px]" : "px-[14px]"} ${className}`}
          {...rest}
        />
      </div>
      {error && (
        <span
          id={errorId}
          role="alert"
          className="text-[12px] font-sans text-[color:var(--color-error)]"
        >
          {error}
        </span>
      )}
    </div>
  );
}
