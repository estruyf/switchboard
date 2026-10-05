import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useHosts } from '../state/hostsStore.ts';

/** Opens a path in the user's editor, terminal or Finder. Used by the header button, ⌘O and file links. */
export function useOpenIn() {
  const connection = useEngineConnection();
  const setEditors = useHosts((s) => s.setEditors);
  const client = connection.status === 'connected' ? connection.client : null;
  return useCallback(
    async (path: string, options: { line?: number; editorId?: string } = {}) => {
      if (!client) return;
      await client.call('editors.open', { path, ...options });
      // Picking an editor from the menu makes it the default; refresh so the button follows.
      if (options.editorId) {
        const { editors, defaultId } = await client.call('editors.list', {});
        setEditors(editors, defaultId);
      }
    },
    [client, setEditors],
  );
}

const GROUPS: Array<{ kind: EditorInfo['kind']; label: string }> = [
  { kind: 'editor', label: 'Editors' },
  { kind: 'terminal', label: 'Terminals' },
  { kind: 'finder', label: 'Finder' },
];

/** Split button: open the folder in the default editor, or pick another app from the menu. */
export function OpenInButton({ path }: { path: string | null }) {
  const editors = useHosts((s) => s.editors);
  const defaultId = useHosts((s) => s.defaultEditorId);
  const openIn = useOpenIn();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = editors.find((e) => e.id === defaultId) ?? editors[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  if (!path || !current) return null;
  const run = (editorId?: string) => {
    setOpen(false);
    setError(null);
    openIn(path, editorId ? { editorId } : {}).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div ref={menuRef} className="no-drag relative flex shrink-0" title={error ?? undefined}>
      <button
        type="button"
        onClick={() => run()}
        className={`rounded-l-md border border-border px-2.5 py-1 text-[12px] hover:bg-border/50 ${error ? 'text-error' : 'text-text'}`}
        title={`Open ${path} in ${current.name} (⌘O)`}
      >
        Open in {current.name}
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-r-md border border-l-0 border-border px-1.5 text-[10px] text-muted hover:bg-border/50"
        aria-label="Choose app"
      >
        ▾
      </button>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg">
          {GROUPS.map((group) => {
            const items = editors.filter((e) => e.kind === group.kind);
            if (items.length === 0) return null;
            return (
              <div key={group.kind}>
                <p className="px-3 pt-1.5 pb-0.5 text-[10px] tracking-wide text-faint uppercase">{group.label}</p>
                {items.map((editor) => (
                  <button
                    key={editor.id}
                    type="button"
                    onClick={() => run(editor.id)}
                    className="flex w-full items-center justify-between px-3 py-1 text-left text-[12px] hover:bg-accent/15"
                  >
                    {editor.name}
                    {editor.id === defaultId && <span className="text-[10px] text-faint">default</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
