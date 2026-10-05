import { useEffect, useMemo, useRef, useState } from 'react';
import type { Effort, ImageAttachment, PermissionMode, ProjectInspection, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename, guessHome, tildify } from '../../lib/format.ts';
import { MODE_CHOICES, MODE_LABEL, worktreeSlug } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Composer } from '../composer/Composer.tsx';

const DEFAULTS_KEY = 'newSession.defaults';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface Defaults {
  cwd: string | null;
  model: string;
  permissionMode: PermissionMode;
  effort: Effort | '';
  workspace: 'current' | 'worktree';
  baseRef: 'fresh' | 'head';
}

const INITIAL: Defaults = { cwd: null, model: '', permissionMode: 'default', effort: '', workspace: 'current', baseRef: 'fresh' };

const field = 'h-7 rounded-md border border-border bg-card px-2 text-[12px] text-text outline-none focus:border-accent/60 disabled:opacity-50';

function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: Array<{ value: T; label: string; title?: string }>; onChange(v: T): void; disabled?: boolean }) {
  return (
    <div className="flex rounded-md border border-border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-0.5 text-[12px] disabled:opacity-50 ${value === o.value ? 'bg-accent/15 text-text' : 'text-muted hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Starts a new Claude Code session: pick a folder and options, then write the first message. */
export function NewSessionView() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const sessions = useSessions((s) => s.sessions);
  const select = useSessions((s) => s.select);
  const models = useHosts((s) => s.models);
  const [d, setD] = useState<Defaults>(INITIAL);
  const [loaded, setLoaded] = useState(false);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [worktreeName, setWorktreeName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [draftPrompt, setDraftPrompt] = useState('');
  /** Set once the user changes anything, so late-arriving saved defaults never override their choices. */
  const touched = useRef(false);

  const projects = useProjects((s) => s.projects);
  const projectFilter = useProjects((s) => s.filter);
  // Recent project folders first, then folders added by hand that have no sessions yet.
  const recent = useMemo(() => {
    const latest = new Map<string, number>();
    for (const s of sessions.values()) {
      if (!s.projectRoot.startsWith('/')) continue;
      latest.set(s.projectRoot, Math.max(latest.get(s.projectRoot) ?? 0, s.updatedAt));
    }
    const added = [...projects.values()].filter((p) => p.added && p.exists && !latest.has(p.root)).map((p) => p.root);
    return [...[...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([root]) => root), ...added];
  }, [sessions, projects]);
  const home = useMemo(() => guessHome(recent), [recent]);

  // Restore last choices.
  useEffect(() => {
    if (!client || loaded) return;
    void client.call('appState.get', { key: DEFAULTS_KEY }).then(({ value }) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && !touched.current) setD({ ...INITIAL, ...(value as Partial<Defaults>) });
      setLoaded(true);
    });
  }, [client, loaded]);
  useEffect(() => {
    // Only fills an empty field; re-checked inside the updater because a user change may be queued.
    // A project filtered in the sidebar is the natural default.
    const preferred = projectFilter && recent.includes(projectFilter) ? projectFilter : recent[0];
    if (loaded && !d.cwd && preferred) setD((c) => (c.cwd ? c : { ...c, cwd: preferred }));
  }, [loaded, recent, d.cwd, projectFilter]);

  // Inspect the folder (git? branch?), load its commands and pre-warm Claude Code there.
  useEffect(() => {
    if (!client || !d.cwd) return;
    let cancelled = false;
    setInspection(null);
    void client.call('projects.inspect', { path: d.cwd }).then((r) => !cancelled && setInspection(r));
    void client.call('session.commands', { cwd: d.cwd }).then((r) => !cancelled && setCommands(r.commands));
    if (d.workspace === 'current') void client.call('session.prewarm', { cwd: d.cwd });
    return () => {
      cancelled = true;
    };
  }, [client, d.cwd, d.workspace]);

  // Always build on the latest state: two quick changes (folder, then model) must not undo each other.
  const update = (patch: Partial<Defaults>) => {
    touched.current = true;
    setD((current) => {
      const next = { ...current, ...patch };
      void client?.call('appState.set', { key: DEFAULTS_KEY, value: { ...next } });
      return next;
    });
  };

  const chooseFolder = async () => {
    const picked = await window.switchboard?.pickFolder(d.cwd ?? undefined);
    if (picked) update({ cwd: picked });
  };

  const canWorktree = inspection?.isGitRepo ?? false;
  const useWorktree = d.workspace === 'worktree' && canWorktree;
  const effectiveName = nameTouched ? worktreeName : worktreeSlug(draftPrompt);

  const create = async (text: string, attachments: ImageAttachment[]) => {
    if (!client || !d.cwd) throw new Error('Choose a folder first');
    const { sessionId } = await client.call('session.create', {
      cwd: d.cwd,
      prompt: text,
      attachments,
      model: d.model || null,
      permissionMode: d.permissionMode,
      effort: d.effort || null,
      worktree: useWorktree ? { name: effectiveName || worktreeSlug(text), baseRef: d.baseRef } : null,
    });
    select(sessionId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag flex h-13 shrink-0 items-center border-b border-border px-6">
        <h1 className="text-[13px] font-semibold">New session</h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-6 pb-4">
          <div className="grid gap-1.5">
            <label className="text-[11px] tracking-wide text-faint uppercase">Folder</label>
            <div className="flex min-w-0 gap-2">
              <select data-folder-select className={`${field} w-0 min-w-0 flex-1 truncate`} value={d.cwd ?? ''} onChange={(e) => update({ cwd: e.target.value || null })}>
                {!d.cwd && <option value="">Choose a folder…</option>}
                {d.cwd && !recent.includes(d.cwd) && <option value={d.cwd}>{tildify(d.cwd, home)}</option>}
                {recent.map((root) => (
                  <option key={root} value={root}>
                    {basename(root)}  —  {tildify(root, home)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void chooseFolder()} className={`${field} hover:bg-border/50`}>
                Choose…
              </button>
            </div>
            <p className="text-[11px] text-faint">
              {!d.cwd
                ? 'Pick where Claude should work.'
                : !inspection
                  ? 'Checking folder…'
                  : !inspection.exists
                    ? 'This folder no longer exists.'
                    : inspection.isGitRepo
                      ? `Git repository${inspection.branch ? ` on ${inspection.branch}` : ''}`
                      : 'Not a git repository'}
            </p>
          </div>

          <div className="grid gap-1.5">
            <label className="text-[11px] tracking-wide text-faint uppercase">Workspace</label>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={useWorktree ? 'worktree' : 'current'}
                onChange={(workspace) => update({ workspace })}
                options={[
                  { value: 'current', label: 'Current folder', title: 'Work on the checked-out branch, like running `claude` here' },
                  { value: 'worktree', label: 'New worktree', title: canWorktree ? 'Claude Code creates a git worktree on a new branch' : 'Needs a git repository' },
                ]}
                disabled={!canWorktree}
              />
              {useWorktree && (
                <>
                  <input
                    className={`${field} w-56 font-mono`}
                    value={effectiveName}
                    placeholder="worktree name"
                    onChange={(e) => {
                      setNameTouched(true);
                      setWorktreeName(e.target.value.replace(/[^A-Za-z0-9._-]/g, '-'));
                    }}
                    title={`Branch worktree-${effectiveName} in .claude/worktrees/${effectiveName}`}
                  />
                  <Segmented
                    value={d.baseRef}
                    onChange={(baseRef) => update({ baseRef })}
                    options={[
                      { value: 'fresh', label: 'From origin', title: "Branch from origin's default branch (Claude Code's default)" },
                      { value: 'head', label: 'From HEAD', title: 'Branch from your current local HEAD, including unpushed commits' },
                    ]}
                  />
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select data-model-select className={field} value={d.model} onChange={(e) => update({ model: e.target.value })} title="Model">
              <option value="">Default model</option>
              {models
                .filter((m) => m.value !== 'default')
                .map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.displayName}
                  </option>
                ))}
            </select>
            <select className={field} value={d.permissionMode} onChange={(e) => update({ permissionMode: e.target.value as PermissionMode })} title="Permission mode">
              {MODE_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
            <select className={field} value={d.effort} onChange={(e) => update({ effort: e.target.value as Effort | '' })} title="Effort">
              <option value="">Default effort</option>
              {EFFORTS.map((e) => (
                <option key={e} value={e}>
                  {e} effort
                </option>
              ))}
            </select>
          </div>

          <div onInput={(e) => setDraftPrompt((e.target as HTMLTextAreaElement).value ?? '')}>
            <Composer
              cwd={d.cwd}
              commands={commands}
              placeholder="What should Claude work on?"
              submitLabel="Start session"
              autoFocus
              disabledReason={!client ? 'Connecting to the engine…' : !d.cwd ? 'Choose a folder first' : inspection && !inspection.exists ? 'That folder no longer exists' : null}
              onSubmit={create}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
