/** What was typed or attached in a message box and not sent yet. */
export interface Draft<A> {
  text: string;
  attachments: A[];
}

/**
 * Unsent messages by session, kept while the app runs. A session's view is remounted when you open
 * another one, so the message box reads its draft back from here when you return.
 */
export class DraftStore<A> {
  private drafts = new Map<string, Draft<A>>();

  get(key: string): Draft<A> | undefined {
    return this.drafts.get(key);
  }

  /** An empty box forgets the draft, so the map only holds sessions with something waiting. */
  set(key: string, draft: Draft<A>): void {
    if (draft.text.trim() === '' && draft.attachments.length === 0) this.drafts.delete(key);
    else this.drafts.set(key, draft);
  }
}
