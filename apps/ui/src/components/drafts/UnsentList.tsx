import { PencilLine, Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { shortAge } from '../../lib/format.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { ProjectIcon, useProjectColor } from '../ProjectIcon.tsx';
import { Popover } from '../ui/Popover.tsx';
import { openDraft, useUnsent, type UnsentEntry } from './useUnsent.ts';

const LIST_WIDTH = 320;

/**
 * Opens the Unsent messages list: above the sidebar's "N unsent" chip when it's on screen, else near the top
 * of the window (the palette's command and the quit prompt, with the sidebar closed).
 */
export function openUnsentList(): void {
  const chip = document.querySelector<HTMLElement>('[data-drafts-count]');
  const rect = chip?.getBoundingClientRect();
  if (rect && rect.width > 0) useDrafts.getState().openList({ x: rect.left, y: rect.top - 6, above: true });
  else useDrafts.getState().openList({ x: Math.max(8, window.innerWidth / 2 - LIST_WIDTH / 2), y: 72, above: false });
}

/** A New session prompt's icon: a + on its project's colour. */
function NewSessionIcon({ entry, size }: { entry: UnsentEntry; size: number }) {
  const color = useProjectColor(entry.project, entry.root);
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center ${color ? 'text-white' : 'bg-accent text-on-accent'}`}
      style={{ width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.22)), background: color ?? undefined }}
    >
      <Plus size={Math.round(size * 0.7)} strokeWidth={2.6} />
    </span>
  );
}

/** A draft's icon: + for New session, else the session's project icon. */
export function DraftIcon({ entry, size }: { entry: UnsentEntry; size: number }) {
  if (entry.item.kind === 'new') return <NewSessionIcon entry={entry} size={size} />;
  return entry.root ? <ProjectIcon project={entry.project} root={entry.root} size={size} /> : <span aria-hidden className="shrink-0" style={{ width: size }} />;
}

/** What a draft's row shows: its icon, title, the start of the draft in italics, and its age. */
export function UnsentRowContent({ entry, now, iconSize = 18 }: { entry: UnsentEntry; now: number; iconSize?: number }) {
  return (
    <>
      <DraftIcon entry={entry} size={iconSize} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-ui text-text">{entry.title}</span>
        <span className="truncate text-meta text-text/80 italic">{entry.item.preview}</span>
      </span>
      <span className="shrink-0 text-meta text-faint tabular-nums">{shortAge(entry.item.updatedAt, now)}</span>
    </>
  );
}

/**
 * "Unsent messages": every draft, newest first, from the sidebar's chip, the palette or the quit prompt. ↑ ↓ move,
 * ↩ opens one with the caret at the end of its text, Esc closes.
 */
export function UnsentList() {
  const at = useDrafts((s) => s.list);
  if (!at) return null;
  return <UnsentPopover at={at} />;
}

function UnsentPopover({ at }: { at: { x: number; y: number; above: boolean } }) {
  const entries = useUnsent();
  const close = useDrafts((s) => s.closeList);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // A click on the footer's chip toggles the list rather than closing and reopening it.
  const anchor = useRef(document.querySelector<HTMLElement>('[data-drafts-count]'));
  const ids = useId();
  const now = Date.now();
  // Focus moves into the list, and back where it was when the list closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    listRef.current?.focus();
    return () => {
      if (before?.isConnected && !document.activeElement?.closest('[data-composer]')) before.focus();
    };
  }, []);
  useEffect(() => {
    if (entries.length === 0) close();
    else if (active >= entries.length) setActive(entries.length - 1);
  }, [entries.length]);
  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(`${ids}-${active}`)}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (entries.length ? (i + step + entries.length) % entries.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[active];
      if (entry) openDraft(entry.item);
    }
  };

  return (
    <Popover x={at.x} y={at.y} above={at.above} width={LIST_WIDTH} onClose={close} anchor={anchor} role="dialog" aria-label="Unsent messages" data-unsent-list>
      <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-ui font-semibold text-text">
        <PencilLine size={12} className="text-faint" aria-hidden />
        Unsent messages
      </div>
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label="Unsent messages, newest first"
        aria-activedescendant={entries[active] ? `${ids}-${active}` : undefined}
        onKeyDown={onKeyDown}
        className="grid gap-px px-1 pb-0.5 outline-none"
      >
        {entries.map((entry, i) => (
          <div
            key={entry.item.key}
            id={`${ids}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => setActive(i)}
            onClick={() => openDraft(entry.item)}
            className={`flex min-w-0 cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 ${i === active ? 'bg-selected' : ''}`}
            data-unsent-item={entry.item.key}
          >
            <UnsentRowContent entry={entry} now={now} />
          </div>
        ))}
      </div>
    </Popover>
  );
}
