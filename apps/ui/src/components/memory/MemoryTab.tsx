import { BookCopy, FileText, MoreHorizontal, Search, Share2, SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { InstructionFile, MemoryFile } from '@switchboard/protocol/client';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { shortAge } from '../../lib/format.ts';
import { useMemoryView } from '../../state/memoryStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { instructionDetail, relativeTo, typeTone } from './memoryUi.ts';
import { useMemoryFile, useMemoryList } from './useMemoryList.ts';

type Selected = { kind: 'memory'; file: MemoryFile } | { kind: 'instruction'; file: InstructionFile };

/** Opens the share dialog for a memory (it outlives the tab's menus, so the palette's dialog host shows it). */
export const shareMemory = (root: string, memory: MemoryFile) => usePaletteBus.getState().showDialog({ kind: 'share-memory', root, memoryPath: memory.path, name: memory.name });
/** Opens the dialog that copies a section of an instruction file into memory. */
export const copySection = (root: string, file: InstructionFile) => usePaletteBus.getState().showDialog({ kind: 'copy-section', root, file: file.path });

const matchesFilter = (filter: string, ...texts: Array<string | null | undefined>) => {
  const needle = filter.trim().toLowerCase();
  return !needle || texts.some((t) => t?.toLowerCase().includes(needle));
};

/**
 * A project's Memory tab: Claude Code's auto memory for the project (private, on this Mac) and the instruction files
 * the team shares, with the selected file shown read-only. A memory can be shared with the team, and a section of the
 * instructions copied into memory, each from the viewer's header or the row's context menu.
 */
export function MemoryTab({ root }: { root: string }) {
  const { list, error, reload } = useMemoryList(root);
  const openIn = useOpenIn();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ at: ContextMenuPoint; entries: MenuEntry[] } | null>(null);
  const focus = useMemoryView((s) => s.focus);
  const handled = useRef(0);

  // Claude Code writes memory on its own: read the folder again whenever the tab comes back into view.
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  // A file someone asked to see (a memory just saved, the palette): select it once the list has it.
  useEffect(() => {
    if (!focus || focus.root !== root || focus.nonce === handled.current || !list) return;
    if (![...list.memories, ...list.instructions].some((f) => f.path === focus.path)) return;
    handled.current = focus.nonce;
    setSelectedPath(focus.path);
  }, [focus, root, list]);

  const memories = useMemo(() => (list?.memories ?? []).filter((m) => matchesFilter(filter, m.name, m.description, m.type)), [list, filter]);
  const instructions = useMemo(() => (list?.instructions ?? []).filter((i) => matchesFilter(filter, relativeTo(root, i.path))), [list, filter, root]);
  const selected: Selected | null = useMemo(() => {
    const memory = list?.memories.find((m) => m.path === selectedPath);
    if (memory) return { kind: 'memory', file: memory };
    const instruction = list?.instructions.find((i) => i.path === selectedPath);
    if (instruction) return { kind: 'instruction', file: instruction };
    // Nothing picked yet (or it went away): the newest memory, else the first instruction file.
    const first = list?.memories[0];
    if (first) return { kind: 'memory', file: first };
    return list?.instructions[0] ? { kind: 'instruction', file: list.instructions[0] } : null;
  }, [list, selectedPath]);
  // Read again with every new listing: the file may have changed with it.
  const { content, error: readError } = useMemoryFile(root, selected?.file.path ?? null, list);

  const entriesFor = (item: Selected): MenuEntry[] =>
    item.kind === 'memory'
      ? [
          { label: 'Share with the team…', icon: <Share2 size={13} aria-hidden />, onSelect: () => shareMemory(root, item.file), data: { 'data-memory-menu-share': true } },
          { label: 'Open in editor', icon: <SquareArrowOutUpRight size={13} aria-hidden />, onSelect: () => void openIn(item.file.path).catch(() => {}) },
        ]
      : [
          { label: 'Copy a section to my memory…', icon: <BookCopy size={13} aria-hidden />, onSelect: () => copySection(root, item.file), data: { 'data-memory-menu-copy': true } },
          { label: 'Open in editor', icon: <SquareArrowOutUpRight size={13} aria-hidden />, onSelect: () => void openIn(item.file.path).catch(() => {}) },
        ];
  const rowMenu = (item: Selected) => ({
    onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setSelectedPath(item.file.path);
      setMenu({ at: contextMenuPoint({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), window.innerHeight), entries: entriesFor(item) });
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!isContextMenuKey(event)) return;
      event.preventDefault();
      setMenu({ at: contextMenuPoint(null, event.currentTarget.getBoundingClientRect(), window.innerHeight), entries: entriesFor(item) });
    },
  });

  if (error) return <Notice tone="error">{`Couldn't read this project's memory: ${error}`}</Notice>;
  if (!list) return <p className="text-ui text-muted">Reading memory…</p>;

  const rowClass = (path: string) => `grid w-full min-w-0 gap-0.5 rounded-lg px-2.5 py-1.5 text-left ${selected?.file.path === path ? 'bg-selected' : 'hover:bg-border/45'}`;
  return (
    <div className="grid min-h-[480px] grid-cols-[minmax(240px,320px)_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card @max-[860px]:grid-cols-1" data-project-memory-tab data-memory-dir={list.memoryDir ?? ''}>
      <div className="flex min-w-0 flex-col gap-3 border-r border-border p-2.5 @max-[860px]:border-r-0 @max-[860px]:border-b">
        <label className="relative block">
          <span className="sr-only">Filter memory</span>
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter memory"
            className="h-7 w-full rounded-md border border-edge bg-bg pr-2.5 pl-7 text-ui text-text outline-none focus:border-accent-ink"
            data-memory-filter
          />
        </label>
        <section aria-labelledby="memory-project-heading" className="grid gap-0.5">
          <SectionHeader as="h3" headingId="memory-project-heading" count={list.memories.length} className="px-2.5 pb-1">
            Project memory
          </SectionHeader>
          {memories.length === 0 && (
            <p className="px-2.5 text-meta text-muted">{list.memories.length ? 'Nothing matches.' : 'No memory for this project yet. Claude Code writes it as you work.'}</p>
          )}
          {memories.map((memory) => (
            <button
              key={memory.path}
              type="button"
              onClick={() => setSelectedPath(memory.path)}
              aria-current={selected?.file.path === memory.path ? 'true' : undefined}
              className={rowClass(memory.path)}
              data-memory-row={memory.path}
              data-memory-kind="memory"
              {...rowMenu({ kind: 'memory', file: memory })}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-ui font-semibold">{memory.name}</span>
                {memory.type && <Pill tone={typeTone(memory.type)}>{memory.type}</Pill>}
                <span className="ml-auto shrink-0 text-meta text-faint">{shortAge(memory.modified)}</span>
              </span>
              {memory.description && <span className="truncate text-meta text-muted">{memory.description}</span>}
            </button>
          ))}
        </section>
        <section aria-labelledby="memory-instructions-heading" className="grid gap-0.5">
          <SectionHeader as="h3" headingId="memory-instructions-heading" className="px-2.5 pb-1">
            Instructions
          </SectionHeader>
          {instructions.length === 0 && <p className="px-2.5 text-meta text-muted">{list.instructions.length ? 'Nothing matches.' : 'No CLAUDE.md or rules in this project yet.'}</p>}
          {instructions.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => setSelectedPath(file.path)}
              aria-current={selected?.file.path === file.path ? 'true' : undefined}
              className={rowClass(file.path)}
              data-memory-row={file.path}
              data-memory-kind="instruction"
              {...rowMenu({ kind: 'instruction', file })}
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText size={13} className="shrink-0 text-faint" aria-hidden />
                <span className="truncate font-mono text-ui">{relativeTo(root, file.path)}</span>
                <Pill tone={file.shared ? 'muted' : 'default'} className="ml-auto">
                  {file.shared ? 'shared' : 'local only'}
                </Pill>
              </span>
              <span className="truncate pl-5 text-meta text-muted">{instructionDetail(file)}</span>
            </button>
          ))}
        </section>
      </div>
      <div className="flex min-w-0 flex-col" data-memory-viewer={selected?.file.path ?? ''}>
        {selected ? (
          <>
            <div className="flex min-w-0 items-start gap-3 border-b border-border px-4 py-3">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <h3 className="flex min-w-0 items-center gap-2 text-title font-semibold">
                  <span className="truncate">{selected.kind === 'memory' ? selected.file.name : relativeTo(root, selected.file.path)}</span>
                  {selected.kind === 'memory' && selected.file.type && <Pill tone={typeTone(selected.file.type)}>{selected.file.type}</Pill>}
                  {selected.kind === 'instruction' && <Pill tone={selected.file.shared ? 'muted' : 'default'}>{selected.file.shared ? 'shared' : 'local only'}</Pill>}
                </h3>
                <p className="truncate text-meta text-muted">
                  {selected.kind === 'memory' ? (
                    <>
                      {selected.file.description && <>{selected.file.description} · </>}
                      <span className="font-mono" data-tooltip={selected.file.path}>
                        {selected.file.path.split('/').slice(-3).join('/')}
                      </span>
                    </>
                  ) : selected.file.shared ? (
                    'Committed with the project: everyone working on it gets these instructions.'
                  ) : (
                    'Only on this Mac: Claude Code loads it for you, next to the project’s instructions.'
                  )}
                </p>
              </div>
              {selected.kind === 'memory' ? (
                <Button icon={<Share2 size={13} aria-hidden />} onClick={() => shareMemory(root, selected.file)} data-memory-share>
                  Share with the team…
                </Button>
              ) : (
                <Button icon={<BookCopy size={13} aria-hidden />} onClick={() => copySection(root, selected.file)} data-memory-copy>
                  Copy to my memory…
                </Button>
              )}
              <Button
                variant="quiet"
                iconOnly
                icon={<MoreHorizontal size={14} aria-hidden />}
                aria-label="More"
                aria-haspopup="menu"
                onClick={(e) => setMenu({ at: contextMenuPoint(null, e.currentTarget.getBoundingClientRect(), window.innerHeight), entries: entriesFor(selected) })}
              />
            </div>
            <div className="min-h-0 flex-1 p-4">
              {readError ? (
                <Notice tone="error">{`Couldn't read this file: ${readError}`}</Notice>
              ) : (
                <pre className="overflow-x-auto rounded-lg border border-border bg-code p-4 font-mono text-ui break-words whitespace-pre-wrap select-text" data-memory-content>
                  {content ?? 'Reading…'}
                </pre>
              )}
            </div>
          </>
        ) : (
          <p className="m-auto max-w-sm p-6 text-center text-ui text-muted">Nothing here yet. Claude Code saves what it learns about this project as memory, and CLAUDE.md holds what the team shares.</p>
        )}
      </div>
      {menu && <Menu x={menu.at.x} y={menu.at.y} above={menu.at.above} entries={menu.entries} label="Memory file" onClose={() => setMenu(null)} />}
    </div>
  );
}
