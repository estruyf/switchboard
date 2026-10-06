import { useEffect } from 'react';
import { NewSessionView } from './components/newSession/NewSessionView.tsx';
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
import { useSessions } from './state/sessionsStore.ts';
import { useOverlay } from './state/overlayStore.ts';
import { usePreferences, usePreferencesSync } from './state/preferencesStore.ts';
import { addedProjects } from './state/projectList.ts';
import { useProfilesSync } from './state/profilesStore.ts';
import { useProjects, useProjectsSync } from './state/projectsStore.ts';
import { useSidebarSync } from './state/sidebarStore.ts';
import { useTerminals, useTerminalsSync } from './state/terminalsStore.ts';
import { useUpdatesSync } from './state/updatesStore.ts';
import { useClaudeUpdateSync } from './state/claudeUpdateStore.ts';
import { useHostsSync } from './state/useHostsSync.ts';
import { useSessionsSync } from './state/useSessionsSync.ts';

/** ⌘N new session, ⌘O open the current session's folder in the default editor, ⌘J toggle the terminal, ⌘K palette, ⌘⇧F search. */
function useShortcuts() {
  const openIn = useOpenIn();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        const overlay = useOverlay.getState();
        if (overlay.open === 'search') overlay.close();
        else overlay.show('search');
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

function EmptyState() {
  const scope = usePreferences((s) => s.prefs.sessionScope);
  // The sidebar's count: with "Switchboard sessions only", sessions from other apps aren't listed there either.
  const count = useSessions((s) => (scope === 'all' ? s.sessions.size : [...s.sessions.values()].filter((summary) => summary.inApp).length));
  const liveCount = useSessions((s) => s.live.size);
  const noProjects = useProjects((s) => addedProjects(s.projects).length === 0);
  const loaded = useProjects((s) => s.loaded);
  return (
    <div className="flex h-full flex-col">
      <div className="drag h-13 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-1 pb-16 text-center">
        {loaded && noProjects ? (
          <div className="grid max-w-sm justify-items-center gap-1.5" data-onboarding>
            <h1 className="text-[14px] font-medium">Add your first project</h1>
            <p className="text-[12px] text-muted">
              Projects are the folders you start Claude Code sessions in. Pick from the folders you have used Claude Code in, or choose any folder.
            </p>
            <button type="button" onClick={() => useProjects.getState().showAdd(true)} className="mt-2 h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent" data-onboarding-add>
              Add a project
            </button>
          </div>
        ) : (
          <div className="grid max-w-sm justify-items-center gap-1.5">
            <h1 className="text-[14px] font-medium">{count > 0 ? 'Pick a session' : 'No sessions yet'}</h1>
            <p className="text-[12px] text-muted">
              {count > 0
                ? `${count} ${count === 1 ? 'session' : 'sessions'} in the sidebar${liveCount > 0 ? `, ${liveCount} open right now` : ''}. Click one, or use ↑ ↓ there to move through them.`
                : 'Start a session in one of your projects and it shows up in the sidebar.'}
            </p>
            <button type="button" onClick={() => useSessions.getState().openNewSession()} className="mt-2 h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent" data-empty-new-session>
              New session (⌘N)
            </button>
          </div>
        )}
      </div>
    </div>
  );
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
  const mainId = useSessions((s) => s.mainId);
  const splitId = useSessions((s) => s.splitId);
  const activePane = useSessions((s) => s.activePane);
  const overlay = useOverlay((s) => s.open);
  const adding = useProjects((s) => s.adding);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {view === 'settings' ? (
          <SettingsView />
        ) : view === 'projects' ? (
          <ProjectManagerView />
        ) : view === 'new' ? (
          <NewSessionView />
        ) : mainId && splitId ? (
          // Two sessions side by side; clicking in a pane makes it the active one.
          <div className="flex min-h-0 flex-1" data-split>
            <div className="flex min-w-0 flex-1 flex-col" onMouseDownCapture={() => useSessions.getState().focusPane('main')}>
              <TranscriptView key={`main:${mainId}`} sessionId={mainId} pane="main" active={activePane === 'main'} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col border-l border-border" onMouseDownCapture={() => useSessions.getState().focusPane('split')}>
              <TranscriptView key={`split:${splitId}`} sessionId={splitId} pane="split" active={activePane === 'split'} />
            </div>
          </div>
        ) : mainId ? (
          <TranscriptView key={mainId} sessionId={mainId} />
        ) : (
          <EmptyState />
        )}
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
