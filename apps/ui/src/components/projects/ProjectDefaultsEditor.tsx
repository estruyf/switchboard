import { useEffect, useState } from 'react';
import type { Effort, PermissionMode, ProjectDefaults } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { MODE_CHOICES, MODE_LABEL } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const field = 'h-7 min-w-0 rounded-md border border-border bg-bg px-2 text-[12px] text-text outline-none focus:border-accent-ink/60 disabled:opacity-50';
/** The value an unset field shows; unset fields use the choices last made in the New session view. */
const UNSET = '';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 @max-[560px]:grid-cols-1 @max-[560px]:gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-2">{children}</span>
    </label>
  );
}

/**
 * A project's defaults for new sessions. "Global default" leaves a field to the choices last
 * made in the New session view. Every change saves at once.
 */
export function ProjectDefaultsEditor({ root, defaults, isGitRepo, onSave }: { root: string; defaults: ProjectDefaults; isGitRepo: boolean; onSave(defaults: ProjectDefaults): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const models = useHosts((s) => s.models);
  const [branches, setBranches] = useState<{ current: string | null; branches: string[] }>({ current: null, branches: [] });

  useEffect(() => {
    if (!client || !isGitRepo) return;
    let cancelled = false;
    client.call('git.branches', { cwd: root }).then(
      (r) => !cancelled && setBranches(r),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, root, isGitRepo]);

  const set = (patch: Partial<ProjectDefaults>) => onSave({ ...defaults, ...patch });
  const nullable = <T extends string>(value: string) => (value === UNSET ? null : (value as T));
  const branchOptions = defaults.branch && !branches.branches.includes(defaults.branch) ? [defaults.branch, ...branches.branches] : branches.branches;

  return (
    <div className="grid gap-2.5" data-project-defaults={root}>
      <Row label="Model">
        <select className={field} value={defaults.model ?? UNSET} onChange={(e) => set({ model: nullable(e.target.value) })} data-default-model>
          <option value={UNSET}>Global default</option>
          {models
            .filter((m) => m.value !== 'default')
            .map((m) => (
              <option key={m.value} value={m.value}>
                {m.displayName}
              </option>
            ))}
          {defaults.model && !models.some((m) => m.value === defaults.model) && <option value={defaults.model}>{defaults.model}</option>}
        </select>
        <select className={field} value={defaults.effort ?? UNSET} onChange={(e) => set({ effort: nullable<Effort>(e.target.value) })} title="Effort" data-default-effort>
          <option value={UNSET}>Global effort</option>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e} effort
            </option>
          ))}
        </select>
      </Row>
      <Row label="Permissions">
        <select className={field} value={defaults.permissionMode ?? UNSET} onChange={(e) => set({ permissionMode: nullable<PermissionMode>(e.target.value) })} data-default-mode>
          <option value={UNSET}>Global default</option>
          {MODE_CHOICES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Workspace">
        <select
          className={field}
          value={defaults.workspace ?? UNSET}
          disabled={!isGitRepo && defaults.workspace !== 'worktree'}
          onChange={(e) => set({ workspace: nullable<'current' | 'worktree'>(e.target.value), ...(e.target.value === 'worktree' ? { branch: null } : {}) })}
          data-default-workspace
        >
          <option value={UNSET}>Global default</option>
          <option value="current">Current folder</option>
          <option value="worktree">New worktree</option>
        </select>
        {defaults.workspace !== 'current' && (
          <select
            className={field}
            value={defaults.baseRef ?? UNSET}
            disabled={!isGitRepo}
            onChange={(e) => set({ baseRef: nullable<'fresh' | 'head'>(e.target.value) })}
            title="What a new worktree branches from"
            data-default-base
          >
            <option value={UNSET}>Worktree base: global default</option>
            <option value="fresh">Worktree from origin</option>
            <option value="head">Worktree from HEAD</option>
          </select>
        )}
      </Row>
      {isGitRepo && defaults.workspace !== 'worktree' && (
        <Row label="Branch">
          <select className={field} value={defaults.branch ?? UNSET} onChange={(e) => set({ branch: nullable(e.target.value) })} data-default-branch>
            <option value={UNSET}>Keep what is checked out{branches.current ? ` (${branches.current})` : ''}</option>
            {branchOptions.map((b) => (
              <option key={b} value={b}>
                Check out {b}
              </option>
            ))}
          </select>
        </Row>
      )}
    </div>
  );
}
