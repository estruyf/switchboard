import { Check, ChevronsUpDown, FolderOpen, FolderPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { basename, tildify } from '../../lib/format.ts';
import { fuzzyScore } from '../../lib/fuzzy.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';

/**
 * The project header of a new session: the project's tile, name and path. The name opens your
 * projects, filterable by typing; typing an absolute path offers that folder, and "Open another
 * folder…" opens the system dialog.
 */
export function FolderPicker({
  value,
  folders,
  home,
  branches,
  onChange,
  onChooseOther,
  openRequest = 0,
}: {
  value: string | null;
  folders: string[];
  home: string | null;
  /** The checked-out branch per folder, where known. */
  branches: Map<string, string | null>;
  onChange(folder: string): void;
  onChooseOther(): void;
  /** Changing it opens the list (a link that didn't say which project). */
  openRequest?: number;
}) {
  const projects = useProjects((s) => s.projects);
  const [open, setOpen] = useState(false);
  // Opens upward when the header sits near the bottom of the window (a short window).
  const [upward, setUpward] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

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
    if (!openRequest || !trigger.current) return;
    setUpward(window.innerHeight - trigger.current.getBoundingClientRect().bottom < 340);
    setOpen(true);
  }, [openRequest]);
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
    <div ref={ref} className="relative flex min-w-0 items-center gap-3.5" data-project-header>
      {value ? (
        <ProjectIcon project={projects.get(value)} root={value} size={44} />
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-border text-faint">
          <FolderOpen size={20} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-semibold tracking-[0.12em] text-accent-ink uppercase">New session</p>
        <button
          ref={trigger}
          type="button"
          data-folder-select
          data-value={value ?? ''}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            setUpward(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 340);
            setOpen((o) => !o);
          }}
          className="-mx-1.5 flex max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-left hover:bg-border/40"
        >
          <span className={`min-w-0 truncate text-[20px] leading-8 font-semibold ${current ? 'text-text' : 'text-faint'}`}>{current ?? 'Choose a folder…'}</span>
          <ChevronsUpDown size={15} className="shrink-0 text-faint" />
        </button>
        {value && <p className="truncate font-mono text-[11.5px] text-faint" data-tooltip={value}>{tildify(value, home)}</p>}
      </div>

      {open && (
        <div className={`absolute left-[58px] z-40 flex max-h-96 w-[min(27rem,calc(100%-58px))] ${upward ? 'bottom-full mb-1 flex-col-reverse' : 'top-full -mt-3 flex-col'}`} data-folder-panel>
          <div className="flex max-h-96 min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl" data-folder-list role="menu" aria-label="Your projects">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') (e.stopPropagation(), setOpen(false), trigger.current?.focus());
                else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(count - 1, i + 1)));
                else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
                else if (e.key === 'Enter') (e.preventDefault(), pick(active));
                else if (e.key === 'Tab') setOpen(false);
              }}
              placeholder="Filter projects, or type a path"
              aria-label="Filter projects, or type a path"
              spellCheck={false}
              // Type to filter: the field only shows once there is something in it.
              className={filter ? 'h-9 shrink-0 border-b border-border bg-transparent px-3 text-[12.5px] text-text outline-none placeholder:text-faint' : 'sr-only'}
            />
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
              {!filter && <p className="px-3 pt-1.5 pb-1 text-[10px] tracking-wide text-faint uppercase">Your projects</p>}
              {options.length === 0 && <p className="px-3 py-2 text-[12px] text-faint">No project matches.</p>}
              {options.map((folder, index) => {
                const branch = branches.get(folder);
                return (
                  <button
                    key={folder}
                    type="button"
                    role="menuitemradio"
                    aria-checked={folder === value}
                    data-folder-option={folder}
                    data-active={index === active}
                    onMouseMove={() => setActive(index)}
                    onClick={() => pick(index)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${index === active ? 'bg-accent/15' : ''}`}
                  >
                    <ProjectIcon project={projects.get(folder)} root={folder} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-text">{projects.get(folder)?.name ?? basename(folder)}</span>
                      <span className="block truncate font-mono text-[11px] text-faint">
                        {tildify(folder, home)}
                        {branch && ` · ${branch}`}
                      </span>
                    </span>
                    {folder === value && <Check size={14} className="shrink-0 text-accent-ink" />}
                  </button>
                );
              })}
              <button
                type="button"
                role="menuitem"
                data-active={active === options.length}
                onMouseMove={() => setActive(options.length)}
                onClick={() => pick(options.length)}
                className={`mt-1 flex h-9 w-full items-center gap-2.5 border-t border-border px-3 text-left text-[12.5px] text-muted ${active === options.length ? 'bg-accent/15' : ''}`}
              >
                <FolderPlus size={15} className="shrink-0" />
                Open another folder…
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
