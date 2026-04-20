"use client";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 bg-cream-100 border border-[color:var(--border-subtle)] rounded-md p-1 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center justify-center min-h-[44px] px-3 py-[6px] rounded-[6px] text-[13px] font-sans leading-none transition-[background-color,color,box-shadow] duration-150 ${
              active
                ? "bg-white text-ink-900 font-semibold shadow-subtle"
                : "text-ink-500 hover:text-ink-700"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
