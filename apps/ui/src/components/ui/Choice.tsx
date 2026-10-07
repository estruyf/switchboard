import type { ReactNode } from 'react';

/** A picture card in a `RadioGroup` (theme, sidebar style). `attr` is the data- hook the smoke test clicks. */
export function Choice<T extends string>({ value, current, label, attr, onSelect, children }: { value: T; current: T; label: string; attr: string; onSelect(value: T): void; children: ReactNode }) {
  const selected = value === current;
  return (
    <button type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} {...{ [attr]: value }} onClick={() => onSelect(value)} className="group flex flex-col gap-2 text-left">
      <span className={`relative block h-24 overflow-hidden rounded-lg border ${selected ? 'border-accent-ink ring-2 ring-accent/60' : 'border-border group-hover:border-faint'}`}>{children}</span>
      <span className={`text-ui ${selected ? 'font-semibold text-text' : 'text-muted'}`}>{label}</span>
    </button>
  );
}
