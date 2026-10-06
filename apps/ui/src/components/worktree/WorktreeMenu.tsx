import { ChevronDown, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';

type Finish = 'merge' | 'pr' | 'remove';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line on where the worktree stands. */
function describe(status: WorktreeStatus): string {
  const parts = [
    status.ahead > 0 ? `${plural(status.ahead, 'commit', 'commits')} ahead of ${status.baseBranch}` : `nothing new vs ${status.baseBranch ?? 'base'}`,
    status.behind > 0 && `${status.behind} behind`,
    status.uncommitted > 0 && `${plural(status.uncommitted, 'uncommitted file', 'uncommitted files')}`,
    status.unpushed !== null && (status.unpushed > 0 ? `${status.unpushed} unpushed` : 'pushed'),
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * Finishing a worktree session: commit with Claude, merge into the base branch,
 * open a pull request, or remove the worktree (and its branch).
 */
export function WorktreeMenu({ sessionId, cwd, onCommit }: { sessionId: string; cwd: string; onCommit(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const menu = useMenu();
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Finish | null>(null);
  const [deleteBranch, setDeleteBranch] = useState(true);

  const load = () => {
    setError(null);
    client?.call('worktree.status', { cwd }).then(setStatus, (e: Error) => setError(e.message));
  };

  const base = status?.baseBranch ?? 'the base branch';
  const mergeBlocked = !status
    ? 'Checking…'
    : status.uncommitted > 0
      ? 'Commit or revert the uncommitted changes first'
      : status.ahead === 0
        ? `Nothing to merge into ${base}`
        : status.mainCheckout.branch !== status.baseBranch
          ? `The main checkout is on ${status.mainCheckout.branch ?? 'a detached HEAD'}`
          : status.mainCheckout.dirty
            ? 'The main checkout has uncommitted changes'
            : null;
  const prBlocked = !status ? 'Checking…' : !status.hasRemote ? 'No remote to push to' : status.ahead === 0 && status.uncommitted === 0 ? 'No commits to open a PR with' : null;
  const removeBlocked = !status ? 'Checking…' : status.uncommitted > 0 ? 'Commit or revert the uncommitted changes first' : null;

  const entries: MenuEntry[] = [
    { heading: status?.branch ?? 'Worktree' },
    ...(error ? [{ heading: error }] : status ? [{ heading: describe(status) }] : [{ heading: 'Checking…' }]),
    'separator',
    { label: 'Commit with Claude', icon: <GitCommitHorizontal size={13} />, disabled: !status || status.uncommitted === 0, onSelect: onCommit },
    { label: `Merge into ${base}…`, icon: <GitMerge size={13} />, disabled: mergeBlocked !== null, onSelect: () => setConfirm('merge') },
    { label: 'Create pull request…', icon: <GitPullRequest size={13} />, disabled: prBlocked !== null, onSelect: () => setConfirm('pr') },
    'separator',
    { label: 'Remove worktree…', icon: <Trash2 size={13} />, danger: true, disabled: removeBlocked !== null, onSelect: () => (setDeleteBranch(true), setConfirm('remove')) },
  ];
  // Say why an action is unavailable, under the actions.
  const why = [mergeBlocked && status && `Merge: ${mergeBlocked}.`, prBlocked && status && `PR: ${prBlocked}.`, removeBlocked && status && `Remove: ${removeBlocked}.`].filter(Boolean) as string[];
  if (why.length) entries.push('separator', ...why.map((text) => ({ heading: text })));

  const unsafeToDelete = status !== null && status.ahead > 0 && (status.unpushed === null || status.unpushed > 0);

  return (
    <>
      <button
        type="button"
        data-worktree-menu
        onClick={(e) => {
          load();
          menu.openBelow(e.currentTarget);
        }}
        data-tooltip="Finish this worktree: merge, pull request or remove"
        className="no-drag flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-1.5 text-[11.5px] text-muted hover:bg-border/50"
      >
        <GitBranch size={13} />
        <span className="@max-[860px]:hidden">Worktree</span>
        <ChevronDown size={12} />
      </button>
      {menu.at && <Menu x={menu.at.x - 120} y={menu.at.y} width={280} entries={entries} onClose={menu.close} />}

      {confirm && status && client && (
        <ConfirmDialog
          title={confirm === 'merge' ? `Merge ${status.branch} into ${base}?` : confirm === 'pr' ? `Open a pull request for ${status.branch}?` : `Remove this worktree?`}
          danger={confirm === 'remove'}
          confirmLabel={confirm === 'merge' ? 'Merge' : confirm === 'pr' ? 'Push and open PR' : 'Remove'}
          body={
            confirm === 'merge' ? (
              <p>
                Merges {plural(status.ahead, 'commit', 'commits')} into {base} in the main checkout (<span className="font-mono">{status.root}</span>), in a terminal tab so you can see the result. The worktree stays; remove it afterwards.
              </p>
            ) : confirm === 'pr' ? (
              <p>
                Pushes <span className="font-mono">{status.branch}</span> to origin, then opens GitHub's pull request page with <span className="font-mono">gh pr create --fill --web</span>. Needs the GitHub CLI.
                {status.uncommitted > 0 && ' Uncommitted changes are not included; commit them first.'}
              </p>
            ) : (
              <>
                <p>
                  Deletes the folder <span className="font-mono">{status.path}</span> and stops this session in Switchboard. The conversation stays in your history.
                </p>
                <Checkbox checked={deleteBranch} onChange={setDeleteBranch} className="mt-3 text-text" dataAttrs={{ 'data-delete-branch': true }}>
                  Also delete the branch <span className="font-mono">{status.branch}</span>
                </Checkbox>
                {deleteBranch && unsafeToDelete && (
                  <p className="mt-2 text-warn">
                    {plural(status.ahead, 'commit is', 'commits are')} not in {base}
                    {status.unpushed === null ? ' and the branch was never pushed' : ' and not pushed'}: deleting the branch loses {status.ahead === 1 ? 'it' : 'them'}.
                  </p>
                )}
              </>
            )
          }
          onConfirm={async () => {
            await client.call('worktree.finish', { sessionId, cwd, action: confirm, deleteBranch: confirm === 'remove' && deleteBranch });
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
