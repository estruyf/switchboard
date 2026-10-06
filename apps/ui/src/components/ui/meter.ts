import { levelOf, LEVEL_TEXT } from '../../lib/levels.ts';

/** A percentage kept to 0–100 (a missing number is 0), for what a meter draws and announces. */
export function clampPercent(percent: number): number {
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
}

/** The number a meter shows: whole percent, unclamped, so an overrun reads as one (`104%`). */
export function formatPercent(percent: number): string {
  return Number.isFinite(percent) ? `${Math.round(percent)}%` : '–';
}

/** A bar's fill width. At least a sliver, so an almost empty bar still shows its colour. */
export function barWidth(percent: number): string {
  return `${Math.max(2, clampPercent(percent))}%`;
}

/** How far round a ring is filled, in degrees. */
export function ringDegrees(percent: number): number {
  return clampPercent(percent) * 3.6;
}

/** The value's text colour: none while the level is fine, so only a warning draws the eye. */
export function valueTone(percent: number): string {
  return LEVEL_TEXT[levelOf(percent)];
}
