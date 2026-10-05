import type { Effort, PermissionMode, SessionHostInfo } from '@switchboard/protocol/client';
import { ContextMeter } from './ContextMeter.tsx';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { MODE_CHOICES, MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';

const STATE_LABEL: Record<SessionHostInfo['state'], string> = {
  starting: 'Starting…',
  running: 'Working',
  'needs-you': 'Needs you',
  idle: 'Ready',
  closed: 'Stopped',
  error: 'Failed',
};

const EFFORTS: Array<{ value: Effort; label: string }> = [
  { value: 'low', label: 'Low effort' },
  { value: 'medium', label: 'Medium effort' },
  { value: 'high', label: 'High effort' },
  { value: 'xhigh', label: 'Extra-high effort' },
  { value: 'max', label: 'Max effort' },
];

const select = 'h-6 min-w-0 shrink rounded-md border border-transparent bg-transparent px-1 text-[11px] text-muted outline-none hover:border-border focus:border-accent-ink/60';

/** Model, permission mode, effort and context for a session running in this app. */
export function StatusBar({ host }: { host: SessionHostInfo }) {
  const connection = useEngineConnection();
  const models = useHosts((s) => s.models);
  const client = connection.status === 'connected' ? connection.client : null;
  const active = host.state !== 'closed' && host.state !== 'error';
  const modelKnown = models.some((m) => m.value === host.model);
  // Effort only applies to models that support it (unknown models get the benefit of the doubt).
  const supportsEffort = models.find((m) => m.value === host.model)?.supportsEffort ?? true;

  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-1 text-[11px] text-faint">
      <span className={host.state === 'error' ? 'text-error' : host.state === 'needs-you' ? 'text-warn' : ''} title={host.error ?? undefined}>
        {STATE_LABEL[host.state]}
      </span>
      <span>·</span>
      <select
        className={select}
        disabled={!active || !client}
        value={modelKnown ? (host.model ?? '') : ''}
        onChange={(e) => void client?.call('session.setModel', { sessionId: host.sessionId, model: e.target.value || null })}
        title="Model"
      >
        {!modelKnown && <option value="">{host.model ?? 'Default model'}</option>}
        {models.map((m) => (
          <option key={m.value} value={m.value}>
            {m.displayName}
          </option>
        ))}
      </select>
      <select
        className={select}
        disabled={!active || !client}
        value={host.permissionMode}
        onChange={(e) => void client?.call('session.setPermissionMode', { sessionId: host.sessionId, mode: e.target.value as PermissionMode })}
        title="Permission mode (⇧Tab in the composer)"
      >
        {[...new Set([...MODE_CHOICES, host.permissionMode])].map((mode) => (
          <option key={mode} value={mode}>
            {MODE_LABEL[mode]}
          </option>
        ))}
      </select>
      {supportsEffort && (
        <select
          className={select}
          disabled={!active || !client}
          value={host.effort ?? ''}
          data-effort-select
          onChange={(e) => void client?.call('session.setEffort', { sessionId: host.sessionId, effort: (e.target.value || null) as Effort | null })}
          title="How hard Claude thinks (this session only)"
        >
          <option value="">Default effort</option>
          {EFFORTS.map((effort) => (
            <option key={effort.value} value={effort.value}>
              {effort.label}
            </option>
          ))}
        </select>
      )}
      <span className="flex-1" />
      <ContextMeter
        sessionId={host.sessionId}
        live={host.contextTokens !== null && host.contextMax ? { tokens: host.contextTokens, max: host.contextMax, percent: host.contextPercent ?? (host.contextTokens / host.contextMax) * 100 } : null}
        messages={[]}
      />
      {active && (
        <button
          type="button"
          onClick={() => void client?.call('session.close', { sessionId: host.sessionId })}
          className="shrink-0 rounded px-1.5 whitespace-nowrap hover:bg-border/60 hover:text-muted"
          title="Stop the Claude Code process for this session. The conversation is kept; sending a message resumes it."
        >
          Stop session
        </button>
      )}
    </div>
  );
}
