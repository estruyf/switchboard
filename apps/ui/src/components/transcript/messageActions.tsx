import { GitFork, Pencil, Undo2 } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { Button } from '../ui/Button.tsx';

/** What you can do with a message in the transcript; provided by the session view. */
export interface MessageActions {
  /** A new session with the conversation up to and including this message. */
  fork(messageUuid: string): void;
  /** A new session up to just before this prompt, with the prompt in the message box to change. */
  edit(messageUuid: string, text: string): void;
  /** Undo the file changes Claude made since this prompt. */
  rewind(messageUuid: string): void;
  /** Whether this prompt has a message before it (the first one can't be edited by forking). */
  canEdit(messageUuid: string): boolean;
}

export const MessageActionsContext = createContext<MessageActions | null>(null);

/** Drafts handed to a session that is about to open (Edit and resend). */
export const pendingDrafts = new Map<string, string>();

/** The message's uuid: item keys are `<uuid>` or `<uuid>:<block>`. */
export const messageUuid = (key: string) => key.split(':')[0]!;

function Action({ title, onClick, children }: { title: string; onClick(): void; children: ReactNode }) {
  return (
    <Button variant="quiet" size="sm" iconOnly icon={children} aria-label={title} onClick={onClick} />
  );
}

/**
 * Small toolbar that appears when you hover a message. It's invisible rather than removed the
 * rest of the time, so Tab still reaches its buttons and it shows up while one has focus.
 */
export function MessageToolbar({ itemKey, kind, text }: { itemKey: string; kind: 'user' | 'text'; text: string }) {
  const actions = useContext(MessageActionsContext);
  if (!actions) return null;
  const uuid = messageUuid(itemKey);
  return (
    <div
      role="toolbar"
      aria-label={kind === 'user' ? 'Actions for your message' : 'Actions for Claude’s message'}
      className="pointer-events-none absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border bg-card px-0.5 opacity-0 shadow-sm group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
      data-message-actions
    >
      {kind === 'user' && (
        <>
          <Action title="Undo file changes since this message" onClick={() => actions.rewind(uuid)}>
            <Undo2 size={13} />
          </Action>
          {actions.canEdit(uuid) && (
            <Action title="Edit and resend (in a new session)" onClick={() => actions.edit(uuid, text)}>
              <Pencil size={12} />
            </Action>
          )}
        </>
      )}
      {kind === 'text' && (
        <Action title="Fork from here (a new session with the conversation up to this message)" onClick={() => actions.fork(uuid)}>
          <GitFork size={13} />
        </Action>
      )}
    </div>
  );
}
