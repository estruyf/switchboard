import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useHosts } from '../state/hostsStore.ts';
import { Popover } from './ui/Popover.tsx';

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

/** The folder's page on GitHub, or null when it has no GitHub remote (or the engine isn't connected). */
function useGithubPage(path: string | null) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [page, setPage] = useState<{ repo: string; url: string } | null>(null);
  useEffect(() => {
    setPage(null);
    if (!client || !path) return;
    let cancelled = false;
    client
      .call('git.github', { cwd: path })
      .then((result) => !cancelled && setPage(result))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, path]);
  return page;
}

const MENU_WIDTH = 208;
const item = 'flex w-full items-center justify-between px-3 py-1 text-left text-[12px] hover:bg-accent/15';

/** Split button: open the folder in the default editor, or pick another app (or GitHub) from the menu. */
export function OpenInButton({ path }: { path: string | null }) {
  const editors = useHosts((s) => s.editors);
  const defaultId = useHosts((s) => s.defaultEditorId);
  const openIn = useOpenIn();
  const github = useGithubPage(path);
  // The menu is a fixed popover, so the transcript below the header can't paint over it.
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);
  const current = editors.find((e) => e.id === defaultId) ?? editors[0];

  if (!path || !current) return null;
  const run = (editorId?: string) => {
    setOpen(null);
    setError(null);
    openIn(path, editorId ? { editorId } : {}).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const toggle = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    setOpen(open || !rect ? null : { x: rect.right - MENU_WIDTH, y: rect.bottom + 4 });
  };

  return (
    <div ref={wrapperRef} className="no-drag relative flex shrink-0" data-tooltip={error ?? undefined}>
      <button
        type="button"
        onClick={() => run()}
        className={`rounded-l-md border border-border px-2.5 py-1 text-[12px] hover:bg-border/50 ${error ? 'text-error' : 'text-text'}`}
        data-tooltip={`Open ${path} in ${current.name} (⌘O)`}
      >
        {/* In a narrow pane (container query on the session view) only the app name stays. */}
        <span className="@max-[860px]:hidden">Open in </span>
        {current.name}
      </button>
      <button
        type="button"
        onClick={toggle}
        className="rounded-r-md border border-l-0 border-border px-1.5 text-[10px] text-muted hover:bg-border/50"
        aria-label="Choose app"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        data-open-in-menu
      >
        ▾
      </button>
      {open && (
        <Popover x={open.x} y={open.y} width={MENU_WIDTH} anchor={wrapperRef} onClose={close} role="menu" data-menu="open-in">
          {GROUPS.map((group) => {
            const items = editors.filter((e) => e.kind === group.kind);
            if (items.length === 0) return null;
            return (
              <div key={group.kind}>
                <p className="px-3 pt-1.5 pb-0.5 text-[10px] tracking-wide text-faint uppercase">{group.label}</p>
                {items.map((editor) => (
                  <button key={editor.id} type="button" role="menuitem" onClick={() => run(editor.id)} className={item}>
                    {editor.name}
                    {editor.id === defaultId && <span className="text-[10px] text-faint">default</span>}
                  </button>
                ))}
              </div>
            );
          })}
          {github && (
            <div>
              <p className="px-3 pt-1.5 pb-0.5 text-[10px] tracking-wide text-faint uppercase">Web</p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(null);
                  // The main process opens http(s) links from window.open in the browser.
                  window.open(github.url, '_blank');
                }}
                className={item}
                data-tooltip={github.url}
                data-open-github={github.url}
              >
                GitHub
                <span className="min-w-0 truncate pl-2 text-[10px] text-faint">{github.repo}</span>
              </button>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}
