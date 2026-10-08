import { useEffect, useMemo, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename } from '../../lib/format.ts';
import { findModelOption } from '../../lib/models.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useLater } from '../../state/laterStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { isActive } from '../../state/sidebarRows.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { useThemes } from '../../state/themeStore.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { planGit } from '../git/gitPlan.ts';
import { inWorktree } from '../worktree/branchMenu.ts';
import type { PaletteContext, PaletteGit, PaletteSession, PaletteView } from './paletteContext.ts';

/** The checkout's state for the git commands, read once when the palette opens (null outside git). */
function useGitState(cwd: string | null, busy: boolean): PaletteGit | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [git, setGit] = useState<PaletteGit | null>(null);
  useEffect(() => {
    setGit(null);
    if (!client || !cwd) return;
    let cancelled = false;
    Promise.all([client.call('worktree.status', { cwd }), client.call('git.changes', { cwd, base: 'uncommitted' })]).then(
      ([status, changes]) => {
        if (cancelled) return;
        const plan = planGit(status, busy);
        setGit({
          changed: changes.files.length,
          unstaged: changes.files.filter((file) => !file.staged).length,
          hasRemote: status.hasRemote,
          prBlocked: plan.blocked.pr,
          pullable: plan.blocked.pull === null,
        });
      },
      () => !cancelled && setGit(null),
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, busy]);
  return git;
}

/** Where you are, from the stores: what every command's `when()` reads. */
export function usePaletteContext(): PaletteContext {
  const connection = useEngineConnection();
  const connected = connection.status === 'connected';
  const mainView = useSessions((s) => s.view);
  const selectedId = useSessions((s) => s.selectedId);
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const splitId = useSessions((s) => s.splitId);
  const settingsSection = useSessions((s) => s.settingsSection);
  const hosts = useHosts((s) => s.hosts);
  const permissions = useHosts((s) => s.permissions);
  const models = useHosts((s) => s.models);
  const projects = useProjects((s) => s.projects);
  const projectFilter = useProjects((s) => s.filter);
  const prefs = usePreferences((s) => s.prefs);
  const themes = useThemes((s) => s.themes);
  const activeTheme = useThemes((s) => s.active.entry.id);
  const laterCount = useLater((s) => s.items.length);
  const digest = usePaletteBus((s) => s.digest);
  const newSessionInfo = usePaletteBus((s) => s.newSessionInfo);
  const panelOpen = useTerminals((s) => s.panelOpen);
  const maximized = useTerminals((s) => s.maximized);
  const dock = useTerminals((s) => s.dock);
  const terminals = useTerminals((s) => s.terminals);
  const activeTerminals = useTerminals((s) => s.active);
  const sidebar = useSidebar((s) => s.state);

  const view: PaletteView = mainView === 'new' ? 'new-session' : mainView === 'settings' ? 'settings' : mainView === 'projects' ? 'projects' : selectedId ? 'session' : 'home';
  const id = view === 'session' ? selectedId : null;

  const session = useMemo<PaletteSession | null>(() => {
    if (!id) return null;
    const row = toRows(sessions, live, hosts).find((r) => r.id === id);
    const host = hosts.get(id);
    const active = isActiveHost(host) ? host : null;
    const summary = sessions.get(id) ?? null;
    const cwd = active?.cwd ?? summary?.cwd ?? live.get(id)?.cwd ?? null;
    const waitingOn = [...permissions.values()].filter((p) => p.sessionId === id);
    const ownDigest = digest?.sessionId === id ? digest : null;
    return {
      id,
      title: row?.title ?? 'New session',
      indexed: summary !== null,
      pinned: summary?.pinned ?? false,
      archived: row ? !isActive(row, Date.now()) : false,
      cwd,
      projectRoot: summary?.projectRoot ?? live.get(id)?.projectRoot ?? null,
      isWorktree: Boolean(summary?.worktree || (cwd && inWorktree(cwd))),
      host: active
        ? { state: active.state, contextTokens: active.contextTokens, supportsEffort: findModelOption(models, active.model)?.supportsEffort ?? true }
        : null,
      running: active?.state === 'running' || active?.state === 'needs-you',
      waiting: waitingOn.length === 0 ? null : waitingOn.some((p) => p.toolName === 'AskUserQuestion') ? 'question' : 'permission',
      prompts: ownDigest?.prompts.length ?? 0,
      hasReply: !!ownDigest?.lastReply,
    };
  }, [id, sessions, live, hosts, permissions, models, digest]);

  const git = useGitState(session?.cwd ?? null, session?.running ?? false);
  const projectRoot = session?.projectRoot ?? null;
  const { actions } = useProjectActionList(projectRoot);

  const added = useMemo(() => addedProjects(projects), [projects]);
  const currentRoot = projectRoot?.startsWith('/') ? projectRoot : projectFilter;
  const activeTerminal = id ? (terminals.get(activeTerminals.get(id) ?? '') ?? [...terminals.values()].filter((t) => t.sessionId === id).at(-1)) : undefined;

  return {
    view,
    connected,
    session,
    git: session?.cwd ? git : null,
    terminal: {
      open: panelOpen,
      maximized,
      dock,
      action: activeTerminal?.kind === 'action' && activeTerminal.sessionId === id ? { running: activeTerminal.exitCode === null } : null,
    },
    split: splitId !== null,
    focusLimit: prefs.focusLimit,
    laterCount,
    projectCount: added.length,
    currentProject: currentRoot ? { root: currentRoot, name: projects.get(currentRoot)?.name ?? basename(currentRoot) } : null,
    actions: actions.map((a) => ({ id: a.id, name: a.name, shortcut: a.shortcut ?? null, icon: a.icon })),
    canEditActions: !!projectRoot?.startsWith('/'),
    colorScheme: prefs.colorScheme,
    themes: themes.map((t) => ({ id: t.id, name: t.file.name })),
    themeId: activeTheme,
    sidebarStyle: prefs.sidebarStyle,
    sidebar,
    settingsSection,
    newSession: view === 'new-session' ? newSessionInfo : null,
  };
}
