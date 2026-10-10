import { Download, ImageOff, Maximize2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ImageRef } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { toast } from '../../state/toastStore.ts';
import { Menu } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { useModalFocus } from '../ui/useModalFocus.ts';
import { imageFileName, parseDataUrl } from './imageFile.ts';

/** Fetched images as data URLs, shared across views; small LRU so long sessions don't hold everything. */
const cache = new Map<string, Promise<string>>();
const CACHE_SIZE = 60;

function useImage(sessionId: string, ref: ImageRef): { url: string | null; failed: boolean } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const key = `${sessionId}|${ref.imageId}`;
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let pending = cache.get(key);
    if (!pending) {
      pending = client.call('transcript.image', { sessionId, imageId: ref.imageId }).then(({ mediaType, data }) => `data:${mediaType};base64,${data}`);
      pending.catch(() => cache.delete(key));
      cache.set(key, pending);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    pending.then(
      (url) => !cancelled && setState({ url, failed: false }),
      () => !cancelled && setState({ url: null, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, key, sessionId, ref.imageId]);

  return state;
}

/** Asks where to save an image (a data URL) and writes it there; a toast says where it went. */
async function saveImage(url: string, imageId: string) {
  const image = parseDataUrl(url);
  const bridge = window.switchboard;
  if (!image || !bridge) return;
  try {
    const path = await bridge.saveImage({ ...image, fileName: imageFileName(imageId, image.mediaType) });
    if (!path) return;
    toast('Image saved', {
      body: path.split('/').pop(),
      actions: [{ label: 'Show in Finder', onSelect: () => bridge.showSavedImage(path) }],
      data: { 'data-image-saved': path },
    });
  } catch {
    toast('The image couldn’t be saved');
  }
}

function Lightbox({ url, description, onSave, onClose }: { url: string; description: string; onSave(): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSave]);
  // Above dialogs (z-60), so it opens over a subagent's transcript, and under the toasts (z-70), so "Image saved" shows.
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={description} className="no-drag fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-8" onClick={onClose} data-lightbox>
      <img src={url} alt={description} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" />
      {/* On the card surface, so both stay readable over the dark backdrop in either mode. */}
      <span className="overlay absolute top-4 right-4 flex items-center gap-1 rounded-lg p-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="quiet" icon={<Download size={14} />} kbd="⌘S" onClick={onSave} data-lightbox-save>
          Save
        </Button>
        <Button variant="quiet" iconOnly aria-label="Close" kbd="Esc" icon={<X size={16} />} onClick={onClose} />
      </span>
    </div>,
    document.body,
  );
}

const kb = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** An image from the transcript: a thumbnail that opens full size and can be saved. `maxWidth` keeps several in a row (never wider than their column). */
export function TranscriptImage({ sessionId, image, maxHeight = 320, maxWidth }: { sessionId: string; image: ImageRef; maxHeight?: number; maxWidth?: number }) {
  const { url, failed } = useImage(sessionId, image);
  const [open, setOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<ContextMenuPoint | null>(null);
  // No caption to go on, so describe what kind of image it is ("PNG image, 120 KB").
  const description = `${image.mediaType.replace(/^image\//, '').toUpperCase()} image, ${kb(image.bytes)}`;
  const save = () => url && void saveImage(url, image.imageId);
  if (failed) {
    return (
      <span className="flex h-16 w-28 items-center justify-center gap-1 rounded-md border border-border text-meta text-muted" data-tooltip="This image couldn’t be loaded">
        <ImageOff size={13} /> Unavailable
      </span>
    );
  }
  // Right-click and Shift+F10 open the same menu.
  const onContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (!url) return;
    e.preventDefault();
    const pointer = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null;
    setMenuAt(contextMenuPoint(pointer, e.currentTarget.getBoundingClientRect(), window.innerHeight));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!url || !isContextMenuKey(e)) return;
    e.preventDefault();
    setMenuAt(contextMenuPoint(null, e.currentTarget.getBoundingClientRect(), window.innerHeight));
  };
  return (
    <>
      <span className="group/image relative block w-fit">
        <button
          type="button"
          onClick={() => url && setOpen(true)}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          data-tooltip={`${image.mediaType} · ${kb(image.bytes)} · click to enlarge`}
          aria-label={`${description}: show full size`}
          className="block overflow-hidden rounded-md border border-border bg-sidebar"
          data-transcript-image
        >
          {url ? (
            <img src={url} alt={description} style={{ maxHeight, maxWidth: maxWidth ? `min(100%, ${maxWidth}px)` : undefined }} className="block max-w-full object-contain" draggable={false} />
          ) : (
            <span className="block h-24 w-40 animate-pulse bg-border/40" />
          )}
        </button>
        {/* On the card surface, so it stays visible over any image; shown on hover and keyboard focus. */}
        {url && (
          <span className="overlay absolute top-1 right-1 rounded-md opacity-0 transition-opacity group-focus-within/image:opacity-100 group-hover/image:opacity-100">
            <Button variant="quiet" size="sm" iconOnly aria-label="Save image…" icon={<Download size={13} />} onClick={save} data-transcript-image-save />
          </span>
        )}
      </span>
      {menuAt && (
        <Menu
          x={menuAt.x}
          y={menuAt.y}
          above={menuAt.above}
          width={180}
          label="Image"
          onClose={() => setMenuAt(null)}
          entries={[
            { label: 'Show full size', icon: <Maximize2 size={13} />, onSelect: () => setOpen(true) },
            { label: 'Save image…', icon: <Download size={13} />, onSelect: save, data: { 'data-image-menu-save': true } },
          ]}
        />
      )}
      {open && url && <Lightbox url={url} description={description} onSave={save} onClose={() => setOpen(false)} />}
    </>
  );
}
