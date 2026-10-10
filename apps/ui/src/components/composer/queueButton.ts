import type { ShortcutId } from '../../lib/shortcuts.ts';

/** What the message box's Queue button can do while Claude is working. */
export type QueueAction = 'queue' | 'send-now';

export interface QueueButtonInput {
  /** Why nothing can be sent (connecting, the folder is unknown). */
  blocked: string | null;
  /** On its way: every part waits. */
  sending: boolean;
  /** Something to send: text, images or context. */
  hasMessage: boolean;
}

export interface QueueMenuItem {
  action: QueueAction;
  label: string;
  /** The key that does the same without the menu. */
  shortcut: ShortcutId;
  disabled: boolean;
}

export interface QueueButtonState {
  label: string;
  sending: boolean;
  /** The main part and the ▾ alike: both send what is in the box. */
  disabled: boolean;
  /** Why nothing can be sent, shown over the whole button. */
  reason: string | null;
  items: QueueMenuItem[];
}

/**
 * The split Queue button while Claude is working: the main part queues the message for after the
 * current turn (↵), the ▾ offers Queue and Send now (⌘⇧↵), which stops Claude so the message runs at once.
 */
export function queueButtonState({ blocked, sending, hasMessage }: QueueButtonInput): QueueButtonState {
  const disabled = Boolean(blocked) || sending || !hasMessage;
  return {
    label: sending ? 'Sending…' : 'Queue',
    sending,
    disabled,
    reason: sending ? null : (blocked ?? (!hasMessage ? 'Type a message first' : null)),
    items: [
      { action: 'queue', label: 'Queue', shortcut: 'composer.send', disabled },
      { action: 'send-now', label: 'Send now', shortcut: 'composer.send-now', disabled },
    ],
  };
}
