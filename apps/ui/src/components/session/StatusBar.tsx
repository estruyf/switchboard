import type { Effort, SessionHostInfo } from '@switchboard/protocol/client';
import { Select } from '../ui/Select.tsx';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { findModelOption } from '../../lib/models.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';

const EFFORTS: Array<{ value: Effort; label: string }> = [
  { value: 'low', label: 'Effort: low' },
  { value: 'medium', label: 'Effort: medium' },
  { value: 'high', label: 'Effort: high' },
  { value: 'xhigh', label: 'Effort: extra high' },
  { value: 'max', label: 'Effort: max' },
];

/** A ghost chip: no border until hovered or open, so the composer stays quiet. */
const chip = 'h-6 min-w-0 shrink rounded-md border border-transparent bg-transparent px-1.5 text-[12px] text-muted outline-none enabled:hover:bg-border/50 enabled:hover:text-text focus-visible:border-accent-ink/60 aria-expanded:bg-border/50 aria-expanded:text-text';

/**
 * Model, permission mode and effort for a session running in this app, as compact chips in the
 * composer card's bottom-left corner, and its background tasks when there are any.
 */
export function SessionControls({ host }: { host: SessionHostInfo }) {
  const connection = useEngineConnection();
  const models = useHosts((s) => s.models);
  const client = connection.status === 'connected' ? connection.client : null;
  const active = host.state !== 'closed' && host.state !== 'error';
  // Claude Code reports full ids (`claude-opus-5-5`); show them as the alias row they resolve to.
  const modelOption = findModelOption(models, host.model);
  // Effort only applies to models that support it (unknown models get the benefit of the doubt).
  const supportsEffort = modelOption?.supportsEffort ?? true;

  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden" data-session-controls>
      <Select
        label="Model"
        className={chip}
        disabled={!active || !client}
        value={modelOption?.value ?? ''}
        onChange={(model) => void client?.call('session.setModel', { sessionId: host.sessionId, model: model || null })}
        options={[...(modelOption ? [] : [{ value: '', label: host.model ?? 'Default model' }]), ...models.map((m) => ({ value: m.value, label: m.displayName }))]}
        dataAttrs={{ 'data-session-model-select': true }}
      />
      <Select
        label="Permission mode"
        tooltip="Permission mode (⇧Tab in the composer)"
        className={chip}
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
          className={chip}
          disabled={!active || !client}
          value={host.effort ?? ''}
          onChange={(effort) => void client?.call('session.setEffort', { sessionId: host.sessionId, effort: effort || null })}
          options={[{ value: '' as const, label: 'Effort: default' }, ...EFFORTS]}
          dataAttrs={{ 'data-effort-select': true }}
        />
      )}
      {active && host.backgroundTasks.length > 0 && (
        <span className="ml-1 shrink-0 truncate text-[11.5px] text-ok" data-tooltip={host.backgroundTasks.map((t) => t.description).join('\n')} data-status-background>
          {host.backgroundTasks.length === 1 ? '1 background task' : `${host.backgroundTasks.length} background tasks`}
        </span>
      )}
    </div>
  );
}
