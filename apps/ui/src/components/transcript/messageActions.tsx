import { GitFork, Pencil, Undo2 } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';

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
    <button type="button" data-tooltip={title} aria-label={title} onClick={onClick} className="flex size-6 items-center justify-center rounded text-faint hover:bg-border/60 hover:text-text">
      {children}
    </button>
  );
}

/** Small toolbar that appears when you hover a message. */
export function MessageToolbar({ itemKey, kind, text }: { itemKey: string; kind: 'user' | 'text'; text: string }) {
  const actions = useContext(MessageActionsContext);
  if (!actions) return null;
  const uuid = messageUuid(itemKey);
  return (
    <div className="absolute -top-3 right-2 z-10 hidden items-center gap-0.5 rounded-md border border-border bg-card px-0.5 shadow-sm group-hover/message:flex" data-message-actions>
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
