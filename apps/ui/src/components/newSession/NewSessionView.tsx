import { Bookmark, Folder, FolderGit2, GitBranch, Link2, PencilLine } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageAttachment, LaterDraft, LaterItem, ProjectInspection, SlashCommand, WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ChoiceMenu } from './ChoiceMenu.tsx';
import { FolderPicker } from './FolderPicker.tsx';
import { routeHint } from './route.ts';
import { filterBranches } from '../worktree/branchMenu.ts';
import { basename, guessHome, shortAge } from '../../lib/format.ts';
import { nextMode, worktreeSlug } from '../../lib/modes.ts';
import { passFocusGate, useFocus } from '../../state/focusGate.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { removeFromLater, saveForLater, useLater } from '../../state/laterStore.ts';
import { useLinks } from '../../state/linksStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { inScope, rowStatus } from '../../state/sidebarRows.ts';
import { Composer } from '../composer/Composer.tsx';
import { FocusNote } from '../focus/FocusNote.tsx';
import { LaterSection } from '../focus/LaterSection.tsx';
import { useMinute } from '../focus/useMinute.ts';
import { ComposerChipRow } from '../composer/ComposerChips.tsx';
import { projectHistory } from '../composer/promptHistory.ts';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { ProjectIcon, useProjectColor } from '../ProjectIcon.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { OpenInButton } from '../OpenInButton.tsx';
import { CatchUpButton } from '../git/CatchUpButton.tsx';
import { UsageBand } from '../UsageBand.tsx';
import { linkNoticeText } from './linkNotice.ts';
import { activityByProject, latestBranches, orderProjects, pickUpRows, tileStatus } from './projectTiles.ts';
import { branchLabel, branchNote, freshBase } from './trayLabels.ts';
import { checkoutBranchFor, shouldPrewarm, startNewSession } from './startSession.ts';
import { DEFAULTS_KEY, globalPatch, INITIAL_CHOICES, linkStartingChoices, readGlobals, sameDefaults, startingChoices, toProjectDefaults, type Choices, type GlobalChoices } from './choices.ts';
import { comboPresses, keysFor, shortcutById } from '../../lib/shortcuts.ts';

const keysOf = (id: 'new-session.pick') => shortcutById(id).keys[0]!;

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
  const commandsVersion = useHosts((s) => s.commandsVersion);
  const focusRequest = useSessions((s) => s.newSessionRequest);
  const hosts = useHosts((s) => s.hosts);
  const live = useSessions((s) => s.live);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const projectOrder = usePreferences((s) => s.prefs.projectOrder);
  const view = useSessions((s) => s.view);
  const [cwd, setCwd] = useState<string | null>(null);
  const [globals, setGlobals] = useState<GlobalChoices>(INITIAL_CHOICES);
  const [d, setD] = useState<Choices>({ ...INITIAL_CHOICES, branch: '' });
  const [loaded, setLoaded] = useState(false);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [gitBranches, setGitBranches] = useState<{ current: string | null; branches: string[] }>({ current: null, branches: [] });
  /** Where the checkout stands: the remote a fresh worktree branches from, its default branch, and how far the upstream is ahead. */
  const [gitStatus, setGitStatus] = useState<WorktreeStatus | null>(null);
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
  const [preset, setPreset] = useState<{ text: string; attachments?: ImageAttachment[]; seq: number } | undefined>(undefined);
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
  /** An `autostart` link is waiting: its choices never take the permission mode you last picked (see `linkStartingChoices`). */
  const autostarting = pendingStart !== null;
  const choicesFor = autostarting ? linkStartingChoices : startingChoices;
  /** Why the folder couldn't be checked (the engine call failed). */
  const [inspectError, setInspectError] = useState<string | null>(null);
  /** The prompt came from the Later list: starting it (or saving it again) takes it off. */
  const [fromLater, setFromLater] = useState<LaterItem | null>(null);
  /** Start anyway in the focus note sends what is in the box, without asking again. */
  const [submitRequest, setSubmitRequest] = useState(0);
  const focus = useFocus();
  const atLimit = focus.limit !== null && focus.count >= focus.limit;
  const now = useMinute();
  const laterRequest = useLater((s) => s.request);

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
  /** The picked folder's colour: the message box's frame, matching its tile. */
  const projectColor = useProjectColor(project, cwd);
  const lastBranches = useMemo(() => latestBranches(sessions.values()), [sessions]);
  // The sessions the sidebar lists (sessions from other apps only when the scope shows them): the
  // tiles' status lines and "Pick up in" come from these.
  const rows = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const activity = useMemo(() => activityByProject(rows), [rows]);
  const ordered = useMemo(
    () => orderProjects(folders, projectOrder, (root) => Math.max(projects.get(root)?.lastActivity ?? 0, activity.get(root)?.lastActivity ?? 0) || null),
    [folders, projectOrder, projects, activity],
  );
  const statusOf = (root: string) => tileStatus(activity.get(root), projects.get(root)?.lastActivity ?? null, Date.now());

  // Restore the last folder and global choices.
  useEffect(() => {
    if (!client || loaded) return;
    let cancelled = false;
    client.call('appState.get', { key: DEFAULTS_KEY }).then(
      ({ value }) => {
        if (cancelled) return;
        const stored = readGlobals(value);
        setGlobals(stored.globals);
        if (!folderFromLink.current) setCwd((current) => current ?? stored.cwd);
        setLoaded(true);
      },
      // Without the remembered choices, start from the initial ones rather than never getting going.
      () => !cancelled && setLoaded(true),
    );
    return () => {
      cancelled = true;
    };
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
  // A prompt from the Later list: its folder, choices and prompt, to check before starting.
  useEffect(() => {
    if (!laterRequest) return;
    const item = useLater.getState().take();
    if (!item) return;
    // Like a link, it chose the folder; its own choices must not be replaced by the project's defaults.
    folderFromLink.current = true;
    touchedFor.current = item.cwd;
    worktreeFor.current = null;
    setLinkRepo(null);
    setLinkNoFolder(false);
    setPendingStart(null);
    setLinkPrompt(null);
    setAddAsProject(true);
    setProfileOverride(item.profileId);
    setCwd(item.cwd);
    setD({ model: item.model ?? '', permissionMode: item.permissionMode, effort: item.effort ?? '', workspace: item.workspace, baseRef: item.baseRef, branch: item.branch ?? '' });
    setRestored(false);
    setPreset({ text: item.prompt, seq: ++presets.current });
    setDraftPrompt(item.prompt);
    setFromLater(item);
  }, [laterRequest]);
  // The command palette's prompt step, moved here with ⌘E: its folder, choices, profile and prompt.
  const handoff = usePaletteBus((s) => s.handoff);
  useEffect(() => {
    if (!handoff) return;
    const item = usePaletteBus.getState().takeHandoff();
    if (!item) return;
    // Like a link, it chose the folder; the choices made in the palette must not be replaced by the project's defaults.
    folderFromLink.current = true;
    touchedFor.current = item.root;
    worktreeFor.current = null;
    setLinkRepo(null);
    setLinkNoFolder(false);
    setPendingStart(null);
    setLinkPrompt(null);
    setFromLater(null);
    setAddAsProject(true);
    setProfileOverride(item.profileId);
    setCwd(item.root);
    setD({ ...item.choices, workspace: item.worktree ? 'worktree' : 'current' });
    setRestored(false);
    setPreset({ text: item.prompt, attachments: item.attachments, seq: ++presets.current });
    setDraftPrompt(item.prompt);
  }, [handoff]);
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
    setFromLater(null);
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
    const choices = choicesFor(globals, projectDefaults);
    setD(worktreeFor.current === cwd ? { ...choices, workspace: 'worktree' } : choices);
  }, [loaded, cwd, defaultsKey, globals, autostarting]);

  // Inspect the folder (git? branch?), load its branches, and pre-warm Claude Code there.
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    setInspection(null);
    setInspectError(null);
    setGitBranches({ current: null, branches: [] });
    setGitStatus(null);
    setSavedNote(null);
    client.call('projects.inspect', { path: cwd }).then(
      (r) => !cancelled && setInspection(r),
      (error: Error) => {
        if (cancelled) return;
        setInspectError(error.message);
        // A link doesn't start in a folder that couldn't be checked; the prompt stays filled in.
        setPendingStart(null);
      },
    );
    client.call('git.branches', { cwd }).then(
      (r) => !cancelled && setGitBranches(r),
      () => {},
    );
    client.call('worktree.status', { cwd }).then(
      (r) => !cancelled && setGitStatus(r),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, profileId]);
  // Its commands, again after skills were reloaded.
  useEffect(() => {
    if (!client || !cwd) return;
    let cancelled = false;
    client.call('session.commands', { cwd, profileId }).then(
      (r) => !cancelled && setCommands(r.commands),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, profileId, commandsVersion]);
  useEffect(() => {
    if (client && cwd && shouldPrewarm(d)) void client.call('session.prewarm', { cwd, profileId });
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
  const checkoutBranch = checkoutBranchFor(d, useWorktree, gitBranches.current);
  const branchOptions = d.branch && !gitBranches.branches.includes(d.branch) ? [d.branch, ...gitBranches.branches] : gitBranches.branches;
  const asDefaults = toProjectDefaults({ ...d, workspace: useWorktree ? 'worktree' : d.workspace });
  const unsaved = isProject && !sameDefaults(asDefaults, project!.defaults);
  const trayBranch = branchLabel({
    worktree: useWorktree,
    baseRef: d.baseRef,
    remote: gitStatus?.pushRemote ?? null,
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

  // The command palette's commands for this view: what they can do here, and their requests.
  const canSaveForLater = !!cwd && draftPrompt.trim() !== '' && !!client;
  const canCatchUp = !!cwd && inspection?.path === cwd && inspection.exists && !!gitStatus?.hasRemote && !!client;
  /** The palette's Update from remote: the git button runs its step. */
  const [catchUpRequest, setCatchUpRequest] = useState(0);
  useEffect(() => {
    usePaletteBus.setState({ newSessionInfo: { canWorktree, canSaveDefaults: unsaved, canSaveForLater, canCatchUp } });
  }, [canWorktree, unsaved, canSaveForLater, canCatchUp]);
  useEffect(() => () => usePaletteBus.setState({ newSessionInfo: null }), []);
  const paletteRequest = usePaletteBus((s) => s.newSessionRequest);
  const seenRequest = useRef(usePaletteBus.getState().newSessionRequest?.nonce ?? 0);
  useEffect(() => {
    if (!paletteRequest || paletteRequest.nonce === seenRequest.current) return;
    seenRequest.current = paletteRequest.nonce;
    if (paletteRequest.kind === 'toggle-worktree' && canWorktree) update({ workspace: useWorktree ? 'current' : 'worktree' });
    else if (paletteRequest.kind === 'save-defaults' && unsaved) void saveAsProjectDefault();
    else if (paletteRequest.kind === 'save-later' && canSaveForLater) void parkForLater(draftPrompt.trim()).catch(() => {});
    else if (paletteRequest.kind === 'catch-up' && canCatchUp) setCatchUpRequest((n) => n + 1);
  }, [paletteRequest]);

  const pickUp = useMemo(() => (cwd ? pickUpRows(rows, cwd, Date.now()) : []), [rows, cwd]);
  /** The first prompts of your sessions in this project, for ↑ in the message box. */
  const promptHistory = useMemo(() => (cwd ? projectHistory(sessions.values(), cwd) : []), [sessions, cwd]);

  /** The prompt with this folder and these choices, for the Later list. Images stay behind. */
  const laterDraft = (text: string): LaterDraft | null =>
    cwd
      ? {
          cwd,
          prompt: text,
          model: d.model || null,
          effort: d.effort || null,
          permissionMode: d.permissionMode,
          workspace: useWorktree ? 'worktree' : 'current',
          baseRef: d.baseRef,
          branch: !useWorktree && d.branch ? d.branch : null,
          profileId: profileOverride,
        }
      : null;
  /** Parks the prompt on the Later list and empties the box. One taken from Later replaces itself. */
  const parkForLater = async (text: string) => {
    const draft = laterDraft(text);
    if (!draft) throw new Error('Choose a folder first');
    await saveForLater(draft);
    if (fromLater) void removeFromLater(fromLater, true).catch(() => {});
    unsentPrompt = '';
    clearPrompt();
  };

  /**
   * Starts the session, after the focus limit's gate (which may ask, or save the prompt for later instead).
   * `fromLink`: started by an `autostart` link, which never adds the folder to your projects.
   * `skipGate`: Start anyway in the focus note, which already is the answer to the question.
   * Returns false when nothing started and the prompt should stay.
   */
  const create = async (text: string, attachments: ImageAttachment[], { fromLink = false, skipGate = false } = {}): Promise<void | false> => {
    if (!client || !cwd) throw new Error('Choose a folder first');
    // The same path as the palette's New session: the focus limit's gate, worktree naming, then the session.
    const outcome = await startNewSession(
      {
        cwd,
        prompt: text,
        attachments,
        choices: d,
        worktree: useWorktree,
        worktreeName: effectiveName,
        currentBranch: gitBranches.current,
        profileId,
        fromLink,
        skipGate,
        addProject: !isProject && addAsProject && !!inspection?.exists,
        saveForLater: () => parkForLater(text),
      },
      {
        createSession: (params) => client.call('session.create', params),
        gate: passFocusGate,
        addProject: (path) => client.call('projects.add', { path }).then(reloadProjects),
        open: (sessionId) => {
          // The view goes away before the composer empties itself, so forget the prompt here.
          unsentPrompt = '';
          if (fromLater) {
            void removeFromLater(fromLater, true).catch(() => {});
            setFromLater(null);
          }
          select(sessionId);
        },
      },
    );
    if (outcome.kind === 'stopped') return false;
  };

  // An `autostart` link: start once the folder is checked and the options are the project's defaults
  // (they settle a render after the folder changes), exactly as if the user had pressed Enter. Its
  // permission mode is the project's own default, or the default mode: never the one you last picked.
  const projectsLoaded = useProjects((s) => s.loaded);
  const settled = JSON.stringify(d) === JSON.stringify(choicesFor(globals, projectDefaults));
  useEffect(() => {
    if (pendingStart === null || !client || !cwd || !loaded || !projectsLoaded || !settled || lookingFor || inspection?.path !== cwd) return;
    const text = pendingStart;
    setPendingStart(null);
    // A folder that is gone can't start; the prompt stays filled in to start elsewhere.
    if (!inspection.exists) return;
    create(text, [], { fromLink: true }).catch((error: Error) => useLinks.getState().fail(`Couldn't start the session: ${error.message}`));
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
    : !inspection
      ? inspectError
        ? `Couldn't check this folder: ${inspectError}`
        : 'Checking folder…'
      : !inspection.exists
        ? 'This folder no longer exists.'
        : null;

  const projectName = cwd ? (project?.name ?? basename(cwd)) : null;
  const clearButton = (attr: 'data-clear-link-prompt' | 'data-clear-draft') => (
    <Button variant="quiet" size="sm" onClick={clearPrompt} className="-my-1 shrink-0" {...{ [attr]: true }}>
      Clear
    </Button>
  );
  // One notice at a time, the most pressing first: a missing folder, a prompt from a link, a saved default, a restored draft.
  const notice =
    cwd && ((inspection && !inspection.exists) || (!inspection && inspectError)) ? (
      <span className="min-w-0 truncate text-error" data-route-hint>
        {folderProblem}
      </span>
    ) : linkPrompt !== null ? (
      <Notice inline icon={<Link2 size={13} className="text-accent-ink" aria-hidden />} actions={clearButton('data-clear-link-prompt')} data-link-notice>
        {pendingStart !== null ? 'Starting a session with the prompt from an external link…' : linkNoticeText(linkPrompt)}
      </Notice>
    ) : fromLater ? (
      <Notice inline icon={<Bookmark size={13} className="text-accent-ink" aria-hidden />} actions={clearButton('data-clear-draft')} data-later-notice>
        From your Later list. Starting it takes it off the list.
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
      <div className="drag flex h-13 shrink-0 items-center justify-between px-4">
        <SidebarToggle />
        {cwd && inspection?.path === cwd && inspection.exists && (
          <div className="flex items-center gap-2">
            {/* Your copy may be behind the remote: catch up before Claude starts from it. */}
            {gitStatus && <CatchUpButton cwd={cwd} status={gitStatus} onStatus={setGitStatus} request={catchUpRequest} />}
            {/* To look around the whole project before (or instead of) asking Claude. */}
            <OpenInButton path={cwd} shortcut={false} />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 px-6 pt-2 pb-12" data-new-session-view>
          <div className="text-center">
            {/* The one hero heading in the app, a little larger than text-title. */}
            <h1 className="text-hero leading-tight font-semibold">Where do we start?</h1>
            <p className="mt-1 text-ui text-muted">
              <Kbd keys={comboPresses(keysOf('new-session.pick'))[0]!} /> to <Kbd keys={comboPresses(keysOf('new-session.pick')).at(-1)!} /> picks a project, or start typing its name
            </p>
          </div>

          <FolderPicker
            value={cwd}
            folders={ordered}
            home={home}
            branches={folderBranches}
            statusOf={statusOf}
            onChange={changeFolder}
            onChooseOther={() => void chooseFolder()}
            shortcuts={view === 'new'}
            openRequest={pickerRequest}
          />

          {/* At the focus limit: what is going, with Open, and a way to park this idea. Start stays and asks first. */}
          {atLimit && (
            <FocusNote
              focus={focus}
              now={now}
              canSave={canSaveForLater}
              onSaveForLater={() => void parkForLater(draftPrompt.trim()).catch(() => {})}
              onStartAnyway={() => setSubmitRequest((n) => n + 1)}
            />
          )}

          {/* The message box with its route strip on top: the strip's bottom edge is the card's top border.
              With a folder picked, the whole card takes its project's colour, with a faint ring around it. */}
          <div
            className="rounded-xl transition-shadow [&>div>.rounded-xl]:rounded-t-none"
            style={projectColor ? { boxShadow: `0 0 0 4px color-mix(in srgb, ${projectColor} 14%, transparent)` } : undefined}
            data-project-color={projectColor ?? undefined}
          >
            <div
              className="flex min-h-10 min-w-0 items-center gap-1 rounded-t-xl border border-b-0 border-border bg-border/25 px-1.5 py-1 transition-colors"
              style={projectColor ? { borderColor: projectColor } : undefined}
              data-route-tray
            >
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
                        { value: 'fresh', label: freshBase(gitStatus?.pushRemote ?? null, gitStatus?.baseBranch ?? null), note: 'default', description: "Claude Code's default" },
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
              history={promptHistory}
              onTextChange={setDraftPrompt}
              cwd={cwd}
              commands={commands}
              placeholder="What should Claude work on?"
              submitLabel="Start session"
              submitHint={keysFor('new-session.start')}
              large
              frameColor={projectColor}
              autoFocus
              focusRequest={focusRequest}
              submitRequest={submitRequest}
              preset={preset}
              controls={controls}
              onCycleMode={() => update({ permissionMode: nextMode(d.permissionMode) })}
              disabledReason={!client ? 'Connecting to the engine…' : !cwd ? 'Choose a folder first' : inspection && !inspection.exists ? 'That folder no longer exists' : null}
              onSubmit={(text, attachments, requested) => create(text, attachments, { skipGate: requested === true })}
            />
          </div>

          {/* A container: as the column narrows, the usage drops its reset times, then its bars. */}
          <div className="@container -mt-2 flex min-h-5 items-center justify-between gap-4 px-2 text-meta text-muted" data-tray-footer>
            <span className="flex min-w-0 items-center">{notice}</span>
            <span className="min-w-0 shrink-0">
              <UsageBand tray profileId={profileId} />
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

          {cwd && projectName && <LaterSection cwd={cwd} projectName={projectName} now={now} />}
        </div>
      </div>
    </div>
  );
}
