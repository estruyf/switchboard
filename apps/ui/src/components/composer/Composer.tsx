import { ImagePlus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ImageAttachment, SlashCommand } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { attachmentsAfterSend, textAfterSend } from './afterSend.ts';
import { AttachmentThumbs, DropOverlay } from './Attachments.tsx';
import { DraftStore } from './drafts.ts';
import { onFirstLine, onLastLine, textareaRows } from './caretLine.ts';
import { PromptHistory, recallAnnouncement, routeArrow, type Recall } from './promptHistory.ts';
import { tokenAtCaret } from './tokens.ts';
import { useAttachments } from './useAttachments.ts';
import { ariaKeysFor, formatKeys, keysFor, matches, type ShortcutId } from '../../lib/shortcuts.ts';

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
  /** Keeps what is typed and attached under this key (a session's id), so it's still there after you open another session and come back. */
  draftKey?: string;
  /** Earlier messages, newest first, that ↑ on the first line brings back. */
  history?: readonly string[];
  /** Replaces the text whenever `seq` changes (a prompt from a `switchboard://` link, or clearing it), and the images when it has `attachments` (a prompt moved over from the palette). */
  preset?: { text: string; attachments?: ImageAttachment[]; seq: number };
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
  /** Changing it sends what is in the box, as Enter would (New session's Start anyway). */
  submitRequest?: number;
  /** Compact controls in the card's bottom-left corner in place of the hint line (the model, mode and effort chips). */
  controls?: ReactNode;
  /** Buttons in the card's bottom-right corner, before attach (a session's Tools). */
  actions?: ReactNode;
  /** Right before Stop and Send: the ring that stands in for the session footer while the terminal is open below. */
  meter?: ReactNode;
  /** A shortcut shown on the submit button, like `⌘↵`. */
  submitHint?: string;
  /** A taller prompt that is the main thing on screen. */
  large?: boolean;
  /** The card's border colour in place of the theme's (New session: the picked project's). */
  frameColor?: string | null;
  /** Say next to the attach button that images can be pasted or dropped (an empty session). */
  dropHint?: boolean;
  /** Called with the prompt's text whenever it changes (typing, completions, presets, sending). */
  onTextChange?(text: string): void;
  /**
   * A second way to send what is in the box, left of the main button (New session's Add to queue), with its own
   * shortcut. Like `onSubmit`, returning `false` keeps the prompt; otherwise the box empties.
   */
  secondary?: { label: string; icon: ReactNode; shortcut: ShortcutId; onSubmit(text: string): Promise<void | false>; data?: Record<`data-${string}`, string | boolean> };
  /** Returning `false` means nothing was sent (the focus limit asked and you cancelled): the prompt stays as it is. */
  onSubmit(text: string, attachments: ImageAttachment[], requested?: boolean): Promise<void | false> | void | false;
  onInterrupt?(): void;
  onCycleMode?(): void;
}

/** Focus is in another text field, or in a menu or dialog: a late focus request must not take it away. */
function isTypingElsewhere(prompt: HTMLElement): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || active === prompt) return false;
  return active.matches('input, textarea, select, [contenteditable]') || !!active.closest('[role=menu], [role=dialog], [role=alertdialog], [role=listbox]');
}

const drafts = new DraftStore<ImageAttachment>();

export function Composer(props: ComposerProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [saved] = useState(() => (props.draftKey === undefined ? undefined : drafts.get(props.draftKey)));
  const [text, setText] = useState(props.initialText ?? saved?.text ?? '');
  const [palette, setPalette] = useState<Palette | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { attachments, setAttachments, addFiles, onPaste, drop } = useAttachments({ initial: saved?.attachments, rootRef, textareaRef: ref, cwd: props.cwd, disabledReason: props.disabledReason, setText, onNotice: setNotice });
  /** Bumped whenever the palette's input moves on: a file search that answers after that is dropped. */
  const searchSeq = useRef(0);
  const ids = useId();
  const history = useRef<PromptHistory | null>(null);
  history.current ??= new PromptHistory(props.history);
  /** Read out after ↑ or ↓ brings back a message (screen readers only). */
  const [announcement, setAnnouncement] = useState('');
  const closePalette = () => {
    ++searchSeq.current;
    setPalette(null);
  };

  const presetSeq = props.preset?.seq;
  useEffect(() => {
    if (presetSeq === undefined) return;
    const value = props.preset!.text;
    setText(value);
    if (props.preset!.attachments) setAttachments(props.preset!.attachments);
    history.current!.reset();
    closePalette();
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el && !el.disabled) {
        el.focus();
        el.setSelectionRange(value.length, value.length);
      }
    });
  }, [presetSeq]);

  useEffect(() => history.current!.setEntries(props.history ?? []), [props.history]);

  const onTextChange = props.onTextChange;
  useEffect(() => onTextChange?.(text), [text, onTextChange]);

  const draftKey = props.draftKey;
  useEffect(() => {
    if (draftKey !== undefined) drafts.set(draftKey, { text, attachments });
  }, [draftKey, text, attachments]);

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
    // Any edit makes an earlier file search stale, whatever this one turns out to be.
    const seq = ++searchSeq.current;
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
    client.call('files.search', { cwd: props.cwd, query: token.query, limit: 8 }).then(
      ({ files }) => {
        if (seq !== searchSeq.current) return;
        const items = files.map((f) => ({ value: `@${f}`, label: f.slice(f.lastIndexOf('/') + 1), detail: f }));
        setPalette(items.length ? { kind: 'file', start: token.start, items, active: 0 } : null);
      },
      () => {},
    );
  };

  const choose = (item: PaletteItem) => {
    const el = ref.current;
    if (!el || !palette) return;
    const caret = el.selectionStart;
    const next = `${text.slice(0, palette.start)}${item.value} ${text.slice(caret)}`;
    setText(next);
    closePalette();
    const position = palette.start + item.value.length + 1;
    requestAnimationFrame(() => el.setSelectionRange(position, position));
  };

  /** `requested`: sent through `submitRequest` rather than Enter or the button. `send`: the secondary action instead of `onSubmit`. */
  const submit = async (requested = false, send: (value: string, attachments: ImageAttachment[]) => Promise<void | false> | void | false = (value, sent) => props.onSubmit(value, sent, requested)) => {
    if (sending || props.disabledReason) return;
    const sentText = text;
    const value = text.trim();
    const sentAttachments = attachments;
    if (!value && sentAttachments.length === 0) return;
    setSending(true);
    setNotice(null);
    closePalette();
    try {
      if ((await send(value, sentAttachments)) === false) return;
      // The box stays editable while sending: keep whatever was typed or attached in the meantime.
      setText((current) => textAfterSend(current, sentText));
      history.current!.reset();
      setAttachments((current) => attachmentsAfterSend(current, sentAttachments));
      closePalette();
    } catch (error) {
      // The text stays in the box, so trying again is one Enter away.
      setNotice(`Not sent: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  // Start anyway (New session) sends what is in the box from outside it.
  const lastSubmitRequest = useRef(props.submitRequest);
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (props.submitRequest === lastSubmitRequest.current) return;
    lastSubmitRequest.current = props.submitRequest;
    void submitRef.current(true);
  }, [props.submitRequest]);

  /** Puts a recalled message (or the draft) in the box, caret where it says, and reads out where you are. */
  const applyRecall = (recall: Recall) => {
    const el = ref.current;
    setText(recall.text);
    // A trailing no-break space makes a repeated message a change, so it's read out again.
    const said = recallAnnouncement(recall);
    setAnnouncement((current) => (current.replace(/\u00a0$/, '') === said ? `${said}\u00a0` : said));
    requestAnimationFrame(() => el?.setSelectionRange(recall.caret, recall.caret));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const el = event.currentTarget;
    const route = routeArrow(
      { key: event.key, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing },
      palette && { active: palette.active, count: palette.items.length },
      (direction) => (direction === 'older' ? onFirstLine : onLastLine)(el.value, el.selectionStart, el.selectionEnd, textareaRows(el)),
    );
    if (route?.kind === 'palette') {
      event.preventDefault();
      setPalette({ ...palette!, active: route.active });
      requestAnimationFrame(() => listRef.current?.children[route.active]?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    if (route?.kind === 'history') {
      const recall = history.current!.recall(route.direction, el.value, el.selectionStart);
      // At the oldest message ↑ does nothing; with no history at all it moves the caret as usual.
      if (recall || history.current!.browsing) event.preventDefault();
      if (recall) applyRecall(recall);
      return;
    }
    if (palette) {
      // ⌃⇥ moves to another session; it never picks a command.
      if (event.key === 'Enter' || (event.key === 'Tab' && !event.ctrlKey)) {
        event.preventDefault();
        choose(palette.items[palette.active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
        return;
      }
    }
    if (event.key === 'Escape' && history.current!.browsing) {
      // Browsing earlier messages, Esc puts your draft back; only after that does it stop Claude.
      const recall = history.current!.escape(el.value);
      if (recall) {
        event.preventDefault();
        applyRecall(recall);
        return;
      }
    }
    if (props.secondary && matches(event.nativeEvent, props.secondary.shortcut)) {
      event.preventDefault();
      void submitSecondary();
    } else if (matches(event.nativeEvent, 'composer.send')) {
      event.preventDefault();
      void submit();
    } else if (matches(event.nativeEvent, 'claude.stop') && props.running) {
      // With a dialog, menu or popover open, Escape closes that; it must never also stop Claude.
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [data-context-breakdown]')) return;
      event.preventDefault();
      props.onInterrupt?.();
    } else if (matches(event.nativeEvent, 'mode.cycle') && props.onCycleMode) {
      event.preventDefault();
      props.onCycleMode();
    }
  };

  const disabled = !!props.disabledReason;
  const submitSecondary = () => (props.secondary ? submit(false, (value) => props.secondary!.onSubmit(value)) : Promise.resolve());

  return (
    <div ref={rootRef} className="relative">
      <DropOverlay drop={drop} />
      {palette && (
        // Focus stays in the message box (aria-activedescendant points at the highlighted option), so the
        // options are plain list items rather than buttons that Tab could land on.
        <ul
          ref={listRef}
          id={`${ids}-palette`}
          className="absolute right-0 bottom-full left-0 z-10 mb-2 max-h-72 overflow-y-auto rounded-lg border overlay"
          role="listbox"
          aria-label={palette.kind === 'slash' ? 'Commands' : 'Files'}
          data-palette
        >
          {palette.items.map((item, i) => (
            <li
              key={item.value}
              id={`${ids}-option-${i}`}
              role="option"
              aria-selected={i === palette.active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              className={`flex w-full cursor-default items-baseline gap-3 px-3 py-1.5 text-left hover:bg-accent/10 ${i === palette.active ? 'bg-accent/15' : ''}`}
            >
              <span className="shrink-0 font-mono text-ui">{item.label}</span>
              <span className="min-w-0 truncate text-meta text-muted">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Disabled dims the text, not the card: the chips' menus open from inside it and must stay readable. */}
      <div
        className={`rounded-xl border border-border bg-card px-3 pt-2.5 pb-2 shadow-sm transition-colors ${disabled ? '' : 'focus-within:border-accent-ink/60'}`}
        style={props.frameColor ? { borderColor: props.frameColor } : undefined}
      >
        <AttachmentThumbs
          attachments={attachments}
          className="mb-2"
          onRemove={(i) => {
            setAttachments((current) => current.filter((_, j) => j !== i));
            ref.current?.focus();
          }}
        />
        <textarea
          data-composer
          data-history={props.history?.length ?? 0}
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={props.disabledReason ?? props.placeholder}
          aria-label="Message to Claude"
          aria-describedby={`${ids}-hint`}
          aria-keyshortcuts={props.running && props.onInterrupt ? ariaKeysFor('claude.stop') : undefined}
          // While the / or @ list is open, ↑ ↓ move through it without leaving the box.
          aria-autocomplete="list"
          aria-controls={palette ? `${ids}-palette` : undefined}
          aria-activedescendant={palette ? `${ids}-option-${palette.active}` : undefined}
          spellCheck
          onChange={(e) => {
            setText(e.target.value);
            updatePalette(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            // A search still on its way must not reopen the list after focus left; the open list waits a moment so a click on it lands.
            ++searchSeq.current;
            setTimeout(() => setPalette(null), 100);
          }}
          className={`block max-h-80 w-full resize-none bg-transparent leading-relaxed text-text outline-none placeholder:text-faint disabled:opacity-60 ${props.large ? 'min-h-24 px-1 pt-1 text-title font-normal' : 'text-body'}`}
        />
        {props.controls && notice && (
          <p role="alert" className="mt-1 truncate text-meta text-error" data-tooltip={notice}>
            {notice}
          </p>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="sr-only" role="status" aria-live="polite" data-history-announcer>
            {announcement}
          </span>
          {props.controls ? (
            <div className="-ml-1.5 flex min-w-0 flex-1 items-center">
              {props.controls}
              {/* The keys still get read out with the message box; the chips take the hint's place on screen. */}
              <span id={`${ids}-hint`} className="sr-only">
                {props.running ? 'Esc stops Claude.' : `/ for commands, @ for files${props.onCycleMode ? ', ⇧Tab to change mode' : ''}.`}
              </span>
            </div>
          ) : (
            <span id={`${ids}-hint`} className="min-w-0 truncate text-meta text-muted">
              {notice ? (
                <span role="alert" className="text-error" data-tooltip={notice}>
                  {notice}
                </span>
              ) : props.running ? (
                'Esc to stop Claude · messages you send now are queued'
              ) : (
                `/ for commands · @ for files${props.onCycleMode ? ' · ⇧Tab to change mode' : ''}`
              )}
            </span>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {props.dropHint && !text && attachments.length === 0 && !disabled && <span className="text-meta text-muted @max-[860px]:hidden">Paste or drop images and files</span>}
            {props.actions}
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
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon={<ImagePlus size={15} />}
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              data-tooltip="Attach images (or paste / drop them). Dropped files and folders become @ mentions."
              aria-label="Attach images"
              data-attach
            />
            {props.meter}
            {props.running && props.onInterrupt && (
              <Button size="lg" icon={<span className="size-2 rounded-[2px] bg-current" aria-hidden />} shortcut="claude.stop" kbdHideNarrow onClick={props.onInterrupt} data-tooltip={`Stop Claude (${formatKeys(keysFor('claude.stop'))})`} data-composer-stop>
                Stop
              </Button>
            )}
            {props.secondary && (
              <Button
                size="lg"
                icon={props.secondary.icon}
                shortcut={props.secondary.shortcut}
                kbdHideNarrow
                onClick={() => void submitSecondary()}
                disabled={disabled || sending || !text.trim()}
                className="disabled:pointer-events-none"
                {...props.secondary.data}
              >
                {props.secondary.label}
              </Button>
            )}
            {/* A disabled button gets no hover, so the reason it's unavailable sits on this wrapper. */}
            <span className="flex" data-tooltip={!sending ? (props.disabledReason ?? (!text.trim() && attachments.length === 0 ? 'Type a message first' : undefined)) : undefined}>
              <Button
                variant="primary"
                size="lg"
                kbd={props.submitHint && !sending ? props.submitHint : undefined}
                data-composer-submit
                onClick={() => void submit()}
                disabled={disabled || sending || (!text.trim() && attachments.length === 0)}
                className="disabled:pointer-events-none"
              >
                {sending ? 'Sending…' : (props.submitLabel ?? (props.running ? 'Queue' : 'Send'))}
              </Button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
