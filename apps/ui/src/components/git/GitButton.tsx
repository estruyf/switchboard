import { ChevronDown, CloudDownload, CloudUpload, GitBranch, GitBranchPlus, GitCommitHorizontal, GitPullRequest, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GitSyncAction, WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { CommitDialog } from './CommitDialog.tsx';
import { gitSummary, planGit, STEP_LABEL, stepCount, type GitStep } from './gitPlan.ts';

const ICON: Record<GitStep, typeof GitCommitHorizontal> = { fetch: RefreshCw, commit: GitCommitHorizontal, pull: CloudDownload, push: CloudUpload, pr: GitPullRequest };
/** The count on the button's face: behind in the warning colour, ahead in green. */
const COUNT: Partial<Record<GitStep, { prefix: string; tone: string }>> = {
  pull: { prefix: '↓', tone: 'text-warn' },
  push: { prefix: '↑', tone: 'text-ok' },
  commit: { prefix: '', tone: 'text-muted' },
};
const MENU_WIDTH = 280;
const PULL_SHORTCUT = '⌘⇧L';

/**
 * Split button in the session header. Its face runs the step the checkout needs next (pull when
 * behind, commit when dirty, push when ahead, a pull request when a branch is ready, else fetch);
 * the menu has every git step, plus switching branch and starting a worktree session.
 * Commit asks Claude (or opens the commit dialog from the menu); fetch, pull, push and pull request
 * run git (and gh) in a terminal tab so the output stays visible.
 * `activity` changes when the session does something, so the status follows along.
 */
export function GitButton({
  sessionId,
  cwd,
  busy,
  active,
  activity,
  isWorktree,
  onCommit,
  onBranchMenu,
  onNewWorktree,
}: {
  sessionId: string;
  cwd: string;
  busy: boolean;
  /** This session's pane is the active one: ⌘⇧L pulls here. */
  active: boolean;
  activity: string;
  isWorktree: boolean;
  /** Asks Claude to commit. */
  onCommit(): void;
  /** Opens the branch menu (or, in a worktree, the worktree's merge and remove menu). */
  onBranchMenu(): void;
  onNewWorktree(): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const togglePanel = useTerminals((s) => s.togglePanel);
  const setActive = useTerminals((s) => s.setActive);
  // A git command finishing in this session's terminal changes where the branch stands.
  const exited = useTerminals((s) => [...s.terminals.values()].filter((t) => t.sessionId === sessionId && t.exitCode !== null).length);
  const menu = useMenu();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [committing, setCommitting] = useState(false);
  /** The folder whose status has been read once. */
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    // Debounced like the Changes panel: a busy turn changes `activity` often. The first read is
    // immediate, so the button is there as soon as the pane opens.
    const timer = setTimeout(
      () => {
        client.call('worktree.status', { cwd }).then(
          (result) => !cancelled && ((loaded.current = cwd), setStatus(result)),
          () => !cancelled && setStatus(null),
        );
      },
      loaded.current === cwd ? 500 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, cwd, activity, exited, version]);
  useEffect(() => {
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const plan = status ? planGit(status, busy) : null;
  const openTerminal = (terminalId: string) => {
    togglePanel(true);
    setActive(sessionId, terminalId);
  };
  const run = async (step: GitStep) => {
    setError(null);
    if (step === 'commit') return onCommit();
    if (!client) return;
    try {
      const { terminalId } = await client.call('git.sync', { sessionId, cwd, action: step satisfies GitSyncAction });
      openTerminal(terminalId);
    } catch (e) {
      setError(`Couldn't ${STEP_LABEL[step].toLowerCase()}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ⌘⇧L pulls while this session is on screen and behind its upstream.
  const pullRef = useRef<(() => void) | null>(null);
  pullRef.current = plan && plan.blocked.pull === null ? () => void run('pull') : null;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'l' && pullRef.current) {
        event.preventDefault();
        pullRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!status || !plan) return null;

  const tooltipFor = (step: GitStep): string => {
    const blocked = plan.blocked[step];
    if (blocked) return blocked;
    if (step === 'commit') return `Ask Claude to commit ${status.uncommitted === 1 ? 'the changed file' : `the ${status.uncommitted} changed files`}`;
    if (step === 'fetch') return 'Fetch from the remote in a terminal tab, to see whether the upstream moved on';
    if (step === 'pull') return `Pull from ${status.upstream} in a terminal tab (${PULL_SHORTCUT})`;
    if (step === 'push') return status.upstream ? `Push to ${status.upstream} in a terminal tab` : `Publish ${status.branch} to ${status.pushRemote} in a terminal tab`;
    return `Push ${status.branch}, then open GitHub's pull request page with gh`;
  };

  const face = plan.primary;
  const FaceIcon = ICON[face];
  const faceBlocked = plan.blocked[face];
  const count = COUNT[face] ? stepCount(status, face) : null;
  const step = (s: GitStep, label: string, extra: Partial<Extract<MenuEntry, { label: string }>> = {}): MenuEntry => ({
    label,
    disabled: plan.blocked[s] !== null,
    onSelect: () => void run(s),
    data: { 'data-git-step': s },
    ...extra,
  });
  const entries: MenuEntry[] = [
    { title: status.branch ?? 'Detached HEAD', detail: gitSummary(status) },
    'separator',
    step('pull', 'Pull', { icon: <CloudDownload size={13} />, hint: PULL_SHORTCUT }),
    step('fetch', 'Fetch', { icon: <RefreshCw size={13} /> }),
    'separator',
    {
      label: 'Commit…',
      icon: <GitCommitHorizontal size={13} />,
      hint: status.uncommitted ? `${status.uncommitted} ${status.uncommitted === 1 ? 'file' : 'files'}` : undefined,
      disabled: plan.blocked.commit !== null,
      onSelect: () => setCommitting(true),
      data: { 'data-git-step': 'commit-dialog' },
    },
    step('commit', 'Ask Claude to commit', { icon: <Sparkles size={13} /> }),
    step('push', 'Push', { icon: <CloudUpload size={13} /> }),
    step('pr', 'Create PR', { icon: <GitPullRequest size={13} /> }),
  ];
  if (plan.note) entries.push({ note: plan.note, tone: 'warn' });
  entries.push(
    'separator',
    isWorktree
      ? { label: 'Merge or remove worktree…', icon: <GitBranch size={13} />, onSelect: onBranchMenu, data: { 'data-git-step': 'worktree' } }
      : { label: 'Switch branch…', icon: <GitBranch size={13} />, disabled: busy, onSelect: onBranchMenu, data: { 'data-git-step': 'switch' } },
    { label: 'New worktree…', icon: <GitBranchPlus size={13} />, onSelect: onNewWorktree, data: { 'data-git-step': 'worktree-new' } },
  );

  return (
    <div ref={wrapperRef} className="no-drag relative flex shrink-0" data-git-button={face}>
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
      <button
        type="button"
        // Not `disabled`: a blocked step stays hoverable and focusable so its tooltip can say why.
        onClick={() => faceBlocked === null && void run(face)}
        aria-disabled={faceBlocked !== null}
        data-tooltip={error ?? tooltipFor(face)}
        aria-label={`${STEP_LABEL[face]}${count ? ` ${count}` : ''}`}
        aria-keyshortcuts={face === 'pull' ? 'Meta+Shift+L' : undefined}
        className={`flex h-7 items-center gap-1.5 rounded-l-md border px-2.5 text-[12px] ${error ? 'border-error/50 text-error' : 'border-border text-text'} ${faceBlocked ? 'cursor-default opacity-50' : 'hover:bg-border/50'}`}
      >
        <FaceIcon size={13} className="text-muted @max-[860px]:hidden" aria-hidden />
        <span>{STEP_LABEL[face]}</span>
        {count !== null && count > 0 && (
          <span className={`tabular-nums ${COUNT[face]!.tone}`} aria-hidden>
            {COUNT[face]!.prefix}
            {count}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          setVersion((v) => v + 1);
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (menu.at || !rect) menu.close();
          else menu.openAt(rect.right - MENU_WIDTH, rect.bottom + 4);
        }}
        className="flex h-7 items-center rounded-r-md border border-l-0 border-border px-1.5 text-muted hover:bg-border/50 hover:text-text"
        aria-label="Git: pull, fetch, commit, push, pull request, branches"
        data-tooltip="Git"
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        data-git-menu
      >
        <ChevronDown size={13} aria-hidden />
      </button>
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={MENU_WIDTH} entries={entries} onClose={menu.close} label="Git" />}
      {committing && (
        <CommitDialog
          branch={status.branch}
          files={status.uncommitted}
          onCommit={async (message) => {
            if (!client) throw new Error('Not connected to the engine');
            const { terminalId } = await client.call('git.commit', { sessionId, cwd, message });
            openTerminal(terminalId);
          }}
          onClose={() => setCommitting(false)}
        />
      )}
    </div>
  );
}
