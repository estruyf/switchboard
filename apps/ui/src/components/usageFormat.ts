import type { UsageLimit } from '@switchboard/protocol/client';

/** "5h", "7d", "7d · Fable" for the server's meter kinds. */
export function limitLabel(limit: UsageLimit): string {
  const base = limit.kind === 'session' ? '5h' : limit.group === 'weekly' || limit.kind.startsWith('weekly') ? '7d' : limit.kind.replace(/_/g, ' ');
  return limit.scope ? `${base} · ${limit.scope}` : base;
}

/** "4h3m", "3d1h", "12m", "now". */
export function countdown(resetsAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  if (minutes < 1) return 'now';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

/** The 5-hour and weekly windows, plus scoped ones once they're in use. */
export function visibleLimits(limits: UsageLimit[]): UsageLimit[] {
  return limits.filter((l) => l.kind === 'session' || l.kind === 'weekly_all' || l.percent >= 1);
}

/** "5-hour limit: 6% used, resets in 4h3m": a meter's pill in words, for VoiceOver (the ring and "5h" don't read well). */
export function spokenLimit(limit: UsageLimit, now = Date.now()): string {
  const name = limit.kind === 'session' ? '5-hour limit' : limitLabel(limit).startsWith('7d') ? 'Weekly limit' : `${limit.kind.replace(/_/g, ' ')} limit`;
  const scoped = limit.scope ? `${name} (${limit.scope})` : name;
  const severity = limit.severity === 'critical' ? ', nearly used up' : limit.severity === 'warning' ? ', getting close' : '';
  const reset = limit.resetsAt ? `, resets in ${countdown(limit.resetsAt, now)}` : '';
  return `${scoped}: ${Math.round(limit.percent)}% used${severity}${reset}`;
}
