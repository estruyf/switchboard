import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { ImageAttachment, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { tokenAtCaret } from './tokens.ts';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 7_000_000;

type PaletteItem = { value: string; label: string; detail: string };
interface Palette {
  kind: 'slash' | 'file';
  /** Where the token being completed starts (the `/` or `@`). */
  start: number;
  items: PaletteItem[];
  active: number;
}

export interface ComposerProps {
  cwd: string | null;
  commands: SlashCommand[];
  placeholder: string;
  /** Claude is busy: Enter queues, Esc interrupts. */
  running?: boolean;
  submitLabel?: string;
  disabledReason?: string | null;
  autoFocus?: boolean;
  onSubmit(text: string, attachments: ImageAttachment[]): Promise<void> | void;
  onInterrupt?(): void;
  onCycleMode?(): void;
}

function readImage(file: File): Promise<ImageAttachment | null> {
  const mediaType = IMAGE_TYPES.find((t) => t === file.type);
  if (!mediaType || file.size > MAX_IMAGE_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result).split(',')[1] ?? '';
      resolve({ type: 'image', mediaType, data, name: file.name || 'pasted image' });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function Composer(props: ComposerProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const searchSeq = useRef(0);

  // Grow with the content up to a limit, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, [props.autoFocus]);

  const updatePalette = (value: string, caret: number) => {
    const token = tokenAtCaret(value, caret);
    if (!token) return setPalette(null);
    if (token.kind === 'slash') {
      const q = token.query.toLowerCase();
      const items = props.commands
        .filter((c) => c.name.toLowerCase().includes(q))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
        .slice(0, 8)
        .map((c) => ({ value: `/${c.name}`, label: `/${c.name}`, detail: c.argumentHint ? `${c.argumentHint} · ${c.description}` : c.description }));
      return setPalette(items.length ? { kind: 'slash', start: token.start, items, active: 0 } : null);
    }
    if (!client || !props.cwd) return setPalette(null);
    const seq = ++searchSeq.current;
    void client.call('files.search', { cwd: props.cwd, query: token.query, limit: 8 }).then(({ files }) => {
      if (seq !== searchSeq.current) return;
      const items = files.map((f) => ({ value: `@${f}`, label: f.slice(f.lastIndexOf('/') + 1), detail: f }));
      setPalette(items.length ? { kind: 'file', start: token.start, items, active: 0 } : null);
    });
  };

  const choose = (item: PaletteItem) => {
    const el = ref.current;
    if (!el || !palette) return;
    const caret = el.selectionStart;
    const next = `${text.slice(0, palette.start)}${item.value} ${text.slice(caret)}`;
    setText(next);
    setPalette(null);
    const position = palette.start + item.value.length + 1;
    requestAnimationFrame(() => el.setSelectionRange(position, position));
  };

  const submit = async () => {
    if (sending || props.disabledReason) return;
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    setSending(true);
    setNotice(null);
    try {
      await props.onSubmit(value, attachments);
      setText('');
      setAttachments([]);
      setPalette(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (palette) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setPalette({ ...palette, active: (palette.active + step + palette.items.length) % palette.items.length });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        choose(palette.items[palette.active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setPalette(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape' && props.running) {
      event.preventDefault();
      props.onInterrupt?.();
    } else if (event.key === 'Tab' && event.shiftKey && props.onCycleMode) {
      event.preventDefault();
      props.onCycleMode();
    }
  };

  const addFiles = async (files: File[]) => {
    const images = (await Promise.all(files.map(readImage))).filter((a): a is ImageAttachment => a !== null);
    if (images.length < files.length) setNotice('Some files were skipped: only PNG, JPEG, GIF or WebP images up to 7 MB.');
    if (images.length) setAttachments((current) => [...current, ...images].slice(0, 20));
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (event: DragEvent) => {
    const files = [...event.dataTransfer.files];
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  const disabled = !!props.disabledReason;

  return (
    <div className="relative" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {palette && (
        <ul className="absolute right-0 bottom-full left-0 z-10 mb-2 overflow-hidden rounded-lg border border-border bg-card shadow-lg" role="listbox">
          {palette.items.map((item, i) => (
            <li key={item.value} role="option" aria-selected={i === palette.active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
                className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left ${i === palette.active ? 'bg-accent/15' : ''}`}
              >
                <span className="shrink-0 font-mono text-[12px]">{item.label}</span>
                <span className="min-w-0 truncate text-[11px] text-faint">{item.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={`rounded-xl border bg-card px-3 pt-2.5 pb-2 shadow-sm transition-colors ${disabled ? 'border-border opacity-60' : 'border-border focus-within:border-accent/60'}`}>
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="group relative size-14 overflow-hidden rounded-md border border-border">
                <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.name ?? 'attachment'} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((_, j) => j !== i))}
                  className="absolute top-0.5 right-0.5 hidden size-4 items-center justify-center rounded-full bg-black/70 text-[10px] text-white group-hover:flex"
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          data-composer
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={props.disabledReason ?? props.placeholder}
          spellCheck
          onChange={(e) => {
            setText(e.target.value);
            updatePalette(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setTimeout(() => setPalette(null), 100)}
          className="block max-h-80 w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-text outline-none placeholder:text-faint"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-faint">
            {notice ? <span className="text-error">{notice}</span> : props.running ? 'Esc to interrupt · messages you send now are queued' : '/ for commands · @ for files · ⇧Tab mode'}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {props.running && props.onInterrupt && (
              <button type="button" onClick={props.onInterrupt} className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted hover:text-text">
                Stop
              </button>
            )}
            <button
              type="button"
              data-composer-submit
              onClick={() => void submit()}
              disabled={disabled || sending || (!text.trim() && attachments.length === 0)}
              className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
            >
              {sending ? 'Sending…' : (props.submitLabel ?? (props.running ? 'Queue' : 'Send'))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
