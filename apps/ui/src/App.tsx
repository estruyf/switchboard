import { useEffect } from 'react';
import { EngineDiagnostics } from './components/EngineDiagnostics.tsx';
import { NewSessionView } from './components/newSession/NewSessionView.tsx';
import { useOpenIn } from './components/OpenInButton.tsx';
import { Sidebar } from './components/sidebar/Sidebar.tsx';
import { TranscriptView } from './components/transcript/TranscriptView.tsx';
import { useReadyReport } from './engine/useReadyReport.ts';
import { isActiveHost, useHosts } from './state/hostsStore.ts';
import { useSessions } from './state/sessionsStore.ts';
import { useProjectsSync } from './state/projectsStore.ts';
import { useHostsSync } from './state/useHostsSync.ts';
import { useSessionsSync } from './state/useSessionsSync.ts';

/** ⌘N new session, ⌘O open the current session's folder in the default editor. */
function useShortcuts() {
  const openIn = useOpenIn();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.shiftKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        useSessions.getState().setView('new');
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
  const count = useSessions((s) => s.sessions.size);
  const liveCount = useSessions((s) => s.live.size);
  return (
    <div className="flex h-full flex-col">
      <div className="drag h-13 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-1 pb-16 text-center">
        <p className="text-[14px] font-medium">Select a session</p>
        <p className="text-[12px] text-muted">
          {count} sessions on this Mac{liveCount > 0 ? `, ${liveCount} open right now` : ''}. Use ↑ ↓ in the sidebar to browse, or ⌘N to start a new one.
        </p>
      </div>
    </div>
  );
}

export function App() {
  useSessionsSync();
  useHostsSync();
  useProjectsSync();
  useReadyReport();
  useShortcuts();
  const view = useSessions((s) => s.view);
  const selectedId = useSessions((s) => s.selectedId);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {view === 'diagnostics' ? (
          <>
            <header className="drag flex h-13 shrink-0 items-center border-b border-border px-6">
              <h1 className="text-[13px] font-semibold">Engine diagnostics</h1>
            </header>
            <div className="flex-1 overflow-y-auto">
              <EngineDiagnostics />
            </div>
          </>
        ) : view === 'new' ? (
          <NewSessionView />
        ) : selectedId ? (
          <TranscriptView key={selectedId} sessionId={selectedId} />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}
