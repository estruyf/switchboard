import { EngineDiagnostics } from './components/EngineDiagnostics.tsx';
import { Sidebar } from './components/sidebar/Sidebar.tsx';
import { TranscriptView } from './components/transcript/TranscriptView.tsx';
import { useReadyReport } from './engine/useReadyReport.ts';
import { useSessions } from './state/sessionsStore.ts';
import { useSessionsSync } from './state/useSessionsSync.ts';

function EmptyState() {
  const count = useSessions((s) => s.sessions.size);
  const liveCount = useSessions((s) => s.live.size);
  return (
    <div className="flex h-full flex-col">
      <div className="drag h-13 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-1 pb-16 text-center">
        <p className="text-[14px] font-medium">Select a session</p>
        <p className="text-[12px] text-muted">
          {count} sessions on this Mac{liveCount > 0 ? `, ${liveCount} open right now` : ''}. Use ↑ ↓ in the sidebar to browse.
        </p>
      </div>
    </div>
  );
}

export function App() {
  useSessionsSync();
  useReadyReport();
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
        ) : selectedId ? (
          <TranscriptView key={selectedId} sessionId={selectedId} />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}
