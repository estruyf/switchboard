import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { UsageLimit, UsageSnapshot } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { countdown, limitLabel, visibleLimits } from './usageFormat.ts';

interface UsageState {
  usage: UsageSnapshot | null;
  set(usage: UsageSnapshot | null): void;
}

export const useUsage = create<UsageState>()((set) => ({ usage: null, set: (usage) => set({ usage }) }));

/** Loads plan usage once per connection, follows updates, and refreshes when the window comes back into focus. */
export function useUsageSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const load = (refresh: boolean) => void client.call('usage.get', { refresh }).then(({ usage }) => useUsage.getState().set(usage)).catch(() => {});
    const off = client.on('usage.changed', ({ usage }) => useUsage.getState().set(usage));
    // Fetching starts a short-lived Claude Code process; let the window finish starting first.
    const initial = setTimeout(() => load(false), 2_000);
    const onFocus = () => load(false);
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      clearTimeout(initial);
      window.removeEventListener('focus', onFocus);
    };
  }, [client]);
}

const TONE: Record<string, string> = { warning: 'var(--sb-warn)', critical: 'var(--sb-error)' };

function Ring({ percent, severity }: { percent: number; severity: string }) {
  const r = 6.5;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--sb-border)" strokeWidth="2.5" />
      <circle cx="8" cy="8" r={r} fill="none" stroke={TONE[severity] ?? 'var(--sb-ok)'} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${filled} ${circumference}`} />
    </svg>
  );
}

const money = (minorUnits: number, currency: string | null) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 2 }).format(minorUnits / 100);

/**
 * Plan usage above the composer, like the claude-stats mod: one pill per window with a ring and a reset countdown.
 * `compact` drops the pills for a single line (`6% 5h · 4h44m`), for the new session's route tray.
 */
export function UsageBand({ compact = false }: { compact?: boolean }) {
  const usage = useUsage((s) => s.usage);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!usage) return null;
  const limits = visibleLimits(usage.limits);
  const extra = usage.extraUsage;
  if (limits.length === 0) return null;
  const resetTitle = (limit: UsageLimit) =>
    limit.resetsAt ? `Resets ${new Date(limit.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : undefined;

  if (compact) {
    return (
      <div className="flex shrink-0 items-center divide-x divide-border text-[11.5px]" data-usage-band>
        {limits.map((limit) => (
          <div key={`${limit.kind}:${limit.scope ?? ''}`} className="flex items-center gap-1.5 px-2.5 whitespace-nowrap first:pl-0 last:pr-0" title={resetTitle(limit)}>
            <Ring percent={limit.percent} severity={limit.severity} />
            <span className="font-semibold text-muted tabular-nums">{Math.round(limit.percent)}%</span>
            <span className="text-faint">
              {limitLabel(limit)}
              {limit.resetsAt && ` · ${countdown(limit.resetsAt, now)}`}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-usage-band>
      {limits.map((limit) => (
        <div
          key={`${limit.kind}:${limit.scope ?? ''}`}
          className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[12px]"
          title={resetTitle(limit)}
        >
          <Ring percent={limit.percent} severity={limit.severity} />
          <span className="font-semibold tabular-nums">{Math.round(limit.percent)}%</span>
          <span className="text-faint">
            {limitLabel(limit)}
            {limit.resetsAt && ` · resets ${countdown(limit.resetsAt, now)}`}
          </span>
        </div>
      ))}
      {extra?.enabled && extra.usedCredits !== null && extra.usedCredits > 0 && (
        <div className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[12px]">
          <span className="font-semibold text-ok">{money(extra.usedCredits, extra.currency)}</span>
          <span className="text-faint">extra usage{extra.monthlyLimit !== null && ` of ${money(extra.monthlyLimit, extra.currency)}`}</span>
        </div>
      )}
    </div>
  );
}
