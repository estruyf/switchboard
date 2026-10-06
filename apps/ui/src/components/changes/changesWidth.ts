/** The Changes panel's width limits: room for a file list at the minimum, and the conversation keeps some room at the maximum. */
export const CHANGES_DEFAULT_WIDTH = 440;
export const CHANGES_MIN_WIDTH = 320;
/** The most of the window the panel may take. */
export const CHANGES_MAX_SHARE = 0.7;
/** How far one ← or → press moves the panel's edge. */
export const CHANGES_KEY_STEP = 24;

/**
 * Rounds and clamps a dragged or stored width for a window `windowWidth` wide. Anything that isn't a
 * finite number falls back to the default; a window too small for the minimum still gets the minimum.
 */
export function clampChangesWidth(width: number, windowWidth: number): number {
  const max = Math.max(CHANGES_MIN_WIDTH, Math.floor(windowWidth * CHANGES_MAX_SHARE));
  const value = Number.isFinite(width) ? width : CHANGES_DEFAULT_WIDTH;
  return Math.round(Math.min(Math.max(value, CHANGES_MIN_WIDTH), max));
}

/** The width after a resize key: ← widens the panel (its edge is on the left), → narrows it. Null for other keys. */
export function changesWidthForKey(key: string, width: number, windowWidth: number): number | null {
  const step = key === 'ArrowLeft' ? CHANGES_KEY_STEP : key === 'ArrowRight' ? -CHANGES_KEY_STEP : null;
  if (step === null) return null;
  return clampChangesWidth(width + step, windowWidth);
}
