import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { UsageLimit, UsageSnapshot } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useProfiles } from '../state/profilesStore.ts';
import { ProfileBadge } from './profiles/ProfileBadge.tsx';
import { countdown, limitLabel, visibleLimits } from './usageFormat.ts';

interface UsageState {
  /** Plan usage per Claude profile (each login has its own limits). */
  usage: Map<string, UsageSnapshot | null>;
  /** Profiles a band has shown; refreshed when the window comes back into focus. */
  wanted: Set<string>;
  set(profileId: string, usage: UsageSnapshot | null): void;
}

export const useUsage = create<UsageState>()((set) => ({
  usage: new Map(),
  wanted: new Set(),
  set: (profileId, usage) => set((s) => ({ usage: new Map(s.usage).set(profileId, usage), wanted: s.wanted.has(profileId) ? s.wanted : new Set(s.wanted).add(profileId) })),
}));

/** Follows usage updates, and refreshes the profiles on screen when the window comes back into focus. */
export function useUsageSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('usage.changed', ({ profileId, usage }) => useUsage.getState().set(profileId, usage));
    const onFocus = () => {
      for (const profileId of useUsage.getState().wanted) {
        void client.call('usage.get', { refresh: false, profileId }).then(({ usage }) => useUsage.getState().set(profileId, usage)).catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, [client]);
}

/** Loads a profile's usage the first time a band shows it. */
function useUsageFor(profileId: string): UsageSnapshot | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client || useUsage.getState().usage.has(profileId)) return;
    // Fetching starts a short-lived Claude Code process; let the window finish starting first.
    const timer = setTimeout(
      () => void client.call('usage.get', { refresh: false, profileId }).then(({ usage }) => useUsage.getState().set(profileId, usage)).catch(() => {}),
      performance.now() < 10_000 ? 2_000 : 0,
    );
    return () => clearTimeout(timer);
  }, [client, profileId]);
  return useUsage((s) => s.usage.get(profileId) ?? null);
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
 * Plan usage above the composer, like the claude-stats mod: one pill per window with a ring and a
 * reset countdown. Shows the limits of the given Claude profile (the default one when omitted).
 */
export function UsageBand({ profileId }: { profileId?: string | null }) {
  const defaultId = useProfiles((s) => s.defaultId);
  const id = profileId ?? defaultId;
  const usage = useUsageFor(id);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!usage) return null;
  const limits = visibleLimits(usage.limits);
  const extra = usage.extraUsage;
  if (limits.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-usage-band data-usage-profile={id}>
      <ProfileBadge profileId={id} className="mr-0.5 text-[12px]" />
      {limits.map((limit) => (
        <div
          key={`${limit.kind}:${limit.scope ?? ''}`}
          className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[12px]"
          title={limit.resetsAt ? `Resets ${new Date(limit.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : undefined}
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
