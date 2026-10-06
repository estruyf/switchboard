import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** Theme class for a status dot before the label (`bg-ok`). */
  dot?: string;
}

/**
 * A pill that opens a small menu of choices under (or above) it. The checked choice gets focus on
 * open, arrow keys move between choices, and Escape, Tab or a click outside closes it.
 */
export function ChoiceMenu<T extends string>({
  name,
  value,
  choices,
  onChange,
  title,
  disabled,
  width = 240,
  heading,
  placement = 'auto',
  children,
}: {
  /** `data-menu` on the panel, and `data-<name>-select` on the pill, for the smoke test. */
  name: string;
  value: T;
  choices: Array<Choice<T>>;
  onChange(value: T): void;
  title?: string;
  disabled?: boolean;
  width?: number;
  /** A small uppercase title over the choices. */
  heading?: string;
  /** `up` always opens above the pill; `auto` opens above only when there is no room below. */
  placement?: 'auto' | 'up';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
    (items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onBlur = () => setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close(true));
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown') (e.preventDefault(), focus(index + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), focus(index - 1));
    else if (e.key === 'Home') (e.preventDefault(), focus(0));
    else if (e.key === 'End') (e.preventDefault(), focus(items.length - 1));
  };

  return (
    <div ref={ref} className="relative" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={trigger}
        type="button"
        data-tooltip={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        data-value={value}
        {...{ [`data-${name}-select`]: '' }}
        onClick={(e) => {
          // Opens upward when the pill sits near the bottom of the window.
          setUpward(placement === 'up' || window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 300);
          setOpen((o) => !o);
        }}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] whitespace-nowrap text-muted hover:bg-border/50 hover:text-text disabled:opacity-50 ${open ? 'bg-border/50 text-text' : ''}`}
      >
        {children}
      </button>
      {open && (
        <div
          ref={panel}
          role="menu"
          data-menu={name}
          style={{ width }}
          className={`absolute left-0 z-40 max-h-80 overflow-y-auto rounded-lg border overlay py-1 ${upward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          {heading && <p className="px-3 pt-1.5 pb-1 text-[10px] tracking-wide text-faint uppercase">{heading}</p>}
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitemradio"
              aria-checked={choice.value === value}
              data-choice={choice.value}
              onClick={() => {
                onChange(choice.value);
                close(true);
              }}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left outline-none hover:bg-accent/15 focus-visible:bg-accent/15"
            >
              {choice.dot && <span className={`mt-[5px] size-2 shrink-0 rounded-full ${choice.dot}`} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-text">{choice.label}</span>
                {choice.description && <span className="block truncate text-[11px] text-faint">{choice.description}</span>}
              </span>
              <Check size={13} className={`mt-[3px] shrink-0 text-accent-ink ${choice.value === value ? '' : 'invisible'}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
