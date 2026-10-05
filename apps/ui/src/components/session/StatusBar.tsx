import type { PermissionMode, SessionHostInfo } from '@switchboard/protocol/client';
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

const select = 'h-6 rounded-md border border-transparent bg-transparent px-1 text-[11px] text-muted outline-none hover:border-border focus:border-accent-ink/60';

/** Model, permission mode, context and cost for a session running in this app. */
export function StatusBar({ host }: { host: SessionHostInfo }) {
  const connection = useEngineConnection();
  const models = useHosts((s) => s.models);
  const client = connection.status === 'connected' ? connection.client : null;
  const active = host.state !== 'closed' && host.state !== 'error';
  const modelKnown = models.some((m) => m.value === host.model);

  return (
    <div className="flex h-7 items-center gap-2 px-1 text-[11px] text-faint">
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
      <span className="flex-1" />
      {host.contextPercent !== null && (
        <span title="Context window used" className={host.contextPercent > 80 ? 'text-warn' : ''}>
          {host.contextPercent}% context
        </span>
      )}
      {host.costUsd > 0 && <span title="Cost reported by Claude Code for this run">${host.costUsd.toFixed(2)}</span>}
      {active && (
        <button
          type="button"
          onClick={() => void client?.call('session.close', { sessionId: host.sessionId })}
          className="rounded px-1.5 hover:bg-border/60 hover:text-muted"
          title="Stop the Claude Code process for this session. The conversation is kept; sending a message resumes it."
        >
          Stop session
        </button>
      )}
    </div>
  );
}
