import { GitBranch } from 'lucide-react';
import { openProject } from '../../state/projectPageStore.ts';
import { useWorktreeRows } from '../../state/worktreesStore.ts';
import { Pill } from '../ui/Pill.tsx';

/**
 * "6 worktrees · 2 can go" on a project in the Projects list (green when some can go), opening the project's
 * Worktrees tab. Nothing for a project without worktrees besides its own checkout, or outside git.
 */
export function WorktreePill({ root }: { root: string }) {
  const { rows } = useWorktreeRows(root);
  const count = rows.filter((r) => r.group !== 'main').length;
  if (count === 0) return null;
  const safe = rows.filter((r) => r.group === 'safe').length;
  const label = `${count} ${count === 1 ? 'worktree' : 'worktrees'}${safe ? ` · ${safe} can go` : ''}`;
  return (
    <Pill tone={safe ? 'ok' : 'default'} icon={<GitBranch size={11} aria-hidden />} onClick={() => openProject(root, 'worktrees')} data-tooltip="Show the worktrees" data-worktree-pill={root}>
      {label}
    </Pill>
  );
}
