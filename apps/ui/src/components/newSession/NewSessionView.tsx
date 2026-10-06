import { Cpu, GitBranch, Link2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ImageAttachment, ProjectInspection, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ChoiceMenu } from './ChoiceMenu.tsx';
import { EffortDial } from './EffortDial.tsx';
import { FolderPicker } from './FolderPicker.tsx';
import { MODE_DESCRIPTION, routeHint } from './route.ts';
import { basename, guessHome } from '../../lib/format.ts';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL, nextMode, worktreeSlug } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useLinks } from '../../state/linksStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { realBranch, toRows, useSessions } from '../../state/sessionsStore.ts';
import { inScope } from '../../state/sidebarRows.ts';
import { Composer } from '../composer/Composer.tsx';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { UsageBand } from '../UsageBand.tsx';
import { linkNoticeText } from './linkNotice.ts';
import { globalPatch, INITIAL_CHOICES, readGlobals, sameDefaults, startingChoices, toProjectDefaults, type Choices, type GlobalChoices } from './choices.ts';

const DEFAULTS_KEY = 'newSession.defaults';

function Segmented<T extends string>({ label, value, options, onChange, disabled, mono }: { label: string; value: T; options: Array<{ value: T; label: string; title?: string }>; onChange(v: T): void; disabled?: boolean; mono?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-md border border-border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-tooltip={o.title}
          disabled={disabled}
          data-segment={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-px text-[11.5px] whitespace-nowrap disabled:opacity-50 ${mono ? 'font-mono' : ''} ${value === o.value ? 'bg-border text-text' : 'text-muted hover:text-text'}`}
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
      {/* The first socket is the source (filled); the ones patched to it are rings. */}
      <span className={`size-[7px] shrink-0 rounded-full border-[1.5px] ${!on ? 'border-faint' : cable ? 'border-accent-ink' : 'border-accent-ink bg-accent-ink'}`} aria-hidden />
      {children}
    </div>
  );
}

const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />;

/**
 * Starts a new Claude Code session. The prompt is the main thing; around it sit the project, the
 * profile, model, effort and permission mode, and the route the session takes (this checkout, another
 * branch or a worktree). Options start from the project's defaults; fields it leaves unset use the
 * choices last made here.
 */
export function NewSessionView() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const sessions = useSessions((s) => s.sessions);
  const select = useSessions((s) => s.select);
  const models = useHosts((s) => s.models);
  const focusRequest = useSessions((s) => s.newSessionRequest);
  const hosts = useHosts((s) => s.hosts);
  const live = useSessions((s) => s.live);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const [cwd, setCwd] = useState<string | null>(null);
  const [globals, setGlobals] = useState<GlobalChoices>(INITIAL_CHOICES);
  const [d, setD] = useState<Choices>({ ...INITIAL_CHOICES, branch: '' });
  const [loaded, setLoaded] = useState(false);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [gitBranches, setGitBranches] = useState<{ current: string | null; branches: string[] }>({ current: null, branches: [] });
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
  /** A `switchboard://` link chose the folder (or chose to leave it empty): the remembered or preferred folder must not fill it. */
  const folderFromLink = useRef(false);
  const linkRequest = useLinks((s) => s.newSession);
  /** Replaces the prompt: a link's prompt, or clearing it. */
  const [preset, setPreset] = useState<{ text: string; seq: number } | undefined>(undefined);
  const presets = useRef(0);
  /** The prompt came from a link and hasn't been sent or cleared: its length, to say so under the message box. */
  const [linkPrompt, setLinkPrompt] = useState<number | null>(null);
  /** A link's `repo`: being looked up, or not found among your checkouts. */
  const [linkRepo, setLinkRepo] = useState<{ repo: string; state: 'looking' | 'missing' } | null>(null);
  /** The link named no folder: rather than guess, the folder is left empty and the picker opens. */
  const [linkNoFolder, setLinkNoFolder] = useState(false);
  const [pickerRequest, setPickerRequest] = useState(0);
  /** An `autostart` link's prompt, sent as soon as its folder and the project's defaults are in place. */
  const [pendingStart, setPendingStart] = useState<string | null>(null);

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
  // The branch each folder had checked out in its latest session (worktree sessions are on their own branch).
  const lastBranches = useMemo(() => {
    const latest = new Map<string, { at: number; branch: string | null }>();
    for (const s of sessions.values()) {
      if (s.worktree || (latest.get(s.projectRoot)?.at ?? -1) >= s.updatedAt) continue;
      latest.set(s.projectRoot, { at: s.updatedAt, branch: realBranch(s.gitBranch) });
    }
    return new Map([...latest].map(([root, { branch }]) => [root, branch]));
  }, [sessions]);

  // Restore the last folder and global choices.
  useEffect(() => {
    if (!client || loaded) return;
    void client.call('appState.get', { key: DEFAULTS_KEY }).then(({ value }) => {
      const stored = readGlobals(value);
      setGlobals(stored.globals);
      if (!folderFromLink.current) setCwd((current) => current ?? stored.cwd);
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
    if (loaded && !cwd && preferred && !folderFromLink.current) setCwd((c) => c ?? preferred);
  }, [loaded, folders, cwd, projectFilter]);
  // A `switchboard://new-session` link: fill in its folder and prompt. Unless it says `autostart`, nothing
  // is sent; the user reads it and presses Enter.
  useEffect(() => {
    if (!linkRequest) return;
    const link = useLinks.getState().take();
    if (!link) return;
    // The store has already turned a project name into its folder.
    folderFromLink.current = true;
    touchedFor.current = null;
    setProfileOverride(null);
    setAddAsProject(true);
    setCwd(link.cwd);
    setLinkRepo(link.repo ? { repo: link.repo, state: 'looking' } : null);
    setLinkNoFolder(!link.cwd && !link.repo);
    if (!link.cwd && !link.repo) setPickerRequest((n) => n + 1);
    // Starting needs a folder the link chose; a link without one waits for the user like any other.
    setPendingStart(link.autostart && link.prompt && (link.cwd || link.repo) ? link.prompt : null);
    if (link.prompt) {
      setPreset({ text: link.prompt, seq: ++presets.current });
      setDraftPrompt(link.prompt);
      setLinkPrompt(link.prompt.length);
    }
  }, [linkRequest]);
  // Find a checkout of the link's repository among your projects and folders with sessions.
  const lookingFor = linkRepo?.state === 'looking' ? linkRepo.repo : null;
  useEffect(() => {
    if (!client || !lookingFor) return;
    let cancelled = false;
    client.call('projects.findByRepo', { repo: lookingFor }).then(
      ({ root }) => {
        if (cancelled) return;
        if (root) {
          setCwd(root);
          setLinkRepo(null);
        } else {
          setLinkRepo({ repo: lookingFor, state: 'missing' });
          setPendingStart(null);
        }
      },
      () => {
        if (cancelled) return;
        setLinkRepo({ repo: lookingFor, state: 'missing' });
        setPendingStart(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, lookingFor]);
  // Clearing the prompt ends the notice: whatever is typed next is the user's own.
  useEffect(() => {
    if (linkPrompt !== null && !draftPrompt) setLinkPrompt(null);
  }, [draftPrompt, linkPrompt]);
  const clearLinkPrompt = () => {
    setPendingStart(null);
    setPreset({ text: '', seq: ++presets.current });
    setDraftPrompt('');
    setLinkPrompt(null);
  };

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
    setGitBranches({ current: null, branches: [] });
    setSavedNote(null);
    void client.call('projects.inspect', { path: cwd }).then((r) => !cancelled && setInspection(r));
    void client.call('session.commands', { cwd, profileId }).then((r) => !cancelled && setCommands(r.commands));
    client.call('git.branches', { cwd }).then(
      (r) => !cancelled && setGitBranches(r),
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
    setLinkRepo(null);
    setLinkNoFolder(false);
    setPendingStart(null);
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
  const branch = inspection?.branch ?? (cwd ? (lastBranches.get(cwd) ?? null) : null);
  const folderBranches = useMemo(() => (cwd && inspection?.branch ? new Map(lastBranches).set(cwd, inspection.branch) : lastBranches), [lastBranches, cwd, inspection]);
  const checkoutBranch = !useWorktree && d.branch && d.branch !== gitBranches.current ? d.branch : null;
  const branchOptions = d.branch && !gitBranches.branches.includes(d.branch) ? [d.branch, ...gitBranches.branches] : gitBranches.branches;
  const asDefaults = toProjectDefaults({ ...d, workspace: useWorktree ? 'worktree' : d.workspace });
  const unsaved = isProject && !sameDefaults(asDefaults, project!.defaults);

  const saveAsProjectDefault = async () => {
    if (!client || !cwd) return;
    await client.call('projects.setDefaults', { root: cwd, defaults: asDefaults });
    reloadProjects();
    setSavedNote(`Saved as ${project?.name ?? basename(cwd)}'s defaults`);
  };

  // Sessions with a Claude Code process in this project right now, newest first. Like the
  // sidebar, sessions started outside Switchboard only count when the scope shows them.
  const running = useMemo(
    () => (cwd ? toRows(sessions, live, hosts).filter((row) => row.live && row.projectRoot === cwd && inScope(row, scope)).sort((a, b) => b.updatedAt - a.updatedAt) : []),
    [sessions, live, hosts, cwd, scope],
  );

  /** `fromLink`: started by an `autostart` link, which never adds the folder to your projects. */
  const create = async (text: string, attachments: ImageAttachment[], fromLink = false) => {
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
    if (!isProject && addAsProject && !fromLink && inspection?.exists) {
      await client.call('projects.add', { path: cwd }).then(reloadProjects, () => {});
    }
    select(sessionId);
  };

  // An `autostart` link: start once the folder is checked and the options are the project's defaults
  // (they settle a render after the folder changes), exactly as if the user had pressed Enter.
  const projectsLoaded = useProjects((s) => s.loaded);
  const settled = JSON.stringify(d) === JSON.stringify(startingChoices(globals, projectDefaults));
  useEffect(() => {
    if (pendingStart === null || !client || !cwd || !loaded || !projectsLoaded || !settled || lookingFor || inspection?.path !== cwd) return;
    const text = pendingStart;
    setPendingStart(null);
    // A folder that is gone can't start; the prompt stays filled in to start elsewhere.
    if (!inspection.exists) return;
    create(text, [], true).catch((error: Error) => useLinks.getState().fail(`Couldn't start the session: ${error.message}`));
  }, [pendingStart, client, cwd, loaded, projectsLoaded, settled, lookingFor, inspection]);

  const modelLabel = d.model ? (models.find((m) => m.value === d.model)?.displayName ?? d.model) : 'Default model';
  const toolbar = (
    <>
      {profiles.length > 1 && (
        <>
          <ChoiceMenu
            name="profile"
            value={profileId}
            onChange={(id) => setProfileOverride(id)}
            title={profile?.account?.email ? `Claude profile · signed in as ${profile.account.email}` : 'Claude profile'}
            heading="Profile"
            placement="up"
            choices={profiles.map((p) => ({
              value: p.id,
              label: `${p.name}${p.id === (projectProfile ?? defaultProfile) ? (projectProfile ? ' (project)' : ' (default)') : ''}`,
              description: p.account?.email ?? undefined,
              dot: PROFILE_DOT[p.color],
            }))}
            width={260}
          >
            {profile && <span className={`size-2 shrink-0 rounded-full ${PROFILE_DOT[profile.color]}`} aria-hidden />}
            <span className="max-w-32 truncate">{profile?.name ?? 'Profile'}</span>
          </ChoiceMenu>
          <Divider />
        </>
      )}
      <ChoiceMenu
        name="model"
        value={d.model}
        onChange={(model) => update({ model })}
        title="Model"
        heading="Model"
        placement="up"
        choices={[
          { value: '', label: 'Default model', description: models.find((m) => m.value === 'default')?.description || 'What Claude Code would pick' },
          ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName, description: m.description })),
        ]}
        width={260}
      >
        <Cpu size={14} className="shrink-0" />
        <span className="max-w-40 truncate">{modelLabel}</span>
      </ChoiceMenu>
      <Divider />
      <EffortDial value={d.effort} onChange={(effort) => update({ effort })} />
      <Divider />
      <ChoiceMenu
        name="mode"
        value={d.permissionMode}
        onChange={(permissionMode) => update({ permissionMode })}
        title="Permission mode (⇧Tab in the prompt)"
        heading="Permissions"
        placement="up"
        choices={MODE_CHOICES.map((mode) => ({ value: mode, label: MODE_LABEL[mode], description: MODE_DESCRIPTION[mode], dot: MODE_DOT[mode] }))}
        width={280}
      >
        <span className={`size-2 shrink-0 rounded-full ${MODE_DOT[d.permissionMode] ?? 'bg-faint'}`} />
        {MODE_LABEL[d.permissionMode]}
        <kbd className="font-sans text-[11px] text-faint">⇧Tab</kbd>
      </ChoiceMenu>
    </>
  );

  const folderProblem = !cwd
    ? linkNoFolder
      ? "The link doesn't say which project. Pick where Claude should work."
      : linkRepo
      ? linkRepo.state === 'looking'
        ? `Looking for a checkout of ${linkRepo.repo}…`
        : `None of your folders is a checkout of ${linkRepo.repo}. Pick where Claude should work.`
      : folders.length
      ? 'Pick where Claude should work.'
      : 'Pick where Claude should work. Folders you add as projects are listed here.'
    : !inspection ? 'Checking folder…' : !inspection.exists ? 'This folder no longer exists.' : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-drop-zone>
      {/* No title bar: the eyebrow names the view. The strip keeps the window draggable. */}
      <div className="drag h-13 shrink-0" />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-2 pb-12" data-new-session-view>
          <FolderPicker value={cwd} folders={folders} home={home} branches={folderBranches} onChange={changeFolder} onChooseOther={() => void chooseFolder()} openRequest={pickerRequest} />

          <div>
            <div onInput={(e) => setDraftPrompt((e.target as HTMLTextAreaElement).value ?? '')} className="relative z-10">
              <Composer
                cwd={cwd}
                commands={commands}
                placeholder="What should Claude work on?"
                submitLabel="Start session"
                submitHint="⌘↵"
                large
                autoFocus
                focusRequest={focusRequest}
                preset={preset}
                toolbar={toolbar}
                onCycleMode={() => update({ permissionMode: nextMode(d.permissionMode) })}
                disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'Choose a folder first' : inspection && !inspection.exists ? 'That folder no longer exists' : null}
                onSubmit={create}
              />
            </div>

            <div className="mx-3 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 rounded-b-lg border border-t-0 border-border bg-border/15 px-3 py-1.5" data-route-tray>
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
                    <span className="text-[11.5px] text-muted">from</span>
                    <Segmented
                      label="Branch from"
                      mono
                      value={d.baseRef}
                      onChange={(baseRef) => update({ baseRef })}
                      options={[
                        { value: 'fresh', label: 'origin', title: "Branch from origin's default branch (Claude Code's default)" },
                        { value: 'head', label: 'HEAD', title: 'Branch from your current local HEAD, including unpushed commits' },
                      ]}
                    />
                  </Socket>
                </>
              )}
              <Socket cable grow on={useWorktree || !!checkoutBranch || !!branch}>
                <GitBranch size={12} className="shrink-0 text-faint" />
                {useWorktree ? (
                  <label
                    className="flex h-6 min-w-0 flex-1 items-center rounded-md border border-border bg-card px-2 font-mono text-[11.5px] focus-within:border-accent-ink/60"
                    data-tooltip={`Branch worktree-${effectiveName} in .claude/worktrees/${effectiveName}`}
                  >
                    <span className="text-faint">worktree-</span>
                    <input
                      data-worktree-name
                      aria-label="Worktree name"
                      className="w-full min-w-0 bg-transparent text-text outline-none placeholder:text-faint"
                      value={nameTouched ? worktreeName : ''}
                      placeholder={worktreeSlug(draftPrompt)}
                      spellCheck={false}
                      onChange={(e) => {
                        setNameTouched(e.target.value !== '');
                        setWorktreeName(e.target.value.replace(/[^A-Za-z0-9._-]/g, '-'));
                      }}
                    />
                  </label>
                ) : gitBranches.branches.length > 0 ? (
                  <ChoiceMenu
                    name="branch"
                    value={checkoutBranch ?? ''}
                    onChange={(b) => update({ branch: b })}
                    title="Check out a branch before the session starts. Git keeps uncommitted changes, or refuses when they conflict."
                    heading="Branch"
                    choices={[
                      { value: '', label: `Stay on ${gitBranches.current ?? 'the current checkout'}` },
                      ...branchOptions.filter((b) => b !== gitBranches.current).map((b) => ({ value: b, label: `Check out ${b}` })),
                    ]}
                    width={280}
                  >
                    <span className="truncate font-mono text-[11.5px]" data-route-branch>
                      {checkoutBranch ?? branch ?? '…'}
                    </span>
                  </ChoiceMenu>
                ) : (
                  <span className="truncate font-mono text-[11.5px] text-muted" data-route-branch>
                    {branch ?? (inspection && !inspection.isGitRepo ? 'no git' : '…')}
                  </span>
                )}
              </Socket>
              <span className="ml-auto pl-2">
                <UsageBand compact profileId={profileId} />
              </span>
            </div>
          </div>

          {linkPrompt !== null && (
            <div className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-4 text-[11.5px] text-muted" data-link-notice role="status">
              <Link2 size={13} className="shrink-0 text-accent-ink" aria-hidden />
              <span className="min-w-0">{pendingStart !== null ? 'Starting a session with the prompt from an external link…' : linkNoticeText(linkPrompt)}</span>
              <button type="button" onClick={clearLinkPrompt} className="text-link hover:underline" data-clear-link-prompt>
                Clear
              </button>
            </div>
          )}

          <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 text-[11.5px] text-faint" data-route-hint>
            <span className="min-w-0 truncate">
              {folderProblem ?? routeHint({ worktree: useWorktree, isGitRepo: canWorktree, branch: checkoutBranch ?? branch, name: effectiveName })}
            </span>
            {running.length > 0 && (
              <span className="flex min-w-0 items-center gap-1.5" data-running-here>
                <span className="size-1.5 shrink-0 rounded-full bg-accent-ink" aria-hidden />
                <span className="min-w-0 truncate" data-tooltip={running.map((r) => r.title).join('\n')}>
                  <span className="text-muted">{running.length} running here</span> · {running[0]!.title}
                </span>
                <button type="button" onClick={() => select(running[0]!.id)} className="shrink-0 text-link hover:underline" data-open-running>
                  Open
                </button>
              </span>
            )}
          </div>

          {cwd && !isProject && inspection?.exists && (
            <Checkbox checked={addAsProject} onChange={setAddAsProject} className="-mt-3 w-fit px-4 text-[11.5px] text-muted" dataAttrs={{ 'data-add-as-project': true }}>
              Add {basename(cwd)} to your projects
            </Checkbox>
          )}
          {isProject && (
            <div className="-mt-3 flex min-h-5 flex-wrap items-center gap-2 px-4 text-[11.5px] text-faint" data-project-defaults-bar>
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
        </div>
      </div>
    </div>
  );
}
