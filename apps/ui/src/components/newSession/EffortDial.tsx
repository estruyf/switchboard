import { Gauge, RotateCcw } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import type { Effort } from '@switchboard/protocol/client';
import { EFFORT_LABEL, EFFORTS, toggleEffort } from './route.ts';

/**
 * Effort as five bars of rising height. Clicking a bar picks that effort, clicking the picked one
 * again clears it; arrow keys step through them like a radio group.
 */
export function EffortDial({ value, onChange }: { value: Effort | ''; onChange(effort: Effort | ''): void }) {
  const group = useRef<HTMLDivElement>(null);
  const selected = value ? EFFORTS.indexOf(value) : -1;

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = EFFORTS[Math.min(EFFORTS.length - 1, Math.max(0, selected + step))]!;
    onChange(next);
    group.current?.querySelectorAll<HTMLButtonElement>('[role=radio]')[EFFORTS.indexOf(next)]?.focus();
  };

  return (
    <div className="flex items-center gap-2" data-effort-dial>
      <Gauge size={14} className="shrink-0 text-muted" aria-hidden />
      <div ref={group} role="radiogroup" aria-label="Effort" className="flex h-7 items-center" onKeyDown={onKeyDown}>
        {EFFORTS.map((effort, i) => (
          <button
            key={effort}
            type="button"
            role="radio"
            aria-checked={effort === value}
            aria-label={`${EFFORT_LABEL[effort]} effort`}
            title={effort === value ? `${EFFORT_LABEL[effort]} effort (click again for the default)` : `${EFFORT_LABEL[effort]} effort`}
            tabIndex={effort === value || (selected === -1 && i === 0) ? 0 : -1}
            data-effort={effort}
            onClick={() => onChange(toggleEffort(value, effort))}
            className="group flex h-5 items-end rounded-sm px-[1.5px]"
          >
            <span
              style={{ height: 6 + i * 2.5 }}
              className={`block w-[4px] rounded-[1px] transition-colors ${i <= selected ? 'bg-accent-ink' : 'bg-faint/40 group-hover:bg-faint'}`}
            />
          </button>
        ))}
      </div>
      <span className="text-[12px] whitespace-nowrap text-muted">{value ? EFFORT_LABEL[value] : 'Default effort'}</span>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Back to the default effort"
          data-effort-reset
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] whitespace-nowrap text-faint hover:bg-border/50 hover:text-text"
        >
          <RotateCcw size={11} />
          Default
        </button>
      )}
    </div>
  );
}
