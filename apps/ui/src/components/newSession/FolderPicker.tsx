import { FolderPlus, Plus, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { basename, tildify } from '../../lib/format.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { filterFolders, quickTiles, type TileTone } from './projectTiles.ts';

const COLUMNS = 5;
/** Tiles shown before "+N More projects": the fifth place is that tile. */
const QUICK = 4;

const TONE_DOT: Record<TileTone, string> = { 'needs-you': 'bg-warn animate-pulse', working: 'bg-accent-ink', idle: 'bg-faint/60' };
const TONE_TEXT: Record<TileTone, string> = { 'needs-you': 'text-warn', working: 'text-accent-ink', idle: 'text-muted' };

/**
 * Where a new session starts: the four most recent projects as tiles, and a fifth tile that opens all
 * of them with a filter field (typing a name filters, typing an absolute path offers that folder, and
 * "Other folder…" opens the system dialog). ⌘1 to ⌘9 pick the tiles in view. The open list is a
 * combobox: focus stays in the filter field and `aria-activedescendant` says which tile the arrows are on.
 */
export function FolderPicker({
  value,
  folders,
  home,
  branches,
  statusOf,
  onChange,
  onChooseOther,
  shortcuts,
  openRequest = 0,
}: {
  value: string | null;
  /** Your projects, most recent first. */
  folders: string[];
  home: string | null;
  /** The checked-out branch per folder, where known (tooltips). */
  branches: Map<string, string | null>;
  statusOf(folder: string): { tone: TileTone; label: string };
  onChange(folder: string): void;
  onChooseOther(): void;
  /** ⌘1 to ⌘9 pick a tile (off while something covers the view, like Settings). */
  shortcuts: boolean;
  /** Changing it opens the full list (a link that didn't say which project, or the project in the message box). */
  openRequest?: number;
}) {
  const projects = useProjects((s) => s.projects);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const optionId = (index: number) => `${id}-option-${index}`;
  const nameOf = (folder: string) => projects.get(folder)?.name ?? basename(folder);

  const quick = useMemo(() => quickTiles(folders, value, QUICK), [folders, value]);
  const options = useMemo(() => {
    const all = value && !folders.includes(value) ? [value, ...folders] : folders;
    return filterFolders(all, filter, (folder) => projects.get(folder)?.name ?? basename(folder), home);
  }, [filter, folders, home, projects, value]);
  const more = folders.filter((folder) => !quick.includes(folder)).length;
  // The extra tile at the end of the full list: the system folder dialog.
  const count = options.length + 1;
  const shown = open ? options : quick;

  useEffect(() => {
    if (!open) return;
    // Start on the current folder when opening, and on the best match while filtering.
    setActive(filter.trim() ? 0 : Math.max(0, value ? options.indexOf(value) : 0));
  }, [open, filter]);
  useEffect(() => {
    if (openRequest) setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setFilter('');
    if (refocus) requestAnimationFrame(() => toggleRef.current?.focus());
  };
  const choose = (folder: string) => {
    close(false);
    onChange(folder);
  };
  const pick = (index: number) => {
    if (index === options.length) {
      close(false);
      onChooseOther();
    } else if (options[index]) choose(options[index]!);
  };

  // ⌘1 to ⌘9 pick the tiles in view, wherever focus is (the prompt usually has it).
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.metaKey || event.shiftKey || event.altKey || event.ctrlKey || !/^[1-9]$/.test(event.key)) return;
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')) return;
      const folder = shownRef.current[Number(event.key) - 1];
      if (!folder) return;
      event.preventDefault();
      chooseRef.current(folder);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);

  // Typing a letter on a tile opens the full list filtered by it: "start typing its name".
  const typeToSearch = (e: KeyboardEvent) => {
    if (open || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
    e.preventDefault();
    setFilter(e.key);
    setOpen(true);
  };

  const tile = (folder: string, index: number) => {
    const status = statusOf(folder);
    const branch = branches.get(folder);
    const selected = folder === value;
    const highlighted = open && index === active;
    return (
      <button
        key={folder}
        id={open ? optionId(index) : undefined}
        type="button"
        role={open ? 'option' : undefined}
        tabIndex={open ? -1 : undefined}
        aria-selected={open ? selected : undefined}
        aria-pressed={open ? undefined : selected}
        data-folder-option={folder}
        data-active={open ? highlighted : undefined}
        data-tooltip={`${tildify(folder, home)}${branch ? ` · ${branch}` : ''}`}
        onMouseMove={open ? () => setActive(index) : undefined}
        onClick={() => (open ? pick(index) : choose(folder))}
        className={`flex min-w-0 flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors ${
          selected ? 'border-accent-ink/70 bg-selected' : highlighted ? 'border-border bg-border/45' : 'border-border bg-card hover:bg-border/45'
        }`}
      >
        <span className="flex items-center justify-between gap-2">
          <ProjectIcon project={projects.get(folder)} root={folder} size={24} />
          {index < 9 && <Kbd keys={`⌘${index + 1}`} tone="plain" />}
        </span>
        <span className="block truncate text-ui font-semibold text-text">{nameOf(folder)}</span>
        <span className={`flex min-w-0 items-center gap-1.5 text-meta ${TONE_TEXT[status.tone]}`}>
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} />
          <span className="truncate">{status.label}</span>
        </span>
      </button>
    );
  };

  const dashed = 'flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-2.5 text-center text-ui text-muted hover:bg-border/45 hover:text-text';

  return (
    <div className="grid gap-2" data-project-header>
      {open ? (
        <div className="grid gap-2" data-folder-list>
          <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-2.5 focus-within:border-accent-ink/60">
            <Search size={14} className="shrink-0 text-faint" aria-hidden />
            {/* The toggle tile is gone while the list is open, so the field carries its smoke hooks (value, expanded). */}
            <input
              autoFocus
              role="combobox"
              aria-expanded
              data-folder-select
              data-value={value ?? ''}
              aria-controls={`${id}-list`}
              aria-activedescendant={optionId(active)}
              aria-autocomplete="list"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                // Keys that confirm an IME composition (Enter picking a candidate) belong to the input method.
                if (e.nativeEvent.isComposing) return;
                const move = (delta: number) => (e.preventDefault(), setActive((i) => Math.min(count - 1, Math.max(0, i + delta))));
                if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close(true));
                else if (e.key === 'ArrowDown') move(COLUMNS);
                else if (e.key === 'ArrowUp') move(-COLUMNS);
                // Left and right move the caret while there is text to edit.
                else if (e.key === 'ArrowRight' && !filter) move(1);
                else if (e.key === 'ArrowLeft' && !filter) move(-1);
                else if (e.key === 'Enter') (e.preventDefault(), pick(active));
              }}
              placeholder="Filter projects, or type a path"
              aria-label="Filter projects, or type a path"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-faint"
            />
          </label>
          <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Your projects" className="grid max-h-80 grid-cols-5 gap-2 overflow-y-auto p-px">
            {options.map(tile)}
            <button
              id={optionId(options.length)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={false}
              data-active={active === options.length}
              data-choose-folder
              onMouseMove={() => setActive(options.length)}
              onClick={() => pick(options.length)}
              className={`${dashed} ${active === options.length ? 'bg-border/45 text-text' : ''}`}
            >
              <FolderPlus size={16} aria-hidden />
              Other folder…
            </button>
          </div>
          {options.length === 0 && <p className="px-1 text-meta text-muted">No project matches.</p>}
          <Button ref={toggleRef} variant="quiet" size="sm" data-folder-select data-value={value ?? ''} aria-expanded onClick={() => close(true)} className="justify-self-end">
            Show fewer
          </Button>
        </div>
      ) : (
        <div role="group" aria-label="Recent projects" className="grid grid-cols-5 gap-2" onKeyDown={typeToSearch}>
          {quick.map(tile)}
          <button
            ref={toggleRef}
            type="button"
            data-folder-select
            data-value={value ?? ''}
            aria-expanded={false}
            onClick={() => setOpen(true)}
            className={dashed}
          >
            {more > 0 ? <Plus size={16} aria-hidden /> : <Search size={15} aria-hidden />}
            {more > 0 ? `${more} more projects` : quick.length ? 'Other folder…' : 'Choose a folder…'}
          </button>
        </div>
      )}
    </div>
  );
}
