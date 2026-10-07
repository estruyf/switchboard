import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeTooltip } from './tooltipPlacement.ts';

const SHOW_DELAY = 450;
/** Moving from one tooltip target to the next within this window shows the next one at once. */
const WARM_WINDOW = 400;

interface Shown {
  text: string;
  target: Element;
}

/**
 * Themed tooltips in place of the slow, unthemed macOS `title` tooltip. Mount once; any element with
 * `data-tooltip="…"` gets one on hover or keyboard focus. One delegated listener covers virtualised
 * rows too. The attribute is not an accessible name: icon-only buttons also need an `aria-label`.
 */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    let hiddenAt = 0;

    const hide = () => {
      clearTimeout(timer);
      if (current) hiddenAt = Date.now();
      current = null;
      setShown(null);
    };
    const show = (target: Element) => {
      const text = target.getAttribute('data-tooltip');
      if (!text) return hide();
      if (target === current) return;
      clearTimeout(timer);
      const warm = current !== null || Date.now() - hiddenAt < WARM_WINDOW;
      current = target;
      setShown(null);
      timer = setTimeout(() => current === target && target.isConnected && setShown({ text, target }), warm ? 0 : SHOW_DELAY);
    };

    const onOver = (event: Event) => {
      const target = (event.target as Element | null)?.closest?.('[data-tooltip]');
      if (target) show(target);
      else if (current) hide();
    };
    const onFocus = (event: FocusEvent) => {
      // Only keyboard focus shows a tooltip; a click focusing a button shouldn't.
      if (!document.documentElement.hasAttribute('data-keyboard-nav')) return;
      onOver(event);
    };
    const onFocusOut = (event: FocusEvent) => event.target === current && hide();
    const onLeaveWindow = (event: MouseEvent) => event.relatedTarget === null && hide();

    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mouseout', onLeaveWindow);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('mouseout', onLeaveWindow);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) return setPosition(null);
    const rect = shown.target.getBoundingClientRect();
    setPosition(placeTooltip(rect, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      className="pointer-events-none fixed z-[100] max-w-[320px] rounded-md border overlay px-2 py-1 text-[11.5px] leading-snug whitespace-pre-line text-text wrap-anywhere"
      data-tooltip-layer
    >
      {shown.text}
    </div>
  );
}
