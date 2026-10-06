import { useEffect, useRef, useState, type RefObject } from 'react';
import type { DropVerdict } from './images.ts';

export interface DropState {
  /** What a drop would do; null while nothing with files is being dragged over the view. */
  verdict: DropVerdict | null;
  /** The pointer is over the message box itself. */
  over: boolean;
}

const IDLE: DropState = { verdict: null, over: false };
/** `dragover` fires every few dozen milliseconds while a drag hovers; this long without one, it has ended. */
const STALE_MS = 400;

const describe = (data: DataTransfer | null) => ({
  files: !!data && [...data.types].includes('Files'),
  types: data ? [...data.items].filter((item) => item.kind === 'file').map((item) => item.type) : [],
});

const same = (a: DropState, b: DropState) => a.over === b.over && a.verdict?.kind === b.verdict?.kind && (a.verdict?.kind !== 'ok' || b.verdict?.kind !== 'ok' || (a.verdict.attach === b.verdict.attach && a.verdict.mention === b.verdict.mention && a.verdict.full === b.verdict.full));

/**
 * Tracks files dragged over the view around a composer: the closest `[data-drop-zone]` ancestor (the
 * session view, or the New session view), else the composer itself. Each pane has its own zone, so
 * with two sessions side by side only the one under the pointer reacts. Dropping anywhere in the zone
 * hands the files over (with which of them are folders) when `verdict` accepts them; otherwise the
 * drop is refused.
 */
export function useDropTarget(
  composer: RefObject<HTMLElement | null>,
  verdict: (drag: ReturnType<typeof describe>) => DropVerdict | null,
  onFiles: (files: File[], directories: boolean[]) => void,
): DropState {
  const [state, setState] = useState<DropState>(IDLE);
  // The handlers are bound once; these keep them on the latest props.
  const latest = useRef({ verdict, onFiles });
  latest.current = { verdict, onFiles };

  useEffect(() => {
    const root = composer.current;
    if (!root) return;
    const zone = root.closest<HTMLElement>('[data-drop-zone]') ?? root;
    // dragenter/dragleave fire for every child crossed; counting them keeps the overlay from flickering.
    let depth = 0;
    let stale: ReturnType<typeof setTimeout> | undefined;
    const update = (next: DropState) => setState((current) => (same(current, next) ? current : next));
    const reset = () => {
      depth = 0;
      clearTimeout(stale);
      update(IDLE);
    };
    const track = (event: DragEvent) => {
      const next = latest.current.verdict(describe(event.dataTransfer));
      if (!next) return null;
      update({ verdict: next, over: root.contains(event.target as Node) });
      // Rows of a virtualised list can unmount mid-drag without a dragleave; a drag that went quiet has left.
      clearTimeout(stale);
      stale = setTimeout(reset, STALE_MS);
      return next;
    };

    const onEnter = (event: DragEvent) => {
      if (track(event)) depth++;
    };
    const onOver = (event: DragEvent) => {
      const next = track(event);
      if (!next || !event.dataTransfer) return;
      // Cancelling dragover is what allows a drop; `none` refuses it (and shows the not-allowed cursor).
      event.preventDefault();
      event.dataTransfer.dropEffect = next.kind === 'ok' ? 'copy' : 'none';
    };
    const onLeave = (event: DragEvent) => {
      const to = event.relatedTarget as Node | null;
      depth--;
      if (depth <= 0 || (to && !zone.contains(to))) reset();
    };
    const onDrop = (event: DragEvent) => {
      const drag = describe(event.dataTransfer);
      if (!drag.files) return;
      event.preventDefault();
      reset();
      if (latest.current.verdict(drag)?.kind !== 'ok' || !event.dataTransfer) return;
      // Which dropped files are folders: only the entries know, and only during the drop event.
      const items = [...event.dataTransfer.items].filter((item) => item.kind === 'file');
      const files = [...event.dataTransfer.files];
      latest.current.onFiles(files, files.map((_, i) => !!items[i]?.webkitGetAsEntry()?.isDirectory));
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && reset();

    zone.addEventListener('dragenter', onEnter);
    zone.addEventListener('dragover', onOver);
    zone.addEventListener('dragleave', onLeave);
    zone.addEventListener('drop', onDrop);
    // Whatever happens elsewhere, the overlay never stays behind.
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', reset);
    return () => {
      clearTimeout(stale);
      zone.removeEventListener('dragenter', onEnter);
      zone.removeEventListener('dragover', onOver);
      zone.removeEventListener('dragleave', onLeave);
      zone.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', reset);
    };
  }, [composer]);

  return state;
}
