/**
 * Keyboard shortcuts for the permission card, as pure logic so it can be tested without a DOM.
 * The card turns the focused element into a `KeyTarget` and asks what a key press means.
 */
import { matches } from '../../lib/shortcuts.ts';


/** Where the key press happened. */
export type KeyTarget =
  /** Nothing in particular has focus. */
  | 'body'
  /** The message box. */
  | 'composer'
  /** A text field inside this card (deny feedback, your own answer). */
  | 'card-field'
  /** An answer option (radio or checkbox) inside this card. */
  | 'card-option'
  /** Any other control inside this card. */
  | 'card'
  /** A text field somewhere else (find bar, a dialog). */
  | 'field'
  /** Any other control somewhere else. */
  | 'other';

export type CardKind = 'tool' | 'question' | 'plan';

export type CardKeyAction = { type: 'allow' } | { type: 'deny' } | { type: 'pick'; index: number } | { type: 'enter' } | null;

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/** What a key press does to the first pending card, or null when the card should leave it alone. */
export function cardKeyAction(event: KeyLike, target: KeyTarget, kind: CardKind, optionCount = 0): CardKeyAction {
  if (event.isComposing) return null;
  // Typing in some other field (find bar, a dialog) is never an answer to Claude.
  if (target === 'field') return null;
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

  if (matches(event, 'permission.allow')) {
    // In the tool card's own feedback field, ⌘↵ would approve what you are explaining a "no" for.
    if (target === 'card-field' && kind === 'tool') return null;
    return { type: 'allow' };
  }
  if (matches(event, 'permission.deny')) {
    // Escape in your own answer to a question must not throw that answer away by skipping.
    if (target === 'card-field' && kind === 'question') return null;
    return { type: 'deny' };
  }

  if (kind !== 'question' || !plain) return null;
  if (matches(event, 'permission.pick')) {
    // Digits typed into a text field (the composer or your own answer) are text.
    if (target === 'composer' || target === 'card-field') return null;
    const index = Number(event.key) - 1;
    return index < optionCount ? { type: 'pick', index } : null;
  }
  // Enter moves on from an option or from nowhere; in the composer it sends a message, on a button it presses it.
  if (event.key === 'Enter' && (target === 'card-option' || target === 'body')) return { type: 'enter' };
  return null;
}

/** "Waiting 2m" since the request arrived, or null for the first minute (it just appeared). */
export function waitingLabel(createdAt: number, now: number): string | null {
  const minutes = Math.floor(Math.max(0, now - createdAt) / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return `Waiting ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Waiting ${hours}h`;
  return `Waiting ${Math.floor(hours / 24)}d`;
}

/** Same check the message box uses before Escape stops Claude: an open overlay gets the key instead. */
export const OVERLAY_SELECTOR = '[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [data-context-breakdown]';
