/** How full something is (plan usage, the context window), as one of three tones. */
export type Level = 'ok' | 'caution' | 'high';

/** Below this percentage a level is fine (green). */
export const CAUTION_AT = 60;
/** From this percentage on a level is close to its limit (red). */
export const HIGH_AT = 85;

/** Green under 60%, orange from 60% to 85%, red from 85% on. */
export function levelOf(percent: number): Level {
  if (!Number.isFinite(percent) || percent < CAUTION_AT) return 'ok';
  return percent < HIGH_AT ? 'caution' : 'high';
}

/** Tailwind background class for a level's bar or ring. */
export const LEVEL_FILL: Record<Level, string> = { ok: 'bg-ok', caution: 'bg-caution', high: 'bg-error' };
/** Tailwind text class for a level's number; `ok` stays muted so only a warning draws the eye. */
export const LEVEL_TEXT: Record<Level, string> = { ok: '', caution: 'text-caution', high: 'text-error' };
/** CSS colour for a level, for places a class can't reach (a conic-gradient ring). */
export const LEVEL_COLOR: Record<Level, string> = { ok: 'var(--sb-ok)', caution: 'var(--sb-caution)', high: 'var(--sb-error)' };
