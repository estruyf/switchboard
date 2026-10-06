import type { Effort, PermissionMode, SessionHostInfo } from '@switchboard/protocol/client';
import { ContextMeter } from './ContextMeter.tsx';
import { Select } from '../ui/Select.tsx';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { findModelOption } from '../../lib/models.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
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

const select = 'h-6 min-w-0 shrink rounded-md border border-transparent bg-transparent px-1 text-[11px] text-muted outline-none enabled:hover:border-border focus:border-accent-ink/60 aria-expanded:border-accent-ink/60';

/** Model, permission mode, effort and context for a session running in this app. */
export function StatusBar({ host }: { host: SessionHostInfo }) {
  const connection = useEngineConnection();
  const models = useHosts((s) => s.models);
  const client = connection.status === 'connected' ? connection.client : null;
  const active = host.state !== 'closed' && host.state !== 'error';
  // Claude Code reports full ids (`claude-opus-5-5`); show them as the alias row they resolve to.
  const modelOption = findModelOption(models, host.model);
  // Effort only applies to models that support it (unknown models get the benefit of the doubt).
  const supportsEffort = modelOption?.supportsEffort ?? true;

  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-1 text-[11px] text-faint">
      <span className={host.state === 'error' ? 'text-error' : host.state === 'needs-you' ? 'text-warn' : 'text-muted'} data-tooltip={host.error ?? undefined}>
        {STATE_LABEL[host.state]}
      </span>
      {active && host.backgroundTasks.length > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="shrink-0 text-ok" data-tooltip={host.backgroundTasks.map((t) => t.description).join('\n')} data-status-background>
            {host.backgroundTasks.length === 1 ? '1 background task' : `${host.backgroundTasks.length} background tasks`}
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <Select
        label="Model"
        className={select}
        disabled={!active || !client}
        value={modelOption?.value ?? ''}
        onChange={(model) => void client?.call('session.setModel', { sessionId: host.sessionId, model: model || null })}
        options={[...(modelOption ? [] : [{ value: '', label: host.model ?? 'Default model' }]), ...models.map((m) => ({ value: m.value, label: m.displayName }))]}
        dataAttrs={{ 'data-session-model-select': true }}
      />
      <Select
        label="Permission mode"
        tooltip="Permission mode (⇧Tab in the composer)"
        className={select}
        disabled={!active || !client}
        value={host.permissionMode}
        onChange={(mode) => void client?.call('session.setPermissionMode', { sessionId: host.sessionId, mode })}
        options={[...new Set([...MODE_CHOICES, host.permissionMode])].map((mode) => ({
          value: mode,
          label: MODE_LABEL[mode],
          icon: <span className={`size-2 rounded-full ${MODE_DOT[mode] ?? 'bg-faint'}`} />,
        }))}
        dataAttrs={{ 'data-permission-mode-select': true }}
      />
      {supportsEffort && (
        <Select
          label="Effort"
          tooltip="How hard Claude thinks (this session only)"
          className={select}
          disabled={!active || !client}
          value={host.effort ?? ''}
          onChange={(effort) => void client?.call('session.setEffort', { sessionId: host.sessionId, effort: effort || null })}
          options={[{ value: '' as const, label: 'Default effort' }, ...EFFORTS]}
          dataAttrs={{ 'data-effort-select': true }}
        />
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
          className="shrink-0 rounded px-1.5 whitespace-nowrap text-muted hover:bg-border/60 hover:text-text"
          data-tooltip="Stop the Claude Code process for this session. The conversation is kept; sending a message resumes it."
        >
          Stop session
        </button>
      )}
    </div>
  );
}
