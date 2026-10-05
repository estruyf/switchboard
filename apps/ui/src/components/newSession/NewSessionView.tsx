import { useEffect, useMemo, useRef, useState } from 'react';
import type { Effort, ImageAttachment, PermissionMode, ProjectInspection, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { FolderPicker } from './FolderPicker.tsx';
import { basename, guessHome } from '../../lib/format.ts';
import { MODE_CHOICES, MODE_LABEL, worktreeSlug } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Composer } from '../composer/Composer.tsx';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { UsageBand } from '../UsageBand.tsx';
import { globalPatch, INITIAL_CHOICES, readGlobals, sameDefaults, startingChoices, toProjectDefaults, type Choices, type GlobalChoices } from './choices.ts';

const DEFAULTS_KEY = 'newSession.defaults';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const field = 'h-7 rounded-md border border-border bg-card px-2 text-[12px] text-text outline-none focus:border-accent-ink/60 disabled:opacity-50';

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

/**
 * Starts a new Claude Code session: pick a project (or any folder) and options, then write the first
 * message. Options start from the project's defaults; fields it leaves unset use the choices last made here.
 */
export function NewSessionView() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const select = useSessions((s) => s.select);
  const models = useHosts((s) => s.models);
  const [cwd, setCwd] = useState<string | null>(null);
  const [globals, setGlobals] = useState<GlobalChoices>(INITIAL_CHOICES);
  const [d, setD] = useState<Choices>({ ...INITIAL_CHOICES, branch: '' });
  const [loaded, setLoaded] = useState(false);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [branches, setBranches] = useState<{ current: string | null; branches: string[] }>({ current: null, branches: [] });
  const [worktreeName, setWorktreeName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [addAsProject, setAddAsProject] = useState(true);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** A profile chosen for this session only (null: the project's, else the default). */
  const [profileOverride, setProfileOverride] = useState<string | null>(null);
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = useProfiles((s) => s.defaultId);
  /** The folder the user changed options for: until the folder changes, late-arriving defaults never override their choices. */
  const touchedFor = useRef<string | null>(null);

  const projects = useProjects((s) => s.projects);
  const projectFilter = useProjects((s) => s.filter);
  const newSessionIn = useProjects((s) => s.newSessionIn);
  const reloadProjects = useProjects((s) => s.reload);
  const yours = useMemo(() => addedProjects(projects), [projects]);
  const folders = useMemo(() => yours.filter((p) => p.exists).map((p) => p.root), [yours]);
  const home = useMemo(() => guessHome(projects.keys()), [projects]);
  const project = cwd ? projects.get(cwd) : undefined;
  const isProject = project?.added ?? false;
  const projectDefaults = isProject ? project!.defaults : null;
  const defaultsKey = JSON.stringify(projectDefaults);
  const projectProfile = project?.profileId && profiles.some((p) => p.id === project.profileId) ? project.profileId : null;
  const profileId = (profileOverride && profiles.some((p) => p.id === profileOverride) ? profileOverride : null) ?? projectProfile ?? defaultProfile;
  const profile = profiles.find((p) => p.id === profileId);

  // Restore the last folder and global choices.
  useEffect(() => {
    if (!client || loaded) return;
    void client.call('appState.get', { key: DEFAULTS_KEY }).then(({ value }) => {
      const stored = readGlobals(value);
      setGlobals(stored.globals);
      setCwd((current) => current ?? stored.cwd);
      setLoaded(true);
    });
  }, [client, loaded]);
  // The palette or Projects view asked for a folder.
  useEffect(() => {
    if (!newSessionIn) return;
    setCwd(newSessionIn);
    useProjects.getState().startIn(null);
  }, [newSessionIn]);
  useEffect(() => {
    // Only fills an empty field. A project filtered in the sidebar is the natural default.
    const preferred = projectFilter && folders.includes(projectFilter) ? projectFilter : folders[0];
    if (loaded && !cwd && preferred) setCwd((c) => c ?? preferred);
  }, [loaded, folders, cwd, projectFilter]);
  // A new folder starts from its project's defaults (again when they arrive or change, until the user changes something).
  useEffect(() => {
    if (!loaded || touchedFor.current === cwd) return;
    setD(startingChoices(globals, projectDefaults));
  }, [loaded, cwd, defaultsKey, globals]);

  // Inspect the folder (git? branch?), load its commands and branches, and pre-warm Claude Code there.
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    setInspection(null);
    setBranches({ current: null, branches: [] });
    setSavedNote(null);
    void client.call('projects.inspect', { path: cwd }).then((r) => !cancelled && setInspection(r));
    void client.call('session.commands', { cwd, profileId }).then((r) => !cancelled && setCommands(r.commands));
    client.call('git.branches', { cwd }).then(
      (r) => !cancelled && setBranches(r),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, profileId]);
  useEffect(() => {
    if (client && cwd && d.workspace === 'current' && !d.branch) void client.call('session.prewarm', { cwd, profileId });
  }, [client, cwd, d.workspace, d.branch, profileId]);

  const persist = (next: GlobalChoices, folder: string | null) => void client?.call('appState.set', { key: DEFAULTS_KEY, value: { ...next, cwd: folder } });

  // Always build on the latest state: two quick changes (folder, then model) must not undo each other.
  const update = (patch: Partial<Choices>) => {
    touchedFor.current = cwd;
    setSavedNote(null);
    setD((current) => ({ ...current, ...patch }));
    const remembered = globalPatch(patch, projectDefaults);
    if (Object.keys(remembered).length) {
      setGlobals((current) => {
        const next = { ...current, ...remembered };
        persist(next, cwd);
        return next;
      });
    }
  };
  const changeFolder = (folder: string) => {
    touchedFor.current = null;
    setProfileOverride(null);
    setCwd(folder);
    setAddAsProject(true);
    persist(globals, folder);
  };

  const chooseFolder = async () => {
    const picked = await window.switchboard?.pickFolder(cwd ?? undefined);
    if (picked) changeFolder(picked);
  };

  const canWorktree = inspection?.isGitRepo ?? false;
  const useWorktree = d.workspace === 'worktree' && canWorktree;
  const effectiveName = nameTouched ? worktreeName : worktreeSlug(draftPrompt);
  const checkoutBranch = !useWorktree && d.branch && d.branch !== branches.current ? d.branch : null;
  const branchOptions = d.branch && !branches.branches.includes(d.branch) ? [d.branch, ...branches.branches] : branches.branches;
  const asDefaults = toProjectDefaults({ ...d, workspace: useWorktree ? 'worktree' : d.workspace });
  const unsaved = isProject && !sameDefaults(asDefaults, project!.defaults);

  const saveAsProjectDefault = async () => {
    if (!client || !cwd) return;
    await client.call('projects.setDefaults', { root: cwd, defaults: asDefaults });
    reloadProjects();
    setSavedNote(`Saved as ${project?.name ?? basename(cwd)}'s defaults`);
  };

  const create = async (text: string, attachments: ImageAttachment[]) => {
    if (!client || !cwd) throw new Error('Choose a folder first');
    const { sessionId } = await client.call('session.create', {
      cwd,
      prompt: text,
      attachments,
      model: d.model || null,
      permissionMode: d.permissionMode,
      effort: d.effort || null,
      worktree: useWorktree ? { name: effectiveName || worktreeSlug(text), baseRef: d.baseRef } : null,
      checkoutBranch,
      profileId,
    });
    if (!isProject && addAsProject && inspection?.exists) {
      await client.call('projects.add', { path: cwd }).then(reloadProjects, () => {});
    }
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
              <FolderPicker value={cwd} folders={folders} home={home} onChange={changeFolder} onChooseOther={() => void chooseFolder()} />
            </div>
            <p className="text-[11px] text-faint">
              {!cwd
                ? folders.length
                  ? 'Pick where Claude should work.'
                  : 'Pick where Claude should work. Folders you add as projects are listed here.'
                : !inspection
                  ? 'Checking folder…'
                  : !inspection.exists
                    ? 'This folder no longer exists.'
                    : inspection.isGitRepo
                      ? `Git repository${inspection.branch ? ` on ${inspection.branch}` : ''}`
                      : 'Not a git repository'}
            </p>
            {cwd && !isProject && inspection?.exists && (
              <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] text-muted">
                <input type="checkbox" checked={addAsProject} onChange={(e) => setAddAsProject(e.target.checked)} data-add-as-project />
                Add {basename(cwd)} to your projects
              </label>
            )}
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
              {!useWorktree && branches.branches.length > 0 && (
                <select
                  className={field}
                  value={d.branch}
                  onChange={(e) => update({ branch: e.target.value })}
                  title="Check out a branch before the session starts. Git keeps uncommitted changes, or refuses when they conflict."
                  data-branch-select
                >
                  <option value="">On {branches.current ?? 'the current checkout'}</option>
                  {branchOptions
                    .filter((b) => b !== branches.current)
                    .map((b) => (
                      <option key={b} value={b}>
                        Check out {b}
                      </option>
                    ))}
                </select>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {profiles.length > 1 && (
              <label className={`${field} flex items-center gap-1.5 pr-0`} title={profile?.account?.email ? `Signed in as ${profile.account.email}` : 'Claude profile'}>
                {profile && <span className={`size-2 shrink-0 rounded-full ${PROFILE_DOT[profile.color]}`} aria-hidden />}
                <select
                  className="h-full min-w-0 bg-transparent pr-1 outline-none"
                  value={profileId}
                  onChange={(e) => setProfileOverride(e.target.value)}
                  aria-label="Claude profile"
                  data-profile-select
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === (projectProfile ?? defaultProfile) ? (projectProfile ? ' (project)' : ' (default)') : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            <select className={field} value={d.effort} onChange={(e) => update({ effort: e.target.value as Effort | '' })} title="Effort" data-new-effort>
              <option value="">Default effort</option>
              {EFFORTS.map((e) => (
                <option key={e} value={e}>
                  {e} effort
                </option>
              ))}
            </select>
          </div>

          {isProject && (
            <div className="-mt-2 flex min-h-5 flex-wrap items-center gap-2 text-[11px] text-faint" data-project-defaults-bar>
              {savedNote ? (
                <span className="text-accent-ink">{savedNote}</span>
              ) : unsaved ? (
                <>
                  <span>These choices apply to this session only.</span>
                  <button type="button" onClick={() => void saveAsProjectDefault()} className="text-link hover:underline" data-save-project-defaults>
                    Save as project default
                  </button>
                </>
              ) : (
                <span>{Object.values(project!.defaults).some((v) => v !== null) ? `${project!.name}'s defaults` : `${project!.name} uses your last choices`}</span>
              )}
            </div>
          )}

          <UsageBand profileId={profileId} />
          <div onInput={(e) => setDraftPrompt((e.target as HTMLTextAreaElement).value ?? '')}>
            <Composer
              cwd={cwd}
              commands={commands}
              placeholder="What should Claude work on?"
              submitLabel="Start session"
              autoFocus
              disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'Choose a folder first' : inspection && !inspection.exists ? 'That folder no longer exists' : null}
              onSubmit={create}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
