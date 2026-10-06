import type { HTMLAttributes } from 'react';
import { shortcutGlyphs } from '../../lib/shortcuts.ts';

export type KbdTone = 'default' | 'on-accent' | 'plain';

const TONE: Record<KbdTone, string> = {
  // A small keycap; the overlay border stays visible on dialogs and popovers.
  default: 'rounded border border-edge px-1 text-faint',
  // Inside a yellow button: the button's own ink, softened, without a keycap.
  'on-accent': 'text-on-accent/60',
  plain: 'text-faint',
};

interface KbdProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** What to press: glyphs as shown (`⌘↵`, `Esc`, `⌃1`) or a stored shortcut (`cmd+enter`), which is formatted. */
  keys: string;
  tone?: KbdTone;
  /** Hidden in a narrow pane (two sessions side by side), where the button keeps only its label. */
  hideNarrow?: boolean;
}

/** A keyboard shortcut, as macOS writes it. Buttons show theirs with `Button`'s `kbd` prop. */
export function Kbd({ keys, tone = 'default', hideNarrow = false, className = '', ...rest }: KbdProps) {
  return (
    <kbd className={`shrink-0 font-sans text-meta font-normal ${TONE[tone]} ${hideNarrow ? '@max-[860px]:hidden' : ''} ${className}`} {...rest}>
      {shortcutGlyphs(keys)}
    </kbd>
  );
}
