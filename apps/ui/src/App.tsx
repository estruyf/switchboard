import { EngineDiagnostics } from './components/EngineDiagnostics.tsx';
import { Sidebar } from './components/Sidebar.tsx';

export function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="drag flex h-13 shrink-0 items-center border-b border-border px-6">
          <h1 className="text-[13px] font-semibold">Engine diagnostics</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          <EngineDiagnostics />
        </div>
      </main>
    </div>
  );
}
