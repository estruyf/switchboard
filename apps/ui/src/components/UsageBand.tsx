import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { UsageLimit, UsageSnapshot } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useProfiles } from '../state/profilesStore.ts';
import { levelOf, LEVEL_COLOR, LEVEL_FILL, LEVEL_TEXT } from '../lib/levels.ts';
import { ProfileBadge, ProfileDot } from './profiles/ProfileBadge.tsx';
import { countdown, limitLabel, spokenLimit, visibleLimits } from './usageFormat.ts';

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

function Ring({ percent }: { percent: number }) {
  const r = 6.5;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--sb-border)" strokeWidth="2.5" />
      <circle cx="8" cy="8" r={r} fill="none" stroke={LEVEL_COLOR[levelOf(percent)]} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${filled} ${circumference}`} />
    </svg>
  );
}

const money = (minorUnits: number, currency: string | null) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 2 }).format(minorUnits / 100);

/** The footer's short names: "5h" for the session window, "Week" for the weekly one (with its scope, such as a model). */
function footerLabel(limit: UsageLimit): string {
  const label = limitLabel(limit);
  return label.startsWith('7d') ? `Week${label.slice(2)}` : label;
}

/**
 * Plan usage, like the claude-stats mod: one pill per window with a ring and a reset countdown.
 * Shows the limits of the given Claude profile (the default one when omitted).
 * `compact` drops the pills for a single line (`6% 5h · 4h44m`), for the new session's route tray.
 * `footer`: tiny bars (`5h ▬ 9%   Week ▬ 18%`) for the quiet line under a session's composer, reset times in the tooltips;
 * the profile is shown next to it by the caller.
 */
export function UsageBand({ profileId, compact = false, footer = false }: { profileId?: string | null; compact?: boolean; footer?: boolean }) {
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
  // Each pill is a meter, read as one sentence ("5-hour limit: 6% used, resets in 4h3m") instead of "6% 5h".
  const meter = (limit: UsageLimit) => ({
    role: 'meter',
    'aria-label': spokenLimit(limit, now),
    'aria-valuenow': Math.round(Math.min(100, Math.max(0, limit.percent))),
    'aria-valuemin': 0,
    'aria-valuemax': 100,
  });
  const resetTitle = (limit: UsageLimit) =>
    limit.resetsAt
      ? `Resets ${new Date(limit.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (in ${countdown(limit.resetsAt, now)})`
      : undefined;

  if (footer) {
    return (
      <div role="group" aria-label="Plan usage" className="flex min-w-0 items-center gap-4 text-meta text-muted" data-usage-band data-usage-profile={id}>
        {limits.map((limit) => {
          const level = levelOf(limit.percent);
          return (
            <div key={`${limit.kind}:${limit.scope ?? ''}`} {...meter(limit)} className="flex items-center gap-1.5 whitespace-nowrap" data-tooltip={resetTitle(limit)}>
              <span>{footerLabel(limit)}</span>
              {/* 48x4 bar; the fill takes the level's colour (green, orange, red). */}
              <span className="h-1 w-12 overflow-hidden rounded-full bg-border @max-[860px]:hidden" aria-hidden>
                <span className={`block h-full rounded-full ${LEVEL_FILL[level]}`} style={{ width: `${Math.min(100, Math.max(2, limit.percent))}%` }} />
              </span>
              <span className={`tabular-nums ${LEVEL_TEXT[level]}`}>{Math.round(limit.percent)}%</span>
            </div>
          );
        })}
        {extra?.enabled && extra.usedCredits !== null && extra.usedCredits > 0 && (
          <span className="whitespace-nowrap @max-[860px]:hidden" data-tooltip={extra.monthlyLimit !== null ? `Extra usage this month, of ${money(extra.monthlyLimit, extra.currency)}` : 'Extra usage this month'}>
            <span className="text-ok">{money(extra.usedCredits, extra.currency)}</span> extra
          </span>
        )}
      </div>
    );
  }

  if (compact) {
    return (
      <div role="group" aria-label="Plan usage" className="flex shrink-0 items-center divide-x divide-border text-meta" data-usage-band data-usage-profile={id}>
        {limits.map((limit) => (
          <div
            key={`${limit.kind}:${limit.scope ?? ''}`}
            {...meter(limit)}
            className="flex items-center gap-1.5 px-2.5 whitespace-nowrap first:pl-0 last:pr-0"
            data-tooltip={resetTitle(limit)}
          >
            <Ring percent={limit.percent} />
            <span className="font-semibold text-muted tabular-nums">{Math.round(limit.percent)}%</span>
            <span className="text-muted">
              {limitLabel(limit)}
              {limit.resetsAt && ` · ${countdown(limit.resetsAt, now)}`}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="group" aria-label="Plan usage" className="flex flex-wrap items-center gap-1.5" data-usage-band data-usage-profile={id}>
      <ProfileBadge profileId={id} className="mr-0.5 text-ui" />
      {limits.map((limit) => (
        <div
          key={`${limit.kind}:${limit.scope ?? ''}`}
          {...meter(limit)}
          className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-ui"
          data-tooltip={resetTitle(limit)}
        >
          <Ring percent={limit.percent} />
          <span className="font-semibold tabular-nums">{Math.round(limit.percent)}%</span>
          <span className="text-muted">
            {limitLabel(limit)}
            {limit.resetsAt && ` · resets ${countdown(limit.resetsAt, now)}`}
          </span>
        </div>
      ))}
      {extra?.enabled && extra.usedCredits !== null && extra.usedCredits > 0 && (
        <div className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-ui">
          <span className="font-semibold text-ok">{money(extra.usedCredits, extra.currency)}</span>
          <span className="text-muted">extra usage{extra.monthlyLimit !== null && ` of ${money(extra.monthlyLimit, extra.currency)}`}</span>
        </div>
      )}
    </div>
  );
}

/**
 * One Claude profile's plan usage as a card, for Home: its name and account, a full-width bar per
 * limit in the level's colour with the reset countdown, and any extra usage. `activity` is a line
 * about its sessions ("2 working · 5 today").
 */
export function ProfileUsageCard({ profileId, activity }: { profileId: string; activity: string }) {
  const profile = useProfiles((s) => s.profiles.find((p) => p.id === profileId));
  const usage = useUsageFor(profileId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const limits = usage ? visibleLimits(usage.limits) : [];
  const extra = usage?.extraUsage;
  return (
    <article className="grid content-start gap-2.5 rounded-xl border border-border bg-card p-3" aria-label={`${profile?.name ?? 'Profile'}: usage`} data-home-profile={profileId}>
      <div className="flex min-w-0 items-center gap-2">
        {/* Always named here (the badge elsewhere hides itself while there is only one profile). */}
        {profile && <ProfileDot color={profile.color} size={8} />}
        <span className="truncate text-ui font-semibold">{profile?.name ?? 'Claude'}</span>
        {profile?.account?.email && <span className="min-w-0 truncate text-meta text-faint">{profile.account.email}</span>}
      </div>
      <p className="text-meta text-muted">{activity}</p>
      {limits.length === 0 ? (
        <p className="text-meta text-faint">{usage ? 'No plan limits reported.' : 'Loading usage…'}</p>
      ) : (
        <div className="grid gap-2" role="group" aria-label="Plan usage">
          {limits.map((limit) => {
            const level = levelOf(limit.percent);
            return (
              <div
                key={`${limit.kind}:${limit.scope ?? ''}`}
                role="meter"
                aria-label={spokenLimit(limit, now)}
                aria-valuenow={Math.round(Math.min(100, Math.max(0, limit.percent)))}
                aria-valuemin={0}
                aria-valuemax={100}
                className="grid gap-1"
              >
                <div className="flex items-baseline gap-2 text-meta">
                  <span className="text-muted">{footerLabel(limit)}</span>
                  <span className="flex-1" />
                  {limit.resetsAt && <span className="text-faint">resets in {countdown(limit.resetsAt, now)}</span>}
                  <span className={`font-semibold tabular-nums ${LEVEL_TEXT[level] || 'text-text'}`}>{Math.round(limit.percent)}%</span>
                </div>
                <span className="h-1.5 overflow-hidden rounded-full bg-selected" aria-hidden>
                  <span className={`block h-full rounded-full ${LEVEL_FILL[level]}`} style={{ width: `${Math.min(100, Math.max(2, limit.percent))}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {extra?.enabled && extra.usedCredits !== null && extra.usedCredits > 0 && (
        <p className="text-meta text-muted">
          <span className="font-semibold text-ok">{money(extra.usedCredits, extra.currency)}</span> extra usage{extra.monthlyLimit !== null && ` of ${money(extra.monthlyLimit, extra.currency)}`}
        </p>
      )}
    </article>
  );
}
