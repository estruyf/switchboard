import type { Effort, PermissionMode } from '@switchboard/protocol/client';

/**
 * How compact the message box's chips are. 0: everything. 1: effort and mode show only their icon.
 * 2: the model drops its version. 3: the profile shows only its dot. Each step keeps whole words, so a
 * chip never ends in "…".
 */
export type FooterLevel = 0 | 1 | 2 | 3;

export const FOOTER_LEVELS: readonly FooterLevel[] = [0, 1, 2, 3];

/**
 * The fullest level whose chips fit: `widths[level]` is the chip row's own width at that level, and
 * `widthAvailable` the room the footer leaves it. Past level 3 there is nothing left to drop, so it stays there.
 */
export function footerLevel(widthAvailable: number, widths: readonly number[]): FooterLevel {
  // Half a pixel of slack: measured widths are fractional, and a row that fits exactly must not flip.
  for (const level of FOOTER_LEVELS) if ((widths[level] ?? Infinity) <= widthAvailable + 0.5) return level;
  return 3;
}

/** The model chip's name: "Opus 4.5", without "Claude" or a note in brackets; "Default model" when nothing is picked. */
export function shortModelName(label: string): string {
  const name = label
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/^claude\s+/i, '')
    .trim();
  return !name || /^default$/i.test(name) ? 'Default model' : name;
}

/** The model chip at level 2 and up: the name without its version ("Opus"). */
export function modelFamily(label: string): string {
  const name = shortModelName(label);
  return name.replace(/\s+v?\d[\d.]*\b.*$/i, '').trim() || name;
}

/** The effort chip's three bars: how many are filled, and whether they're in the accent (above High). */
export function effortBars(effort: Effort | ''): { filled: 0 | 1 | 2 | 3; strong: boolean } {
  switch (effort) {
    case 'low':
      return { filled: 1, strong: false };
    case 'medium':
      return { filled: 2, strong: false };
    case 'high':
      return { filled: 3, strong: false };
    case 'xhigh':
    case 'max':
      return { filled: 3, strong: true };
    default:
      return { filled: 0, strong: false };
  }
}

/** The mode chip's short name; the menu keeps the full one (`MODE_LABEL`). */
export const MODE_SHORT: Record<PermissionMode, string> = {
  default: 'Ask first',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass',
};

/** What each chip shows at a level. */
export function chipShape(level: FooterLevel): { effortLabel: boolean; modeLabel: boolean; modelVersion: boolean; profileName: boolean } {
  return { effortLabel: level < 1, modeLabel: level < 1, modelVersion: level < 2, profileName: level < 3 };
}
