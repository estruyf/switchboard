import { ImageOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageRef } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useModalFocus } from '../ui/useModalFocus.ts';

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

function Lightbox({ url, description, onClose }: { url: string; description: string; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={description} className="no-drag fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-8" onClick={onClose} data-lightbox>
      <img src={url} alt={description} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" />
      <button type="button" onClick={onClose} className="absolute top-4 right-4 rounded-full border border-border bg-card p-1.5 text-text" aria-label="Close" data-tooltip="Close (Esc)">
        <X size={16} />
      </button>
    </div>,
    document.body,
  );
}

const kb = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** An image from the transcript: a thumbnail that opens full size. */
export function TranscriptImage({ sessionId, image, maxHeight = 320 }: { sessionId: string; image: ImageRef; maxHeight?: number }) {
  const { url, failed } = useImage(sessionId, image);
  const [open, setOpen] = useState(false);
  // No caption to go on, so describe what kind of image it is ("PNG image, 120 KB").
  const description = `${image.mediaType.replace(/^image\//, '').toUpperCase()} image, ${kb(image.bytes)}`;
  if (failed) {
    return (
      <span className="flex h-16 w-28 items-center justify-center gap-1 rounded-md border border-border text-meta text-muted" data-tooltip="This image couldn’t be loaded">
        <ImageOff size={13} /> Unavailable
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        data-tooltip={`${image.mediaType} · ${kb(image.bytes)} · click to enlarge`}
        aria-label={`${description}: show full size`}
        className="block overflow-hidden rounded-md border border-border bg-sidebar"
        data-transcript-image
      >
        {url ? (
          <img src={url} alt={description} style={{ maxHeight }} className="block max-w-full object-contain" draggable={false} />
        ) : (
          <span className="block h-24 w-40 animate-pulse bg-border/40" />
        )}
      </button>
      {open && url && <Lightbox url={url} description={description} onClose={() => setOpen(false)} />}
    </>
  );
}
