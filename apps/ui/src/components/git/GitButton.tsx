import { ChevronDown, CloudDownload, CloudUpload, GitCommitHorizontal, GitPullRequest } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GitSyncAction, WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { planGit, STEP_LABEL, type GitStep } from './gitPlan.ts';

const ICON: Record<GitStep, typeof GitCommitHorizontal> = { commit: GitCommitHorizontal, pull: CloudDownload, push: CloudUpload, pr: GitPullRequest };
const MENU_WIDTH = 260;

/**
 * Split button in the session header: the next git step for the checkout on its face (pull, commit,
 * push or create a pull request), every step in its menu. Commit asks Claude to write the commit;
 * pull, push and pull request run git (and gh) in a terminal tab so the output stays visible.
 * `activity` changes when the session does something, so the status follows along.
 */
export function GitButton({ sessionId, cwd, busy, activity, onCommit }: { sessionId: string; cwd: string; busy: boolean; activity: string; onCommit(): void }) {
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

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    // Debounced like the Changes panel: a busy turn changes `activity` often.
    const timer = setTimeout(() => {
      client.call('worktree.status', { cwd }).then(
        (result) => !cancelled && setStatus(result),
        () => !cancelled && setStatus(null),
      );
    }, 500);
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

  if (!status) return null;
  const plan = planGit(status, busy);

  const run = async (step: GitStep) => {
    setError(null);
    if (step === 'commit') return onCommit();
    if (!client) return;
    try {
      const { terminalId } = await client.call('git.sync', { sessionId, cwd, action: step satisfies GitSyncAction });
      togglePanel(true);
      setActive(sessionId, terminalId);
    } catch (e) {
      setError(`Couldn't ${STEP_LABEL[step].toLowerCase()}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const tooltipFor = (step: GitStep): string => {
    const blocked = plan.blocked[step];
    if (blocked) return blocked;
    if (step === 'commit') return `Ask Claude to commit ${status.uncommitted === 1 ? 'the changed file' : `the ${status.uncommitted} changed files`}`;
    if (step === 'pull') return `Pull from ${status.upstream} in a terminal tab`;
    if (step === 'push') return status.upstream ? `Push to ${status.upstream} in a terminal tab` : `Publish ${status.branch} to ${status.pushRemote} in a terminal tab`;
    return `Push ${status.branch}, then open GitHub's pull request page with gh`;
  };

  const face: GitStep = plan.primary ?? 'commit';
  const FaceIcon = ICON[face];
  const faceBlocked = plan.blocked[face];
  const steps: GitStep[] = ['commit', 'push', 'pr', 'pull'];
  const entries: MenuEntry[] = [
    { heading: status.branch ?? 'Detached HEAD' },
    ...steps.map((step) => {
      const Icon = ICON[step];
      return { label: STEP_LABEL[step], icon: <Icon size={13} />, disabled: plan.blocked[step] !== null, onSelect: () => void run(step) } satisfies MenuEntry;
    }),
  ];
  if (plan.note) entries.push({ note: plan.note, tone: 'warn' });

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
        aria-label={STEP_LABEL[face]}
        className={`flex h-7 items-center gap-1.5 rounded-l-md border px-2 text-[12px] ${error ? 'border-error/50 text-error' : 'border-border text-text'} ${faceBlocked ? 'cursor-default opacity-50' : 'hover:bg-border/50'}`}
      >
        <FaceIcon size={13} className="text-muted" aria-hidden />
        <span className="@max-[860px]:hidden">{STEP_LABEL[face]}</span>
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
        aria-label="Git: commit, push, pull request, pull"
        data-tooltip="Commit, push, pull request, pull"
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        data-git-menu
      >
        <ChevronDown size={13} aria-hidden />
      </button>
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={MENU_WIDTH} entries={entries} onClose={menu.close} label="Git" />}
    </div>
  );
}
