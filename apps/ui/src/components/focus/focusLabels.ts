import { waitedFor, type FocusSession, type FocusState } from '../../state/focus.ts';

/** Each state in its status colour, as everywhere else: needs you pink, working yellow, unread blue. */
export const FOCUS_DOT: Record<FocusState, string> = { 'needs-you': 'bg-warn', working: 'bg-accent-ink', unread: 'bg-unread' };
export const FOCUS_TEXT: Record<FocusState, string> = { 'needs-you': 'text-warn', working: 'text-accent-ink', unread: 'text-unread' };

/** What a counted session is doing, in a few words: "Needs you · 1h 12m", "Working", "Done, not read yet". */
export function focusStateLabel(session: Pick<FocusSession, 'state' | 'since'>, now: number): string {
  if (session.state === 'needs-you') {
    const waited = waitedFor(session.since, now);
    return waited === 'now' ? 'Needs you' : `Needs you · ${waited}`;
  }
  return session.state === 'working' ? 'Working' : 'Done, not read yet';
}
