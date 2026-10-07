import { ChevronDown, ChevronUp } from 'lucide-react';
import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button.tsx';

/** Lines of a long prompt shown before Show more. */
const LINES = 2;

/**
 * Which long prompts are shown in full. The session view keeps it, because the list is virtualised:
 * a row that scrolls out and back is a new component and would forget its own state.
 */
export interface PromptExpansion {
  isOpen(key: string): boolean;
  toggle(key: string): void;
}

export const PromptExpansionContext = createContext<PromptExpansion | null>(null);

/** A prompt's text, cut to two lines with Show more / Show less when it is longer. */
export function ClampedPrompt({ itemKey, className = '', children }: { itemKey: string; className?: string; children: ReactNode }) {
  const expansion = useContext(PromptExpansionContext);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = expansion ? expansion.isOpen(itemKey) : ownOpen;
  const toggle = () => (expansion ? expansion.toggle(itemKey) : setOwnOpen((o) => !o));
  const textId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  // Measured against the line height rather than the clamp, so a prompt that mounts open still gets Show less.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setLong(el.scrollHeight > LINES * parseFloat(getComputedStyle(el).lineHeight) + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={ref} id={textId} className={`${className} ${long && !open ? 'max-h-[2lh] overflow-hidden' : ''}`} data-prompt-clamped={long && !open ? true : undefined}>
        {children}
      </div>
      {long && (
        <Button
          variant="quiet"
          size="sm"
          icon={open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          aria-expanded={open}
          aria-controls={textId}
          onClick={toggle}
          className="mt-1 -ml-1.5"
          data-prompt-toggle
        >
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </>
  );
}
