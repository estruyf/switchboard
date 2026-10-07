/**
 * What stays in the message box once a message has gone out. The box stays editable while it sends,
 * so anything typed in the meantime is kept: the sent text goes, text added after it stays, and a
 * prompt that was edited (not just added to) is left alone.
 */
export function textAfterSend(current: string, sent: string): string {
  if (current.trim() === sent.trim()) return '';
  if (sent && current.startsWith(sent)) return current.slice(sent.length).replace(/^\s+/, '');
  return current;
}

/** The attachments still waiting after a send: only the ones that went out are removed. */
export function attachmentsAfterSend<T>(current: T[], sent: readonly T[]): T[] {
  return current.filter((item) => !sent.includes(item));
}
