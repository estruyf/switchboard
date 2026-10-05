import { ChevronDown, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { basename, tildify } from '../../lib/format.ts';
import { fuzzyScore } from '../../lib/fuzzy.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';

/**
 * The folder for a new session: your projects, filterable by typing, with their icons. Typing an
 * absolute path offers that folder; "Choose another folder…" opens the system dialog.
 */
export function FolderPicker({
  value,
  folders,
  home,
  onChange,
  onChooseOther,
}: {
  value: string | null;
  folders: string[];
  home: string | null;
  onChange(folder: string): void;
  onChooseOther(): void;
}) {
  const projects = useProjects((s) => s.projects);
  const [open, setOpen] = useState(false);
  // Opens upward when the field sits near the bottom of the window (it usually does).
  const [upward, setUpward] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const all = value && !folders.includes(value) ? [value, ...folders] : folders;
    if (!filter.trim()) return all;
    // A typed absolute path is offered as it is, for folders that aren't projects yet.
    const typed = filter.trim().replace(/(.)\/+$/, '$1');
    const path = typed.startsWith('/') && !all.includes(typed) ? [typed] : [];
    const matches = all
      .map((folder) => {
        const name = projects.get(folder)?.name ?? basename(folder);
        const score = Math.max(fuzzyScore(filter, name) ?? -Infinity, (fuzzyScore(filter, tildify(folder, home)) ?? -Infinity) - 2);
        return { folder, score };
      })
      .filter((o) => o.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map((o) => o.folder);
    return [...path, ...matches];
  }, [filter, folders, home, projects, value]);
  // The extra row at the end: the system folder dialog.
  const count = options.length + 1;

  useEffect(() => {
    if (!open) return;
    // Start on the current folder when opening, and on the best match while filtering.
    setActive(filter.trim() ? 0 : Math.max(0, value ? options.indexOf(value) : 0));
  }, [open, filter]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (index: number) => {
    setOpen(false);
    setFilter('');
    if (index === options.length) onChooseOther();
    else if (options[index]) onChange(options[index]!);
  };

  const current = value ? (projects.get(value)?.name ?? basename(value)) : null;
  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        data-folder-select
        data-value={value ?? ''}
        onClick={(e) => {
          setUpward(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 340);
          setOpen((o) => !o);
        }}
        className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2 text-left text-[12px] text-text hover:bg-border/30"
      >
        {value ? <ProjectIcon project={projects.get(value)} root={value} size={14} /> : <FolderOpen size={14} className="shrink-0 text-faint" />}
        {current ? (
          <span className="min-w-0 flex-1 truncate">
            {current}
            <span className="text-faint">  —  {tildify(value!, home)}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-faint">Choose a folder…</span>
        )}
        <ChevronDown size={13} className="shrink-0 text-faint" />
      </button>

      {open && (
        <div className={`absolute inset-x-0 z-40 flex max-h-80 ${upward ? 'bottom-full mb-1 flex-col-reverse' : 'top-full mt-1 flex-col'}`} data-folder-panel>
            <div className="flex max-h-80 min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl" data-folder-list>
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') (e.stopPropagation(), setOpen(false));
                else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(count - 1, i + 1)));
                else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
                else if (e.key === 'Enter') (e.preventDefault(), pick(active));
              }}
              placeholder="Filter projects, or type a path"
              spellCheck={false}
              className="h-9 shrink-0 border-b border-border bg-transparent px-3 text-[12.5px] text-text outline-none placeholder:text-faint"
            />
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
              {options.length === 0 && <p className="px-3 py-2 text-[12px] text-faint">No project matches.</p>}
              {options.map((folder, index) => (
                <button
                  key={folder}
                  type="button"
                  data-folder-option={folder}
                  data-active={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => pick(index)}
                  className={`flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] ${index === active ? 'bg-accent/15' : ''}`}
                >
                  <ProjectIcon project={projects.get(folder)} root={folder} size={16} />
                  <span className="shrink-0 text-text">{projects.get(folder)?.name ?? basename(folder)}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{tildify(folder, home)}</span>
                  {folder === value && <span className="shrink-0 text-accent-ink">✓</span>}
                </button>
              ))}
              <button
                type="button"
                data-active={active === options.length}
                onMouseMove={() => setActive(options.length)}
                onClick={() => pick(options.length)}
                className={`flex h-8 w-full items-center gap-2 border-t border-border px-3 text-left text-[12.5px] text-muted ${active === options.length ? 'bg-accent/15' : ''}`}
              >
                <FolderOpen size={14} className="shrink-0" />
                Choose another folder…
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
