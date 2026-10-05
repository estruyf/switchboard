import { Box, ChevronDown, GitBranch } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Effort, ImageAttachment, PermissionMode, ProjectInspection, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ChoiceMenu } from './ChoiceMenu.tsx';
import { EffortDial } from './EffortDial.tsx';
import { FolderPicker } from './FolderPicker.tsx';
import { MODE_DESCRIPTION, MODE_DOT, routeHint } from './route.ts';
import { guessHome } from '../../lib/format.ts';
import { MODE_CHOICES, MODE_LABEL, nextMode, worktreeSlug } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { realBranch, toRows, useSessions } from '../../state/sessionsStore.ts';
import { Composer } from '../composer/Composer.tsx';
import { UsageBand } from '../UsageBand.tsx';

const DEFAULTS_KEY = 'newSession.defaults';

interface Defaults {
  cwd: string | null;
  model: string;
  permissionMode: PermissionMode;
  effort: Effort | '';
  workspace: 'current' | 'worktree';
  baseRef: 'fresh' | 'head';
}

const INITIAL: Defaults = { cwd: null, model: '', permissionMode: 'default', effort: '', workspace: 'current', baseRef: 'fresh' };

function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<{ value: T; label: string; title?: string }>; onChange(v: T): void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-md border border-border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={disabled}
          data-segment={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-px text-[11.5px] whitespace-nowrap disabled:opacity-50 ${value === o.value ? 'bg-accent/15 text-text' : 'text-muted hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One patch point in the route tray: the dashed cable from the previous socket (if any), a dot, then its control. */
function Socket({ children, on = true, cable = false, grow = false }: { children: ReactNode; on?: boolean; cable?: boolean; grow?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${grow ? 'flex-1 basis-40' : 'shrink-0'}`}>
      {cable && <span className="mr-0.5 w-4 shrink-0 border-t border-dashed border-faint" aria-hidden />}
      <span className={`size-[7px] shrink-0 rounded-full border ${on ? 'border-accent-ink bg-accent-ink' : 'border-faint bg-transparent'}`} aria-hidden />
      {children}
    </div>
  );
}

const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />;

/**
 * Starts a new Claude Code session. The prompt is the main thing; around it sit the project,
 * the model, effort and permission mode, and the route the session takes (this checkout or a worktree).
 */
export function NewSessionView() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const sessions = useSessions((s) => s.sessions);
  const select = useSessions((s) => s.select);
  const models = useHosts((s) => s.models);
  const hosts = useHosts((s) => s.hosts);
  const live = useSessions((s) => s.live);
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
  // The branch each folder had checked out in its latest session (worktree sessions are on their own branch).
  const branches = useMemo(() => {
    const latest = new Map<string, { at: number; branch: string | null }>();
    for (const s of sessions.values()) {
      if (s.worktree || (latest.get(s.projectRoot)?.at ?? -1) >= s.updatedAt) continue;
      latest.set(s.projectRoot, { at: s.updatedAt, branch: realBranch(s.gitBranch) });
    }
    return new Map([...latest].map(([root, { branch }]) => [root, branch]));
  }, [sessions]);

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
  const branch = inspection?.branch ?? (d.cwd ? (branches.get(d.cwd) ?? null) : null);
  const folderBranches = useMemo(() => (d.cwd && inspection?.branch ? new Map(branches).set(d.cwd, inspection.branch) : branches), [branches, d.cwd, inspection]);

  // Sessions with a Claude Code process in this project right now, newest first.
  const running = useMemo(
    () => (d.cwd ? toRows(sessions, live, hosts).filter((row) => row.live && row.projectRoot === d.cwd).sort((a, b) => b.updatedAt - a.updatedAt) : []),
    [sessions, live, hosts, d.cwd],
  );

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

  const modelLabel = d.model ? (models.find((m) => m.value === d.model)?.displayName ?? d.model) : 'Default model';
  const toolbar = (
    <>
      <ChoiceMenu
        name="model"
        value={d.model}
        onChange={(model) => update({ model })}
        title="Model"
        choices={[
          { value: '', label: 'Default model', description: models.find((m) => m.value === 'default')?.description || 'What Claude Code would pick' },
          ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName, description: m.description })),
        ]}
        width={260}
      >
        <Box size={13} className="shrink-0" />
        <span className="max-w-40 truncate">{modelLabel}</span>
        <ChevronDown size={12} className="shrink-0 text-faint" />
      </ChoiceMenu>
      <Divider />
      <EffortDial value={d.effort} onChange={(effort) => update({ effort })} />
      <Divider />
      <ChoiceMenu
        name="mode"
        value={d.permissionMode}
        onChange={(permissionMode) => update({ permissionMode })}
        title="Permission mode (⇧Tab in the prompt)"
        choices={MODE_CHOICES.map((mode) => ({ value: mode, label: MODE_LABEL[mode], description: MODE_DESCRIPTION[mode], dot: MODE_DOT[mode] }))}
        width={280}
      >
        <span className={`size-2 shrink-0 rounded-full ${MODE_DOT[d.permissionMode] ?? 'bg-faint'}`} />
        {MODE_LABEL[d.permissionMode]}
        <kbd className="font-sans text-[11px] text-faint">⇧Tab</kbd>
      </ChoiceMenu>
    </>
  );

  const folderProblem = !d.cwd ? 'Pick where Claude should work.' : !inspection ? 'Checking folder…' : !inspection.exists ? 'This folder no longer exists.' : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* No title bar: the eyebrow names the view. The strip keeps the window draggable. */}
      <div className="drag h-13 shrink-0" />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-2 pb-12" data-new-session-view>
          <FolderPicker value={d.cwd} folders={recent} home={home} branches={folderBranches} onChange={(cwd) => update({ cwd })} onChooseOther={() => void chooseFolder()} />

          <div>
            <div onInput={(e) => setDraftPrompt((e.target as HTMLTextAreaElement).value ?? '')} className="relative z-10">
              <Composer
                cwd={d.cwd}
                commands={commands}
                placeholder="What should Claude work on?"
                submitLabel="Start session"
                submitHint="⌘↵"
                large
                autoFocus
                toolbar={toolbar}
                onCycleMode={() => update({ permissionMode: nextMode(d.permissionMode) })}
                disabledReason={!client ? 'Connecting to the engine…' : !d.cwd ? 'Choose a folder first' : inspection && !inspection.exists ? 'That folder no longer exists' : null}
                onSubmit={create}
              />
            </div>

            <div className="mx-3 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 rounded-b-lg border border-t-0 border-border bg-sidebar px-3 py-1.5" data-route-tray>
              <Socket>
                <Segmented
                  label="Workspace"
                  value={useWorktree ? 'worktree' : 'current'}
                  onChange={(workspace) => update({ workspace })}
                  options={[
                    { value: 'current', label: 'This checkout', title: 'Work on the checked-out branch, like running `claude` here' },
                    { value: 'worktree', label: 'New worktree', title: canWorktree ? 'Claude Code creates a git worktree on a new branch' : 'Needs a git repository' },
                  ]}
                  disabled={!canWorktree}
                />
              </Socket>
              {useWorktree && (
                <>
                  <Socket cable>
                    <Segmented
                      label="Branch from"
                      value={d.baseRef}
                      onChange={(baseRef) => update({ baseRef })}
                      options={[
                        { value: 'fresh', label: 'from origin', title: "Branch from origin's default branch (Claude Code's default)" },
                        { value: 'head', label: 'HEAD', title: 'Branch from your current local HEAD, including unpushed commits' },
                      ]}
                    />
                  </Socket>
                </>
              )}
              <Socket cable grow on={useWorktree || !!branch}>
                <GitBranch size={12} className="shrink-0 text-faint" />
                {useWorktree ? (
                  <label className="flex min-w-0 flex-1 items-center font-mono text-[11.5px]" title={`Branch worktree-${effectiveName} in .claude/worktrees/${effectiveName}`}>
                    <span className="text-faint">worktree-</span>
                    <input
                      data-worktree-name
                      aria-label="Worktree name"
                      className="w-full min-w-0 rounded border border-transparent bg-transparent px-0.5 text-text outline-none placeholder:text-faint hover:border-border focus:border-accent-ink/60"
                      value={nameTouched ? worktreeName : ''}
                      placeholder={worktreeSlug(draftPrompt)}
                      spellCheck={false}
                      onChange={(e) => {
                        setNameTouched(e.target.value !== '');
                        setWorktreeName(e.target.value.replace(/[^A-Za-z0-9._-]/g, '-'));
                      }}
                    />
                  </label>
                ) : (
                  <span className="truncate font-mono text-[11.5px] text-muted" data-route-branch>
                    {branch ?? (inspection && !inspection.isGitRepo ? 'no git' : '…')}
                  </span>
                )}
              </Socket>
              <span className="ml-auto pl-2">
                <UsageBand compact />
              </span>
            </div>
          </div>

          <div className="-mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[11.5px] text-faint" data-route-hint>
            <span className="min-w-0 truncate">
              {folderProblem ?? routeHint({ worktree: useWorktree, isGitRepo: canWorktree, branch, name: effectiveName })}
            </span>
            {running.length > 0 && (
              <span className="flex min-w-0 items-center gap-1.5" data-running-here>
                <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />
                <span className="min-w-0 truncate" title={running.map((r) => r.title).join('\n')}>
                  {running.length === 1 ? `“${running[0]!.title}” is running here` : `${running.length} sessions running here`}
                </span>
                <button type="button" onClick={() => select(running[0]!.id)} className="shrink-0 text-link hover:underline" data-open-running>
                  Open
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
