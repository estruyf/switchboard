import { Folder, FolderGit2, GitBranch, Link2, PencilLine } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageAttachment, ProjectInspection, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ChoiceMenu } from './ChoiceMenu.tsx';
import { FolderPicker } from './FolderPicker.tsx';
import { routeHint } from './route.ts';
import { filterBranches } from '../worktree/branchMenu.ts';
import { basename, guessHome, shortAge } from '../../lib/format.ts';
import { nextMode, worktreeSlug } from '../../lib/modes.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useLinks } from '../../state/linksStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { inScope, rowStatus } from '../../state/sidebarRows.ts';
import { Composer } from '../composer/Composer.tsx';
import { ComposerChipRow } from '../composer/ComposerChips.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { OpenInButton } from '../OpenInButton.tsx';
import { UsageBand } from '../UsageBand.tsx';
import { linkNoticeText } from './linkNotice.ts';
import { activityByProject, latestBranches, pickUpRows, recentFirst, tileStatus } from './projectTiles.ts';
import { branchLabel, branchNote, freshBase } from './trayLabels.ts';
import { globalPatch, INITIAL_CHOICES, readGlobals, sameDefaults, startingChoices, toProjectDefaults, type Choices, type GlobalChoices } from './choices.ts';

const DEFAULTS_KEY = 'newSession.defaults';

/** The prompt typed here and not sent yet: it is still in the box after visiting a session or Settings. */
let unsentPrompt = '';

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
  const view = useSessions((s) => s.view);
  const [cwd, setCwd] = useState<string | null>(null);
  const [globals, setGlobals] = useState<GlobalChoices>(INITIAL_CHOICES);
  const [d, setD] = useState<Choices>({ ...INITIAL_CHOICES, branch: '' });
  const [loaded, setLoaded] = useState(false);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [gitBranches, setGitBranches] = useState<{ current: string | null; branches: string[] }>({ current: null, branches: [] });
  /** Where the checkout stands: the remote a fresh worktree branches from, its default branch, and how far the upstream is ahead. */
  const [gitStatus, setGitStatus] = useState<{ remote: string | null; baseBranch: string | null; behindUpstream: number | null } | null>(null);
  const [worktreeName, setWorktreeName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [draftPrompt, setDraftPrompt] = useState(unsentPrompt);
  /** The prompt was left here earlier: say so, with a way to clear it. */
  const [restored, setRestored] = useState(() => unsentPrompt.trim() !== '');
  const [initialText] = useState(unsentPrompt);
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
  const lastBranches = useMemo(() => latestBranches(sessions.values()), [sessions]);
  // The sessions the sidebar lists (sessions from other apps only when the scope shows them): the
  // tiles' status lines and "Pick up in" come from these.
  const rows = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const activity = useMemo(() => activityByProject(rows), [rows]);
  const recent = useMemo(
    () => recentFirst(folders, (root) => Math.max(projects.get(root)?.lastActivity ?? 0, activity.get(root)?.lastActivity ?? 0) || null),
    [folders, projects, activity],
  );
  const statusOf = (root: string) => tileStatus(activity.get(root), projects.get(root)?.lastActivity ?? null, Date.now());

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
  // The palette or Projects view asked for a folder (a session's git menu: in a new worktree).
  /** The folder that should start on "New worktree", until its defaults are in or the user changes something. */
  const worktreeFor = useRef<string | null>(null);
  useEffect(() => {
    if (!newSessionIn) return;
    worktreeFor.current = useProjects.getState().newSessionWorktree ? newSessionIn : null;
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
      setRestored(false);
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
  // Clearing the prompt ends the notices: whatever is typed next is the user's own.
  useEffect(() => {
    unsentPrompt = draftPrompt;
    if (draftPrompt) return;
    if (linkPrompt !== null) setLinkPrompt(null);
    setRestored(false);
  }, [draftPrompt, linkPrompt]);
  const clearPrompt = () => {
    setPendingStart(null);
    setPreset({ text: '', seq: ++presets.current });
    setDraftPrompt('');
    setLinkPrompt(null);
    setRestored(false);
  };

  // A new folder starts from its project's defaults (again when they arrive or change, until the user changes something).
  useEffect(() => {
    if (!loaded || touchedFor.current === cwd) return;
    const choices = startingChoices(globals, projectDefaults);
    setD(worktreeFor.current === cwd ? { ...choices, workspace: 'worktree' } : choices);
  }, [loaded, cwd, defaultsKey, globals]);

  // Inspect the folder (git? branch?), load its commands and branches, and pre-warm Claude Code there.
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    setInspection(null);
    setGitBranches({ current: null, branches: [] });
    setGitStatus(null);
    setSavedNote(null);
    void client.call('projects.inspect', { path: cwd }).then((r) => !cancelled && setInspection(r));
    void client.call('session.commands', { cwd, profileId }).then((r) => !cancelled && setCommands(r.commands));
    client.call('git.branches', { cwd }).then(
      (r) => !cancelled && setGitBranches(r),
      () => {},
    );
    client.call('worktree.status', { cwd }).then(
      (r) => !cancelled && setGitStatus({ remote: r.pushRemote, baseBranch: r.baseBranch, behindUpstream: r.behindUpstream }),
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
  const trayBranch = branchLabel({
    worktree: useWorktree,
    baseRef: d.baseRef,
    remote: gitStatus?.remote ?? null,
    baseBranch: gitStatus?.baseBranch ?? null,
    current: gitBranches.current ?? branch,
    checkoutBranch,
    isGitRepo: inspection?.isGitRepo ?? null,
  });

  const saveAsProjectDefault = async () => {
    if (!client || !cwd) return;
    await client.call('projects.setDefaults', { root: cwd, defaults: asDefaults });
    reloadProjects();
    setSavedNote(`Saved as ${project?.name ?? basename(cwd)}'s defaults`);
  };

  const pickUp = useMemo(() => (cwd ? pickUpRows(rows, cwd, Date.now()) : []), [rows, cwd]);

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
    // The view goes away before the composer empties itself, so forget the prompt here.
    unsentPrompt = '';
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
  // The same chip row as in a session.
  const controls = (
    <ComposerChipRow
      profile={{
        value: profileId,
        onChange: (id) => setProfileOverride(id),
        labelFor: (p) => `${p.name}${p.id === (projectProfile ?? defaultProfile) ? (projectProfile ? ' (project)' : ' (default)') : ''}`,
      }}
      model={{
        value: d.model,
        label: modelLabel,
        onChange: (model) => update({ model }),
        choices: [
          { value: '', label: 'Default model', description: models.find((m) => m.value === 'default')?.description || 'What Claude Code would pick' },
          ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName, description: m.description })),
        ],
      }}
      effort={{ value: d.effort, onChange: (effort) => update({ effort }) }}
      mode={{ value: d.permissionMode, onChange: (permissionMode) => update({ permissionMode }) }}
    />
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

  const projectName = cwd ? (project?.name ?? basename(cwd)) : null;
  const clearButton = (attr: 'data-clear-link-prompt' | 'data-clear-draft') => (
    <Button variant="quiet" size="sm" onClick={clearPrompt} className="-my-1 shrink-0" {...{ [attr]: true }}>
      Clear
    </Button>
  );
  // One notice at a time, the most pressing first: a missing folder, a prompt from a link, a saved default, a restored draft.
  const notice =
    cwd && inspection && !inspection.exists ? (
      <span className="min-w-0 truncate text-error" data-route-hint>
        {folderProblem}
      </span>
    ) : linkPrompt !== null ? (
      <Notice inline icon={<Link2 size={13} className="text-accent-ink" aria-hidden />} actions={clearButton('data-clear-link-prompt')} data-link-notice>
        {pendingStart !== null ? 'Starting a session with the prompt from an external link…' : linkNoticeText(linkPrompt)}
      </Notice>
    ) : savedNote ? (
      <span role="status" className="min-w-0 truncate text-accent-ink" data-saved-note>
        {savedNote}
      </span>
    ) : restored ? (
      <Notice inline icon={<PencilLine size={13} className="text-accent-ink" aria-hidden />} actions={clearButton('data-clear-draft')} data-draft-notice>
        Your unsent prompt from before.
      </Notice>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-drop-zone>
      {/* No title bar: the heading names the view. The strip keeps the window draggable. */}
      <div className="drag flex h-13 shrink-0 items-center justify-end px-4">
        {/* To look around the whole project before (or instead of) asking Claude. */}
        {cwd && inspection?.path === cwd && inspection.exists && <OpenInButton path={cwd} shortcut={false} />}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-2 pb-12" data-new-session-view>
          <div className="text-center">
            {/* The one hero heading in the app, a little larger than text-title. */}
            <h1 className="text-hero leading-tight font-semibold">Where do we start?</h1>
            <p className="mt-1 text-ui text-muted">
              <Kbd keys="⌘1" /> to <Kbd keys="⌘9" /> picks a project, or start typing its name
            </p>
          </div>

          <FolderPicker
            value={cwd}
            folders={recent}
            home={home}
            branches={folderBranches}
            statusOf={statusOf}
            onChange={changeFolder}
            onChooseOther={() => void chooseFolder()}
            shortcuts={view === 'new'}
            openRequest={pickerRequest}
          />

          {/* The message box with its route strip on top: the strip's bottom edge is the card's top border. */}
          <div className="[&>div>.rounded-xl]:rounded-t-none">
            <div className="flex min-h-10 min-w-0 items-center gap-1 rounded-t-xl border border-b-0 border-border bg-border/25 px-1.5 py-1" data-route-tray>
              {/* Where and branch depend on the folder: until there is one, say why instead of showing empty controls. */}
              {!cwd ? (
                <span className="min-w-0 flex-1 px-1.5 py-0.5 text-ui text-muted" data-route-placeholder data-route-hint>
                  {folderProblem}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPickerRequest((n) => n + 1)}
                    aria-label={`Project: ${projectName}. Change project`}
                    data-tooltip={cwd}
                    data-route-project
                    className="flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 text-ui font-semibold text-text hover:bg-border/50"
                  >
                    <ProjectIcon project={project} root={cwd} size={16} />
                    <span className="truncate">{projectName}</span>
                  </button>
                  <span aria-hidden className="text-faint">
                    /
                  </span>
                  <ChoiceMenu
                    name="workspace"
                    value={useWorktree ? 'worktree' : 'current'}
                    onChange={(workspace) => update({ workspace })}
                    title={routeHint({ worktree: useWorktree, isGitRepo: canWorktree, branch: checkoutBranch ?? branch, name: effectiveName })}
                    heading="Where"
                    chevron
                    width={300}
                    choices={[
                      { value: 'current', label: 'Current checkout', description: 'Edits land in your working copy' },
                      { value: 'worktree', label: 'New worktree', description: canWorktree ? 'Isolated copy, branched from the one you pick' : 'Needs a git repository', disabled: !canWorktree },
                    ]}
                    extra={
                      useWorktree && (
                        <label
                          className="mx-3 mt-1 mb-1 flex h-6 items-center rounded-md border border-border bg-bg px-2 font-mono text-meta focus-within:border-accent-ink"
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
                      )
                    }
                    actions={
                      isProject
                        ? [{ label: 'Save as project default', hint: unsaved ? undefined : 'Saved', disabled: !unsaved, data: { 'data-save-project-defaults': true }, onSelect: () => void saveAsProjectDefault() }]
                        : undefined
                    }
                  >
                    {useWorktree ? <FolderGit2 size={14} className="shrink-0" aria-hidden /> : <Folder size={14} className="shrink-0" aria-hidden />}
                    <span>{useWorktree ? 'New worktree' : 'Current checkout'}</span>
                  </ChoiceMenu>

                  {useWorktree ? (
                    <ChoiceMenu
                      name="base"
                      value={d.baseRef}
                      onChange={(baseRef) => update({ baseRef })}
                      title="The branch the new worktree starts from"
                      heading="Branch from"
                      chevron
                      mono
                      search="Search branches"
                      width={300}
                      choices={[
                        { value: 'fresh', label: freshBase(gitStatus?.remote ?? null, gitStatus?.baseBranch ?? null), note: 'default', description: "Claude Code's default" },
                        { value: 'head', label: gitBranches.current ?? 'HEAD', note: 'local HEAD', description: 'Includes your unpushed commits' },
                      ]}
                    >
                      <GitBranch size={14} className="shrink-0" aria-hidden />
                      <span className="truncate" data-route-branch>
                        {trayBranch}
                      </span>
                    </ChoiceMenu>
                  ) : gitBranches.branches.length > 0 ? (
                    <ChoiceMenu
                      name="branch"
                      value={checkoutBranch ?? gitBranches.current ?? ''}
                      onChange={(b) => update({ branch: b === gitBranches.current ? '' : b })}
                      title="Check out a branch before the session starts. Git keeps uncommitted changes, or refuses when they conflict."
                      heading="Branch"
                      chevron
                      mono
                      search="Search branches"
                      width={300}
                      choices={[
                        ...(gitBranches.current ? [] : [{ value: '', label: 'Stay on the current checkout' }]),
                        ...filterBranches(branchOptions, gitBranches.current, '').map((b) => ({ value: b, label: b, note: branchNote(b, gitBranches.current, gitStatus?.behindUpstream ?? null) })),
                      ]}
                    >
                      <GitBranch size={14} className="shrink-0" aria-hidden />
                      <span className="truncate" data-route-branch>
                        {trayBranch}
                      </span>
                    </ChoiceMenu>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1.5 px-2 text-ui text-muted">
                      <GitBranch size={14} className="shrink-0" aria-hidden />
                      <span className="truncate" data-route-branch>
                        {trayBranch}
                      </span>
                    </span>
                  )}

                  <span className="flex-1" />
                  {/* The quick way to the most common route change; the menu has the details (base, name). */}
                  <label
                    className={`flex shrink-0 items-center gap-2 px-1.5 text-ui ${canWorktree ? 'cursor-pointer text-muted' : 'text-faint'}`}
                    data-tooltip={canWorktree ? 'Work in an isolated copy of the repository' : 'Needs a git repository'}
                  >
                    Worktree
                    <Switch checked={useWorktree} disabled={!canWorktree} onChange={(on) => update({ workspace: on ? 'worktree' : 'current' })} dataAttrs={{ 'data-worktree-switch': true }} />
                  </label>
                </>
              )}
            </div>

            <Composer
              initialText={initialText}
              onTextChange={setDraftPrompt}
              cwd={cwd}
              commands={commands}
              placeholder="What should Claude work on?"
              submitLabel="Start session"
              submitHint="⌘↵"
              large
              autoFocus
              focusRequest={focusRequest}
              preset={preset}
              controls={controls}
              onCycleMode={() => update({ permissionMode: nextMode(d.permissionMode) })}
              disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'Choose a folder first' : inspection && !inspection.exists ? 'That folder no longer exists' : null}
              onSubmit={create}
            />
          </div>

          <div className="-mt-2 flex min-h-5 items-center justify-between gap-4 px-2 text-meta text-muted" data-tray-footer>
            <span className="flex min-w-0 items-center">{notice}</span>
            <span className="shrink-0">
              <UsageBand footer profileId={profileId} />
            </span>
          </div>

          {cwd && !isProject && inspection?.exists && (
            <Checkbox checked={addAsProject} onChange={setAddAsProject} className="-mt-3 w-fit px-2 text-meta text-muted" dataAttrs={{ 'data-add-as-project': true }}>
              Add {basename(cwd)} to your projects
            </Checkbox>
          )}

          {cwd && pickUp.length > 0 && (
            <section aria-label={`Pick up in ${projectName}`} data-pick-up>
              <SectionHeader as="h2" className="px-2">
                Pick up in {projectName}
              </SectionHeader>
              <ul className="mt-1 grid">
                {pickUp.map((row) => {
                  const status = rowStatus(row);
                  const dot = status === 'needs-you' ? 'bg-warn' : status === 'running' ? 'bg-accent-ink animate-pulse' : status === 'unread' ? 'bg-unread' : 'bg-faint/50';
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => select(row.id)}
                        className="flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left hover:bg-border/45"
                        data-pick-up-session={row.id}
                      >
                        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
                        <span className="min-w-0 flex-1 truncate text-ui text-text">{row.title || 'Untitled session'}</span>
                        {status === 'needs-you' && <span className="shrink-0 text-meta text-warn">Needs you</span>}
                        {status === 'running' && <span className="shrink-0 text-meta text-accent-ink">Working</span>}
                        <span className="shrink-0 text-meta text-faint tabular-nums">{shortAge(row.updatedAt)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
