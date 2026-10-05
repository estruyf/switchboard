export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Leaves room for the macOS traffic lights and doubles as a window drag handle. */}
      <div className="drag h-13 shrink-0" />

      <div className="px-3">
        <button
          type="button"
          disabled
          title="Arrives in Phase 3"
          className="no-drag flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-1.5 text-left text-[13px] text-faint"
        >
          <span>New session</span>
          <kbd className="font-sans text-[11px]">⌘N</kbd>
        </button>
      </div>

      <nav className="mt-5 flex-1 overflow-y-auto px-3">
        <h2 className="px-1 text-[11px] font-medium tracking-wide text-faint uppercase">Sessions</h2>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted">
          Your Claude Code sessions will show up here once session discovery lands in Phase 2.
        </p>
      </nav>
    </aside>
  );
}
