import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { LogLevel, UsageSnapshot } from '@switchboard/protocol';
import type { SdkRuntime } from './hostManager.ts';

/** The usage report attached to the assistant message that answers `/usage` (SDKUsageReport). */
interface RawUsageReport {
  rate_limits?: {
    limits?: Array<{
      kind?: unknown;
      group?: unknown;
      percent?: unknown;
      resets_at?: unknown;
      scope?: { model?: { display_name?: unknown } | null; surface?: { display_name?: unknown } | null } | null;
      severity?: unknown;
      is_active?: unknown;
    }> | null;
    extra_usage?: { is_enabled?: unknown; monthly_limit?: unknown; used_credits?: unknown; currency?: unknown } | null;
  } | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Maps Claude Code's usage report to the snapshot the UI shows. Null when there's no plan data. */
export function toUsageSnapshot(report: RawUsageReport | undefined, now = Date.now()): UsageSnapshot | null {
  const limits = report?.rate_limits?.limits;
  if (!Array.isArray(limits)) return null;
  const extra = report?.rate_limits?.extra_usage;
  return {
    fetchedAt: now,
    limits: limits.flatMap((l) => {
      const percent = num(l.percent);
      const kind = str(l.kind);
      if (percent === null || !kind) return [];
      const resets = str(l.resets_at);
      const parsed = resets ? Date.parse(resets) : NaN;
      return [
        {
          kind,
          group: str(l.group) ?? kind,
          percent,
          resetsAt: Number.isFinite(parsed) ? parsed : null,
          scope: str(l.scope?.model?.display_name) ?? str(l.scope?.surface?.display_name),
          severity: str(l.severity) ?? 'normal',
          isActive: l.is_active === true,
        },
      ];
    }),
    extraUsage: extra
      ? { enabled: extra.is_enabled === true, usedCredits: num(extra.used_credits), monthlyLimit: num(extra.monthly_limit), currency: str(extra.currency) }
      : null,
  };
}

export interface UsageMonitorOptions {
  sdk: () => Promise<SdkRuntime>;
  env: () => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  onChange: (usage: UsageSnapshot | null) => void;
  log: (level: LogLevel, message: string) => void;
  /** Helper processes register in the live registry while they run; tell the engine to ignore them. */
  ephemeral: { add(sessionId: string): void; delete(sessionId: string): void };
  refreshMs?: number;
  /** Retry after a failed fetch (default 30 s). */
  retryMs?: number;
}

const STALE_MS = 60_000;

/**
 * Plan usage for the band above the composer. Asks Claude Code for its
 * `/usage` report in a short-lived process that writes no transcript
 * (~1 s, no tokens), every few minutes and shortly after activity.
 */
export class UsageMonitor {
  private snapshot: UsageSnapshot | null = null;
  private error: string | null = null;
  private inflight: Promise<void> | undefined;
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: UsageMonitorOptions) {}

  async get(refresh: boolean): Promise<{ usage: UsageSnapshot | null; error: string | null }> {
    const stale = !this.snapshot || Date.now() - this.snapshot.fetchedAt > STALE_MS;
    if (refresh || stale) await this.fetch();
    this.start();
    return { usage: this.snapshot, error: this.error };
  }

  /** Something used the plan (a turn finished, a rate-limit update): refresh soon, once. */
  nudge(): void {
    if (this.nudgeTimer) return;
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = undefined;
      void this.fetch();
    }, 15_000);
    this.nudgeTimer.unref?.();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** After a failed fetch: once more in 30 s rather than waiting for the next 5-minute refresh. */
  private retrySoon(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.fetch();
    }, this.options.retryMs ?? 30_000);
    this.retryTimer.unref?.();
  }

  private start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.fetch(), this.options.refreshMs ?? 5 * 60_000);
    this.interval.unref?.();
  }

  private fetch(): Promise<void> {
    this.inflight ??= this.run().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async run(): Promise<void> {
    const sessionId = randomUUID();
    this.options.ephemeral.add(sessionId);
    let query: ReturnType<SdkRuntime['query']> | undefined;
    try {
      const [env, claudePath, sdk] = await Promise.all([this.options.env(), this.options.claudePath(), this.options.sdk()]);
      const prompt: AsyncIterable<SDKUserMessage> = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'user', message: { role: 'user', content: '/usage' }, parent_tool_use_id: null };
          await new Promise(() => {});
        },
      };
      query = sdk.query({
        prompt,
        options: { cwd: homedir(), env, pathToClaudeCodeExecutable: claudePath, sessionId, persistSession: false, settingSources: ['user'] },
      });
      let report: RawUsageReport | undefined;
      const deadline = setTimeout(() => query?.close(), 20_000);
      for await (const message of query) {
        if (message.type === 'assistant' && 'usage_report' in message && message.usage_report) report = message.usage_report as RawUsageReport;
        if (message.type === 'result') break;
      }
      clearTimeout(deadline);
      const next = toUsageSnapshot(report);
      this.error = next ? null : 'No plan usage available (API key sign-in, or the usage endpoint is unreachable)';
      if (!next) {
        // A miss (the endpoint can be briefly unavailable): keep the last good numbers, try again soon.
        this.retrySoon();
      } else if (JSON.stringify(next.limits) !== JSON.stringify(this.snapshot?.limits) || !this.snapshot) {
        this.snapshot = next;
        this.options.onChange(next);
      } else {
        this.snapshot = next;
      }
    } catch (error) {
      this.error = (error as Error).message;
      this.options.log('debug', `Usage fetch failed: ${this.error}`);
      this.retrySoon();
    } finally {
      query?.close();
      // Let the helper leave the live registry before we stop hiding it.
      setTimeout(() => this.options.ephemeral.delete(sessionId), 5_000).unref?.();
    }
  }
}
