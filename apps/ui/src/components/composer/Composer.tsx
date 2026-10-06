import { AtSign, ImageOff, ImagePlus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { ImageAttachment, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { dropMessage, dropVerdict, MAX_ATTACHMENTS, mergeAttachments, planDrop, readImage } from './images.ts';
import { insertMentions, mentionFor } from './mentions.ts';
import { tokenAtCaret } from './tokens.ts';
import { useDropTarget } from './useDropTarget.ts';

type PaletteItem = { value: string; label: string; detail: string };
interface Palette {
  kind: 'slash' | 'file';
  /** Where the token being completed starts (the `/` or `@`). */
  start: number;
  items: PaletteItem[];
  active: number;
}

export interface ComposerProps {
  /** Text to start with (Edit and resend). */
  initialText?: string;
  cwd: string | null;
  commands: SlashCommand[];
  placeholder: string;
  /** Claude is busy: Enter queues, Esc interrupts. */
  running?: boolean;
  submitLabel?: string;
  disabledReason?: string | null;
  autoFocus?: boolean;
  /** Changing it focuses the prompt again (New session asked for while already open). */
  focusRequest?: number;
  /** Controls shown in the card's bottom bar in place of the hint line (the new session view). */
  toolbar?: ReactNode;
  /** A shortcut shown on the submit button, like `⌘↵`. */
  submitHint?: string;
  /** A taller prompt that is the main thing on screen. */
  large?: boolean;
  /** Say next to the attach button that images can be pasted or dropped (an empty session). */
  dropHint?: boolean;
  onSubmit(text: string, attachments: ImageAttachment[]): Promise<void> | void;
  onInterrupt?(): void;
  onCycleMode?(): void;
}

/** Focus is in another text field, or in a menu or dialog: a late focus request must not take it away. */
function isTypingElsewhere(prompt: HTMLElement): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || active === prompt) return false;
  return active.matches('input, textarea, select, [contenteditable]') || !!active.closest('[role=menu], [role=dialog], [role=alertdialog], [role=listbox]');
}

export function Composer(props: ComposerProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [text, setText] = useState(props.initialText ?? '');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchSeq = useRef(0);

  // Grow with the content up to a limit, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  // Mounting with autoFocus, or a new focusRequest, focuses the prompt. While the prompt is disabled
  // (engine connecting, no folder yet) the request waits, and is dropped if by then the user is typing
  // somewhere else, like the folder filter.
  const pendingFocus = useRef(!!props.autoFocus);
  const lastRequest = useRef(props.focusRequest);
  useEffect(() => {
    const el = ref.current;
    const asked = props.focusRequest !== lastRequest.current;
    lastRequest.current = props.focusRequest;
    if (asked) pendingFocus.current = true;
    if (!pendingFocus.current || !el || props.disabledReason) return;
    pendingFocus.current = false;
    if (!asked && isTypingElsewhere(el)) return;
    el.focus();
  }, [props.focusRequest, props.disabledReason]);

  const updatePalette = (value: string, caret: number) => {
    const token = tokenAtCaret(value, caret);
    if (!token) return setPalette(null);
    if (token.kind === 'slash') {
      const q = token.query.toLowerCase();
      const items = props.commands
        .filter((c) => c.name.toLowerCase().includes(q) || (q.length > 2 && c.description.toLowerCase().includes(q)))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
        .slice(0, 60)
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
        const active = (palette.active + step + palette.items.length) % palette.items.length;
        setPalette({ ...palette, active });
        requestAnimationFrame(() => listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' }));
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
      // With a dialog, menu or popover open, Escape closes that; it must never also stop Claude.
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [data-context-breakdown]')) return;
      event.preventDefault();
      props.onInterrupt?.();
    } else if (event.key === 'Tab' && event.shiftKey && props.onCycleMode) {
      event.preventDefault();
      props.onCycleMode();
    }
  };

  const addFiles = async (files: File[]) => {
    const images = (await Promise.all(files.map(readImage))).filter((a): a is ImageAttachment => a !== null);
    setAttachments((current) => {
      const { next, notice } = mergeAttachments(current, images, files.length);
      setNotice(notice);
      return next;
    });
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  // A dropped file's place on disk, for an @ mention; empty outside the app or for files not on disk.
  const canMention = typeof window.switchboard?.getPathForFile === 'function';
  const pathOf = (file: File) => {
    try {
      return window.switchboard?.getPathForFile(file) ?? '';
    } catch {
      return '';
    }
  };

  /** A drop: images are attached while there is room; other files, folders and the images past the limit become @ mentions. */
  const dropFiles = async (files: File[], directories: boolean[]) => {
    const dropped = files.map((file, i) => ({ type: file.type, size: file.size, directory: directories[i] ?? false, path: pathOf(file) }));
    const plan = planDrop(dropped, attachments.length);
    const read = await Promise.all(plan.attach.map((i) => readImage(files[i]!)));
    // An image that can't be read is mentioned instead, when it has a path.
    const unread = plan.attach.filter((_, k) => !read[k]).map((i) => dropped[i]!);
    const mentioned = [...plan.mention, ...unread.filter((f) => f.path)];
    const images = read.filter((a): a is ImageAttachment => a !== null);
    if (images.length) setAttachments((current) => [...current, ...images].slice(0, MAX_ATTACHMENTS));
    if (mentioned.length) {
      const el = ref.current;
      const value = el?.value ?? text;
      const caret = el && document.activeElement === el ? el.selectionEnd : value.length;
      const next = insertMentions(value, caret, mentioned.map((f) => mentionFor(f.path, props.cwd, f.directory)));
      setText(next.text);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(next.caret, next.caret);
      });
    }
    const skipped = plan.skipped + unread.length - unread.filter((f) => f.path).length;
    setNotice(skipped ? 'Some files were skipped: only images, and files and folders on disk, can be added.' : null);
  };

  // Files dragged anywhere over the session view: an overlay on the message box shows what a drop would do.
  const drop = useDropTarget(rootRef, (drag) => dropVerdict(drag, { attached: attachments.length, disabledReason: props.disabledReason, canMention }), (files, directories) => void dropFiles(files, directories));
  const dropOk = drop.verdict?.kind === 'ok';
  const mentionOnly = drop.verdict?.kind === 'ok' && drop.verdict.attach === 0 && drop.verdict.mention > 0;

  const disabled = !!props.disabledReason;

  return (
    <div ref={rootRef} className="relative">
      {drop.verdict && (
        <div
          data-drop-overlay
          data-drop-state={drop.verdict.kind}
          data-drop-over={drop.over}
          data-drop-mention={drop.verdict.kind === 'ok' ? drop.verdict.mention : undefined}
          aria-live="polite"
          className={`pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-xl border-2 bg-card/95 ${dropOk ? `border-accent-ink text-accent-ink ${drop.over ? 'border-solid' : 'border-dashed'}` : 'border-dashed border-faint text-muted'}`}
        >
          <div className={`flex size-full items-center justify-center gap-2 px-4 text-center text-[12.5px] font-medium ${dropOk ? (drop.over ? 'bg-accent/20' : 'bg-accent/10') : ''}`}>
            {mentionOnly ? <AtSign size={16} className="shrink-0" /> : dropOk ? <ImagePlus size={16} className="shrink-0" /> : <ImageOff size={16} className="shrink-0" />}
            <span className="min-w-0">{dropMessage(drop.verdict)}</span>
          </div>
        </div>
      )}
      {palette && (
        <ul ref={listRef} className="absolute right-0 bottom-full left-0 z-10 mb-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-card shadow-lg" role="listbox" data-palette>
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

      <div className={`rounded-xl border bg-card px-3 pt-2.5 pb-2 shadow-sm transition-colors ${disabled ? 'border-border opacity-60' : 'border-border focus-within:border-accent-ink/60'}`}>
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
          className={`block max-h-80 w-full resize-none bg-transparent leading-relaxed text-text outline-none placeholder:text-faint ${props.large ? 'min-h-24 px-1 pt-1 text-[14.5px]' : 'text-[13.5px]'}`}
        />
        {props.toolbar && notice && <p className="mt-1 truncate text-[11px] text-error">{notice}</p>}
        <div className={`flex items-center justify-between gap-2 ${props.toolbar ? '-mx-3 mt-2 flex-wrap border-t border-border px-2 pt-2' : 'mt-1.5'}`}>
          {props.toolbar ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1">{props.toolbar}</div>
          ) : (
            <span className="min-w-0 truncate text-[11px] text-faint">
              {notice ? <span className="text-error">{notice}</span> : props.running ? 'Esc to interrupt · messages you send now are queued' : '/ for commands · @ for files · ⇧Tab mode'}
            </span>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {props.dropHint && !text && attachments.length === 0 && !disabled && <span className="text-[11px] text-faint @max-[860px]:hidden">Paste or drop images and files</span>}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              data-attach-input
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              data-tooltip="Attach images (or paste / drop them). Dropped files and folders become @ mentions." aria-label="Attach images"
              className="rounded-md p-1 text-muted hover:bg-border/50 hover:text-text disabled:opacity-40"
              data-attach
            >
              <ImagePlus size={15} />
            </button>
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
              className={`flex items-center gap-2 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent disabled:opacity-40 ${props.submitHint ? 'h-7' : 'py-1'}`}
            >
              {sending ? 'Sending…' : (props.submitLabel ?? (props.running ? 'Queue' : 'Send'))}
              {props.submitHint && !sending && <kbd className="font-sans text-[11px] font-normal opacity-60">{props.submitHint}</kbd>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
