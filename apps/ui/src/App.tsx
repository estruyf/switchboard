import { useEffect } from 'react';
import { NewSessionView } from './components/newSession/NewSessionView.tsx';
import { HomeView } from './components/home/HomeView.tsx';
import { TooltipLayer } from './components/ui/Tooltip.tsx';
import { useOpenIn } from './components/OpenInButton.tsx';
import { LinkError } from './components/LinkError.tsx';
import { QuitPrompt } from './components/QuitPrompt.tsx';
import { CommandPalette } from './components/palette/CommandPalette.tsx';
import { SearchDialog } from './components/search/SearchDialog.tsx';
import { AddProjectDialog } from './components/projects/AddProjectDialog.tsx';
import { BackupDialogs } from './components/backup/BackupDialogs.tsx';
import { ProjectManagerView } from './components/projects/ProjectManagerView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { useUsageSync } from './components/UsageBand.tsx';
import { Sidebar } from './components/sidebar/Sidebar.tsx';
import { TranscriptView } from './components/transcript/TranscriptView.tsx';
import { useReadyReport } from './engine/useReadyReport.ts';
import { isActiveHost, useHosts } from './state/hostsStore.ts';
import { useLinksSync } from './state/linksStore.ts';
import { useSessions, type Pane } from './state/sessionsStore.ts';
import { useOverlay } from './state/overlayStore.ts';
import { usePreferencesSync } from './state/preferencesStore.ts';
import { useProfilesSync } from './state/profilesStore.ts';
import { useProjects, useProjectsSync } from './state/projectsStore.ts';
import { useSidebarSync } from './state/sidebarStore.ts';
import { useTerminals, useTerminalsSync } from './state/terminalsStore.ts';
import { useUpdatesSync } from './state/updatesStore.ts';
import { useClaudeUpdateSync } from './state/claudeUpdateStore.ts';
import { useHostsSync } from './state/useHostsSync.ts';
import { useSessionsSync } from './state/useSessionsSync.ts';

/** ⌘N new session, ⌘O open the current session's folder in the default editor, ⌘J toggle the terminal (⌘⇧J maximize it), ⌘K palette, ⌘⇧F search. */
function useShortcuts() {
  const openIn = useOpenIn();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        useSessions.getState().goHome();
        return;
      }
      if (event.metaKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        const overlay = useOverlay.getState();
        if (overlay.open === 'search') overlay.close();
        else overlay.show('search');
        return;
      }
      if (event.metaKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') {
        // ⌘⇧J: the terminal takes the whole session view, or gives it back. Closed, it opens maximized.
        if (useSessions.getState().view === 'session') {
          event.preventDefault();
          const { panelOpen, togglePanel, setMaximized } = useTerminals.getState();
          if (panelOpen) setMaximized();
          else {
            togglePanel();
            setMaximized(true);
          }
        }
        return;
      }
      if (!event.metaKey || event.shiftKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === '\\') {
        // ⌘\ closes the other pane.
        const { splitId, activePane, closePane } = useSessions.getState();
        if (splitId) {
          event.preventDefault();
          closePane(activePane === 'main' ? 'split' : 'main');
        }
        return;
      }
      if (key === 'k') {
        // In the terminal, ⌘K clears the screen as usual.
        if ((event.target as HTMLElement | null)?.closest?.('.xterm')) return;
        event.preventDefault();
        const overlay = useOverlay.getState();
        if (overlay.open === 'palette') overlay.close();
        else overlay.show('palette');
      } else if (key === 'j') {
        if (useSessions.getState().view === 'session') {
          event.preventDefault();
          useTerminals.getState().togglePanel();
        }
      } else if (key === 'n') {
        event.preventDefault();
        useSessions.getState().openNewSession();
      } else if (key === 'o') {
        const { view, selectedId, sessions, live } = useSessions.getState();
        if (view !== 'session' || !selectedId) return;
        const host = useHosts.getState().hosts.get(selectedId);
        const cwd = (isActiveHost(host) ? host.cwd : null) ?? sessions.get(selectedId)?.cwd ?? live.get(selectedId)?.cwd;
        if (cwd) {
          event.preventDefault();
          void openIn(cwd).catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIn]);
}

/** Keeps main informed about what's on screen, and opens sessions main asks for (notification clicks). */
function useWindowFocus() {
  const view = useSessions((s) => s.view);
  const selectedId = useSessions((s) => s.selectedId);
  useEffect(() => {
    window.switchboard?.reportFocus(view === 'session' ? selectedId : null);
  }, [view, selectedId]);
  useEffect(() => window.switchboard?.onSelectSession((id) => useSessions.getState().select(id)), []);
  // Switchboard → Settings… (⌘,) or Check for Updates… (About) in the menu bar.
  useEffect(() => window.switchboard?.onOpenSettings((section) => useSessions.getState().openSettings(section ?? undefined)), []);
}

export function App() {
  useSessionsSync();
  useHostsSync();
  useProjectsSync();
  useProfilesSync();
  useTerminalsSync();
  useUpdatesSync();
  useClaudeUpdateSync();
  useSidebarSync();
  useUsageSync();
  usePreferencesSync();
  // Listen for links before telling main the window is ready: main hands over waiting links then.
  useLinksSync();
  useReadyReport();
  useShortcuts();
  useWindowFocus();
  const view = useSessions((s) => s.view);
  const settingsFrom = useSessions((s) => s.settingsFrom);
  const behind = view === 'settings' ? settingsFrom : view;
  const mainId = useSessions((s) => s.mainId);
  const splitId = useSessions((s) => s.splitId);
  const activePane = useSessions((s) => s.activePane);
  const overlay = useOverlay((s) => s.open);
  const adding = useProjects((s) => s.adding);
  const panes: { id: string; pane: Pane | null }[] = !mainId
    ? []
    : splitId && splitId !== mainId
      ? [
          { id: mainId, pane: 'main' },
          { id: splitId, pane: 'split' },
        ]
      : [{ id: mainId, pane: null }];

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Settings is a sheet over the view it opened from, which stays on screen (inert) behind it. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={view === 'settings'}>
        {behind === 'projects' ? (
          <ProjectManagerView />
        ) : behind === 'new' ? (
          <NewSessionView />
        ) : mainId ? (
          // One session, or two side by side. Both cases share this tree and each pane is keyed by its
          // session, so opening or closing a split never remounts the session that stays (its unsent
          // message, scroll and Find). Clicking in a pane makes it the active one.
          <div className="flex min-h-0 flex-1" data-split={splitId ? true : undefined}>
            {panes.map(({ id, pane }) => (
              // The inactive pane dims as a whole, and brightens a little on hover to say a click makes it active.
              <div
                key={id}
                className={`flex min-w-0 flex-1 flex-col transition-opacity duration-150 ${pane === 'split' ? 'border-l border-border' : ''} ${pane && activePane !== pane ? 'opacity-60 hover:opacity-85' : ''}`}
                onMouseDownCapture={pane ? () => useSessions.getState().focusPane(pane) : undefined}
              >
                <TranscriptView sessionId={id} pane={pane} active={pane ? activePane === pane : true} />
              </div>
            ))}
          </div>
        ) : (
          <HomeView />
        )}
        </div>
        {view === 'settings' && <SettingsView />}
      </main>
      <QuitPrompt />
      <LinkError />
      {overlay === 'search' && <SearchDialog />}
      {overlay === 'palette' && <CommandPalette />}
      {adding && <AddProjectDialog onClose={() => useProjects.getState().showAdd(false)} />}
      <BackupDialogs />
      <TooltipLayer />
    </div>
  );
}
