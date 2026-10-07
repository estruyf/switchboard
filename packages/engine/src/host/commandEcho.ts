/**
 * The text a sent message shows as in the live transcript. A message that starts with a slash command Claude Code
 * knows gets the markup Claude Code itself stores for it, so it looks the same before and after the transcript is
 * read back. Anything else, including a prompt that only starts with a path such as `/tmp`, stays as typed.
 */
export function commandEcho(text: string, commands: Iterable<string>): string {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return text;
  const name = match[1]!;
  if (!new Set(commands).has(name)) return text;
  return `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${match[2]?.trim() ?? ''}</command-args>`;
}
