import { Bug, Check, FlaskConical, GitCommitHorizontal, GitPullRequest, Globe, Package, Play, Rocket, Sparkles, SquareTerminal, Upload, Wrench, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ActionIcon, ListedAction } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

export const ACTION_ICON: Record<ActionIcon, LucideIcon> = {
  play: Play,
  rocket: Rocket,
  'git-commit': GitCommitHorizontal,
  'git-pull-request': GitPullRequest,
  upload: Upload,
  flask: FlaskConical,
  package: Package,
  terminal: SquareTerminal,
  sparkles: Sparkles,
  wrench: Wrench,
  globe: Globe,
  bug: Bug,
  check: Check,
};

export { formatShortcut, RESERVED_SHORTCUTS, shortcutFromEvent } from '../../lib/shortcuts.ts';

/** A project's actions (yours, shared and global), reloaded on demand. */
export function useProjectActionList(projectRoot: string | null) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ actions: ListedAction[]; sharedFile: string | null; errors: string[] }>({ actions: [], sharedFile: null, errors: [] });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Sessions without a recorded folder have no project to hold actions.
    if (!client || !projectRoot?.startsWith('/')) {
      setState({ actions: [], sharedFile: null, errors: [] });
      return;
    }
    let cancelled = false;
    client.call('actions.list', { projectRoot }).then(
      (r) => !cancelled && setState(r),
      () => !cancelled && setState({ actions: [], sharedFile: null, errors: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, projectRoot, version]);

  // An import (in any window) can add, change or remove actions.
  useEffect(() => client?.on('settings.imported', () => setVersion((v) => v + 1)), [client]);

  return { ...state, reload: useCallback(() => setVersion((v) => v + 1), []) };
}
