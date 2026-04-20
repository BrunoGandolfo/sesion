"use client";

import * as React from "react";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  ref?: React.Ref<HTMLTextAreaElement>;
}

export function Textarea({
  label,
  error,
  className = "",
  id,
  ref,
  ...rest
}: TextareaProps) {
  const reactId = React.useId();
  const textareaId = id ?? reactId;
  const errorId = error ? `${textareaId}-error` : undefined;

  const wrapperBorder = error
    ? "border-[color:var(--color-error)]"
    : "border-[color:var(--border-subtle)] focus-within:border-sage-500";

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          htmlFor={textareaId}
          className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500"
        >
          {label}
        </label>
      )}
      <div
        className={`flex bg-cream-50 border rounded-sm transition-colors duration-150 focus-within:bg-white focus-within:ring-[3px] focus-within:ring-sage-500/20 ${wrapperBorder}`}
      >
        <textarea
          ref={ref}
          id={textareaId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`flex-1 min-w-0 bg-transparent px-[14px] py-[10px] text-[15px] text-ink-900 outline-none placeholder:text-ink-300 resize-y min-h-[100px] ${className}`}
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
