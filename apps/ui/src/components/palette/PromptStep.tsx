import { ChevronDown, ChevronRight, Folder, FolderGit2, GitBranch, GitBranchPlus, SquarePen } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ImageAttachment, LaterDraft, ProjectInspection } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename } from '../../lib/format.ts';
import { nextMode } from '../../lib/modes.ts';
import { passFocusGate } from '../../state/focusGate.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { saveForLater } from '../../state/laterStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { AttachmentThumbs, DropOverlay } from '../composer/Attachments.tsx';
import { ComposerChipRow } from '../composer/ComposerChips.tsx';
import { DraftStore } from '../composer/drafts.ts';
import { useAttachments } from '../composer/useAttachments.ts';
import { ChoiceMenu } from '../newSession/ChoiceMenu.tsx';
import { DEFAULTS_KEY, globalPatch, INITIAL_CHOICES, readGlobals, startingChoices, type Choices, type GlobalChoices } from '../newSession/choices.ts';
import { checkoutBranchFor, shouldPrewarm, startNewSession } from '../newSession/startSession.ts';
import { branchLabel, branchNote, freshBase } from '../newSession/trayLabels.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { filterBranches } from '../worktree/branchMenu.ts';
import { PaletteFooter } from './PaletteFooter.tsx';

/** Prompts written (and images attached) here and not started, per project: Esc keeps them for the next time the step opens. */
const drafts = new DraftStore<ImageAttachment>();
const forget = (root: string) => drafts.set(root, { text: '', attachments: [] });

/**
 * The palette's last step of New session: a small New session form with the project's defaults. The
 * route (this checkout and its branch, or a new worktree), the prompt, and the profile, model, effort
 * and mode chips. ⌘↵ starts it the same way the New session view does; ⌘E moves it there. Clicking
 * the project picks another one; `from` is the project the prompt was written for before that.
 */
export function PromptStep({ root, from, worktree, chip, onBack, onChangeProject, onDone }: { root: string; from?: string; worktree: boolean; chip: string; onBack(): void; onChangeProject(): void; onDone(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const project = useProjects((s) => s.projects.get(root));
  const isProject = project?.added ?? false;
  const projectDefaults = isProject ? project!.defaults : null;
  const models = useHosts((s) => s.models);
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = useProfiles((s) => s.defaultId);
  const [globals, setGlobals] = useState<GlobalChoices>(INITIAL_CHOICES);
  const [loaded, setLoaded] = useState(false);
  /** Changed here: the project's defaults arriving late must not undo it. */
  const touched = useRef(false);
  const [d, setD] = useState<Choices>(() => ({ ...startingChoices(INITIAL_CHOICES, projectDefaults), ...(worktree ? { workspace: 'worktree' as const } : {}) }));
  const [profileOverride, setProfileOverride] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [gitBranches, setGitBranches] = useState<{ current: string | null; branches: string[] }>({ current: null, branches: [] });
  const [gitStatus, setGitStatus] = useState<{ remote: string | null; baseBranch: string | null; behindUpstream: number | null } | null>(null);
  const moved = from && from !== root ? from : null;
  const [saved] = useState(() => (moved ? drafts.get(moved) : undefined) ?? drafts.get(root));
  const [text, setText] = useState(saved?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What a paste or drop left out. */
  const [notice, setNotice] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const projectProfile = project?.profileId && profiles.some((p) => p.id === project.profileId) ? project.profileId : null;
  const profileId = (profileOverride && profiles.some((p) => p.id === profileOverride) ? profileOverride : null) ?? projectProfile ?? defaultProfile;
  const name = project?.name ?? basename(root);

  // The choices last made in New session, under the project's defaults.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('appState.get', { key: DEFAULTS_KEY }).then(
      ({ value }) => !cancelled && (setGlobals(readGlobals(value).globals), setLoaded(true)),
      () => !cancelled && setLoaded(true),
    );
    return () => {
      cancelled = true;
    };
  }, [client]);
  const defaultsKey = JSON.stringify(projectDefaults);
  useEffect(() => {
    if (!loaded || touched.current) return;
    const choices = startingChoices(globals, projectDefaults);
    setD(worktree ? { ...choices, workspace: 'worktree' } : choices);
  }, [loaded, globals, defaultsKey, worktree]);

  // Is it a git repository, on which branch, and where would a worktree branch from.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('projects.inspect', { path: root }).then((r) => !cancelled && setInspection(r), (e: Error) => !cancelled && setError(`Couldn't check this folder: ${e.message}`));
    client.call('git.branches', { cwd: root }).then((r) => !cancelled && setGitBranches(r), () => {});
    client.call('worktree.status', { cwd: root }).then((r) => !cancelled && setGitStatus({ remote: r.pushRemote, baseBranch: r.baseBranch, behindUpstream: r.behindUpstream }), () => {});
    return () => {
      cancelled = true;
    };
  }, [client, root]);
  // Warm Claude Code up for the folder while the prompt is written, as New session does.
  useEffect(() => {
    if (client && shouldPrewarm(d)) void client.call('session.prewarm', { cwd: root, profileId });
  }, [client, root, d.workspace, d.branch, profileId]);

  const canWorktree = inspection?.isGitRepo ?? false;
  const useWorktree = d.workspace === 'worktree' && canWorktree;
  const checkoutBranch = checkoutBranchFor(d, useWorktree, gitBranches.current);
  const trayBranch = branchLabel({
    worktree: useWorktree,
    baseRef: d.baseRef,
    remote: gitStatus?.remote ?? null,
    baseBranch: gitStatus?.baseBranch ?? null,
    current: gitBranches.current ?? inspection?.branch ?? null,
    checkoutBranch,
    isGitRepo: inspection?.isGitRepo ?? null,
  });
  const branchOptions = d.branch && !gitBranches.branches.includes(d.branch) ? [d.branch, ...gitBranches.branches] : gitBranches.branches;
  const blocked = !client ? 'Connecting to the engine…' : inspection && !inspection.exists ? 'This folder no longer exists' : null;
  const canStart = !busy && !blocked && text.trim() !== '';
  // Pasting or dropping images and files works as in the message box.
  const { attachments, setAttachments, onPaste, drop } = useAttachments({ initial: saved?.attachments, rootRef: zoneRef, textareaRef: textRef, cwd: root, disabledReason: blocked, setText, onNotice: setNotice });
  useEffect(() => {
    drafts.set(root, { text, attachments });
  }, [root, text, attachments]);
  // The prompt moved here from the project it was first written for.
  useEffect(() => {
    if (moved && drafts.get(moved)) forget(moved);
  }, [moved]);

  // As in New session: a choice the project doesn't decide is remembered for next time.
  const update = (patch: Partial<Choices>) => {
    touched.current = true;
    setD((current) => ({ ...current, ...patch }));
    const remembered = globalPatch(patch, projectDefaults);
    if (Object.keys(remembered).length) {
      setGlobals((current) => {
        const next = { ...current, ...remembered };
        void client?.call('appState.set', { key: DEFAULTS_KEY, value: { ...next, cwd: root } });
        return next;
      });
    }
  };

  const laterDraft = (prompt: string): LaterDraft => ({
    cwd: root,
    prompt,
    model: d.model || null,
    effort: d.effort || null,
    permissionMode: d.permissionMode,
    workspace: useWorktree ? 'worktree' : 'current',
    baseRef: d.baseRef,
    branch: !useWorktree && d.branch ? d.branch : null,
    profileId: profileOverride,
  });

  const start = async () => {
    if (!client || !canStart) return;
    const prompt = text.trim();
    setBusy(true);
    setError(null);
    const finish = () => {
      forget(root);
      onDone();
    };
    try {
      const outcome = await startNewSession(
        {
          cwd: root,
          prompt,
          attachments,
          choices: d,
          worktree: useWorktree,
          currentBranch: gitBranches.current,
          profileId,
          addProject: !isProject && !!inspection?.exists,
          saveForLater: () => saveForLater(laterDraft(prompt)),
        },
        {
          createSession: (params) => client.call('session.create', params),
          gate: passFocusGate,
          addProject: (path) => client.call('projects.add', { path }).then(() => useProjects.getState().reload()),
          open: (sessionId) => {
            finish();
            useSessions.getState().select(sessionId);
          },
        },
      );
      if (outcome.kind === 'saved') finish();
      else if (outcome.kind === 'stopped') setBusy(false);
    } catch (e) {
      setError(`Couldn't start the session: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  /** ⌘E: the full New session view, with this project, these choices and the prompt so far. */
  const moreOptions = () => {
    usePaletteBus.getState().handOff({ root, prompt: text, attachments, choices: d, worktree: useWorktree, profileId: profileOverride });
    forget(root);
    onDone();
    useSessions.getState().openNewSession();
  };

  const modelLabel = d.model ? (models.find((m) => m.value === d.model)?.displayName ?? d.model) : 'Default model';
  return (
    // The whole step takes dropped files, like a session view.
    <div ref={zoneRef} className="relative flex min-h-0 flex-1 flex-col" data-drop-zone>
      <DropOverlay drop={drop} />
      {/* The route: the command and project as chips, then where the session works. */}
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-edge px-3" data-palette-route>
        <Pill icon={worktree ? <GitBranchPlus size={12} aria-hidden /> : <SquarePen size={12} aria-hidden />}>{chip}</Pill>
        <ChevronRight size={13} className="shrink-0 text-faint" aria-hidden />
        <Pill icon={<ProjectIcon project={project} root={root} size={14} />} onClick={onChangeProject} aria-label={`Change project, ${name}`} data-tooltip={`Change project · ${root}`} data-palette-route-project={root}>
          {name}
          <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />
        </Pill>
        {inspection?.isGitRepo === false ? (
          <span className="flex min-w-0 items-center gap-1.5 px-2 text-ui text-muted">
            <Folder size={13} className="shrink-0" aria-hidden />
            <span className="truncate">This folder · no git</span>
          </span>
        ) : useWorktree ? (
          <ChoiceMenu
            name="palette-base"
            value={d.baseRef}
            onChange={(baseRef) => update({ baseRef })}
            title="The branch the new worktree starts from"
            heading="Branch from"
            chevron
            mono
            width={300}
            choices={[
              { value: 'fresh', label: freshBase(gitStatus?.remote ?? null, gitStatus?.baseBranch ?? null), note: 'default', description: "Claude Code's default" },
              { value: 'head', label: gitBranches.current ?? 'HEAD', note: 'local HEAD', description: 'Includes your unpushed commits' },
            ]}
          >
            <FolderGit2 size={13} className="shrink-0" aria-hidden />
            <span className="truncate" data-palette-route-branch>
              New worktree · {trayBranch}
            </span>
          </ChoiceMenu>
        ) : (
          <ChoiceMenu
            name="palette-branch"
            value={checkoutBranch ?? gitBranches.current ?? ''}
            onChange={(b) => update({ branch: b === gitBranches.current ? '' : b })}
            title="Check out a branch before the session starts. Git keeps uncommitted changes, or refuses when they conflict."
            heading="Branch"
            chevron
            mono
            search="Search branches"
            width={300}
            disabled={gitBranches.branches.length === 0}
            choices={[
              ...(gitBranches.current ? [] : [{ value: '', label: 'Stay on the current checkout' }]),
              ...filterBranches(branchOptions, gitBranches.current, '').map((b) => ({ value: b, label: b, note: branchNote(b, gitBranches.current, gitStatus?.behindUpstream ?? null) })),
            ]}
          >
            <GitBranch size={13} className="shrink-0" aria-hidden />
            <span className="truncate" data-palette-route-branch>
              Current checkout · {trayBranch}
            </span>
          </ChoiceMenu>
        )}
        <span className="flex-1" />
        <label className={`flex shrink-0 items-center gap-2 text-ui ${canWorktree ? 'cursor-pointer text-muted' : 'text-faint'}`} data-tooltip={canWorktree ? 'Work in an isolated copy of the repository' : 'Needs a git repository'}>
          Worktree
          <Switch checked={useWorktree} disabled={!canWorktree} onChange={(on) => update({ workspace: on ? 'worktree' : 'current' })} dataAttrs={{ 'data-palette-worktree': true }} />
        </label>
      </div>

      <label htmlFor={`${labelId}-prompt`} className="sr-only">
        Prompt for the new session in {name}
      </label>
      <textarea
        ref={textRef}
        id={`${labelId}-prompt`}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          // Keys the palette takes for itself don't also reach the window's shortcuts (⌘E, ⌘↵).
          if (e.metaKey && e.key === 'Enter') (e.preventDefault(), e.stopPropagation(), void start());
          else if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'e') (e.preventDefault(), e.stopPropagation(), moreOptions());
          else if (e.key === 'Backspace' && text === '') (e.preventDefault(), onBack());
          else if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey) (e.preventDefault(), update({ permissionMode: nextMode(d.permissionMode) }));
        }}
        placeholder="What should Claude work on?"
        spellCheck={false}
        rows={4}
        className="min-h-28 w-full shrink-0 resize-none bg-transparent px-4 pt-3.5 pb-2 text-body text-text outline-none placeholder:text-faint"
        data-palette-prompt
      />
      <AttachmentThumbs
        attachments={attachments}
        className="shrink-0 px-4 pb-2"
        onRemove={(i) => {
          setAttachments((current) => current.filter((_, j) => j !== i));
          textRef.current?.focus();
        }}
      />

      <div className="flex shrink-0 items-center gap-2 px-3 pb-3">
        <div className="min-w-0 flex-1">
          <ComposerChipRow
            names={{ profile: 'palette-profile', model: 'palette-model', effort: 'palette-effort', mode: 'palette-mode' }}
            profile={{ value: profileId, onChange: (id) => setProfileOverride(id), labelFor: (p) => `${p.name}${p.id === (projectProfile ?? defaultProfile) ? (projectProfile ? ' (project)' : ' (default)') : ''}` }}
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
        </div>
        <Button variant="primary" size="lg" kbd="⌘↵" disabled={!canStart} onClick={() => void start()} data-tooltip={blocked ?? undefined} data-palette-start>
          {busy ? 'Starting…' : 'Start'}
        </Button>
      </div>
      {(error ?? notice) && (
        <p role="alert" className="shrink-0 px-4 pb-2 text-ui text-error">
          {error ?? notice}
        </p>
      )}

      <PaletteFooter
        keys={[
          { keys: '⌘↵', label: 'start' },
          { keys: '⌘E', label: 'more options' },
          { keys: '⌫', label: 'back' },
          { keys: 'Esc', label: 'close, keeps the draft' },
        ]}
      />
    </div>
  );
}
