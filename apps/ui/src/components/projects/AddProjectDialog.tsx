import { Check, FolderOpen, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { guessHome, shortAge, tildify } from '../../lib/format.ts';
import { knownFolders } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { manage, useProjectActions } from '../sidebar/ProjectMenu.tsx';

/**
 * Add project: folders Claude Code has sessions for, most recent first and filterable by typing,
 * or any folder through the system dialog. Stays open so several can be added in one go; on closing,
 * the Projects view opens on the last one added so its profile and defaults can be set.
 */
export function AddProjectDialog({ onClose: close }: { onClose(): void }) {
  const projects = useProjects((s) => s.projects);
  const actions = useProjectActions();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastAdded = useRef<string | null>(null);
  const onClose = useCallback(() => {
    close();
    if (lastAdded.current) manage(lastAdded.current);
  }, [close]);
  const home = useMemo(() => guessHome(projects.keys()), [projects]);
  const folders = useMemo(() => knownFolders(projects, query, home), [projects, query, home]);
  // The extra row at the end: the system folder dialog.
  const count = folders.length + 1;

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = async (index: number) => {
    setError(null);
    try {
      if (index === folders.length) {
        const path = await actions.chooseAndAdd();
        if (path) {
          lastAdded.current = path;
          onClose();
        }
        return;
      }
      const folder = folders[index];
      if (folder && !folder.added) {
        await actions.add(folder.root);
        lastAdded.current = folder.root;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-start justify-center bg-scrim pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label="Add project" className="flex max-h-[70vh] w-[600px] max-w-[92vw] flex-col overflow-hidden rounded-xl border overlay" data-add-project-dialog>
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold">Add project</h2>
            <p className="text-[12px] text-muted">Folders you have used Claude Code in, most recent first.</p>
          </div>
          <button type="button" onClick={onClose} className="text-faint hover:text-text" aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(count - 1, i + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
            else if (e.key === 'Enter') (e.preventDefault(), void choose(active));
          }}
          placeholder="Filter by name or path"
          spellCheck={false}
          className="h-10 shrink-0 border-b border-border bg-transparent px-4 text-[13px] text-text outline-none placeholder:text-faint"
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {folders.length === 0 && (
            <p className="px-4 py-3 text-[12px] text-faint">{query ? 'No folder matches.' : 'No Claude Code sessions found yet. Choose a folder instead.'}</p>
          )}
          {folders.map((folder, index) => (
            <button
              key={folder.root}
              type="button"
              data-known-project={folder.root}
              data-added={folder.added}
              data-active={index === active}
              onMouseMove={() => setActive(index)}
              onClick={() => void choose(index)}
              disabled={folder.added}
              data-tooltip={folder.root}
              className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left ${index === active ? 'bg-accent/15' : ''}`}
            >
              <ProjectIcon project={folder} root={folder.root} size={22} />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-[12.5px] text-text">{folder.name}</span>
                <span className="truncate text-[11.5px] text-faint">
                  {tildify(folder.root, home)}
                  {!folder.exists && <span className="text-warn"> · folder not found</span>}
                </span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-faint tabular-nums">
                {folder.sessionCount} {folder.sessionCount === 1 ? 'session' : 'sessions'}
                {folder.lastActivity !== null && <span className="block">{shortAge(folder.lastActivity)}</span>}
              </span>
              <span className="flex w-16 shrink-0 justify-end text-[11.5px]">
                {folder.added ? (
                  <span className="flex items-center gap-1 text-accent-ink">
                    <Check size={12} /> Added
                  </span>
                ) : (
                  <span className={index === active ? 'text-text' : 'text-faint'}>Add</span>
                )}
              </span>
            </button>
          ))}
        </div>
        <footer className="flex items-center gap-3 border-t border-border px-4 py-2.5">
          <button
            type="button"
            data-active={active === folders.length}
            data-choose-folder
            onMouseMove={() => setActive(folders.length)}
            onClick={() => void choose(folders.length)}
            className={`flex h-7 items-center gap-2 rounded-md border border-border px-2.5 text-[12px] text-text hover:bg-border/50 ${active === folders.length ? 'bg-accent/15' : ''}`}
          >
            <FolderOpen size={13} />
            Choose folder…
          </button>
          {error && <span className="min-w-0 flex-1 truncate text-[12px] text-error">{error}</span>}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
