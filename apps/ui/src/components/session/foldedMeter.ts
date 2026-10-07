/** One window of plan usage, as the footer names it ("5h", "Week"). */
export interface UsageLine {
  label: string;
  percent: number;
}

/** The context window: how full it is, or only an estimate (`percent` null) for a session not running here. */
export interface ContextLine {
  percent: number | null;
  /** "46k / 200k", or "≈46k" for an estimate. */
  detail: string;
}

/**
 * The single ring that stands in for the session footer (plan usage and the context window) while the
 * terminal is open below. It fills to the fullest of them, so a limit that is running out still shows
 * its colour; the tooltip and the accessible name give every number. Null when there is nothing to show.
 */
export function foldedMeter(usage: readonly UsageLine[], context: ContextLine | null): { percent: number | null; lines: string[] } | null {
  const lines = usage.map((u) => `${u.label} ${Math.round(u.percent)}%`);
  if (context) lines.push(context.percent === null ? `Context ${context.detail}` : `Context ${Math.round(context.percent)}% · ${context.detail}`);
  if (lines.length === 0) return null;
  const known = [...usage.map((u) => u.percent), ...(context?.percent != null ? [context.percent] : [])].filter(Number.isFinite);
  return { percent: known.length ? Math.max(...known) : null, lines };
}
