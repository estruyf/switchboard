import { detectEol, flattenLinks, parseSections, sameHeading } from '@switchboard/protocol';

/** A file's lines with their line endings attached, so joining them gives the file back byte for byte. */
const pieces = (text: string): string[] => (text === '' ? [] : text.split(/(?<=\n)/));

/** A memory's body as it goes into instructions: links flattened, `\n` line endings, no blank lines around it. */
export function shareBody(body: string): string {
  return flattenLinks(body)
    .replace(/\r\n/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '');
}

/** The section written for a memory: `## <heading>`, a blank line, the body, one final newline; in the file's line endings. */
export function sectionText(heading: string, body: string, eol: '\n' | '\r\n'): string {
  const text = body ? `## ${heading.trim()}\n\n${body}\n` : `## ${heading.trim()}\n`;
  return eol === '\n' ? text : text.replace(/\n/g, eol);
}

/** Lines compared without their line endings or trailing spaces, so a CRLF file still finds a memory's text in it. */
const normalise = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

/** Whether the exact text (lines, not line endings) is in the file already. */
export const containsText = (file: string, body: string): boolean => body.trim() !== '' && normalise(file).includes(normalise(body).trim());

/**
 * The file with a section added: at the end, after exactly one blank line, or (`replace`) in place of the section with
 * the same heading, up to the next heading of the same or a higher level. The file's line endings are kept and it ends
 * with one newline. `sameHeading` says whether there was such a section (when there wasn't, `replace` adds).
 */
export function placeSection(before: string, heading: string, body: string, placement: 'add' | 'replace'): { after: string; sameHeading: boolean } {
  const eol = detectEol(before);
  const section = sectionText(heading, body, eol);
  const existing = parseSections(before).find((s) => sameHeading(s.title, heading));
  if (existing && placement === 'replace') {
    const lines = pieces(before);
    const head = lines.slice(0, existing.line).join('');
    const tail = lines.slice(existing.end).join('');
    // The heading that follows keeps one blank line above it.
    return { after: head + section + (tail ? eol + tail : ''), sameHeading: true };
  }
  // Only blank lines at the end go: trailing spaces on the last line of text are the file's own.
  const kept = before.replace(/(?:\r?\n[ \t]*)+$/, '').replace(/^\s+$/, '');
  return { after: kept === '' ? section : kept + eol + eol + section, sameHeading: !!existing };
}

/** `paths:` frontmatter for a new rule file. */
export const rulePathsFrontmatter = (paths: readonly string[]) => `---\npaths:\n${paths.map((p) => `  - ${JSON.stringify(p)}`).join('\n')}\n---\n`;

const NO_EOL = '\\ No newline at end of file';

/**
 * A unified diff of two versions of one file, like `git diff` writes it, with three lines of context. The change from
 * sharing is one block (an addition at the end, or a section replaced), so the common start and end are taken off and
 * the rest is one hunk; that is always a correct diff, and the smallest one for these edits.
 */
export function unifiedDiff(before: string, after: string, path: string, isNew: boolean): string {
  if (before === after) return '';
  const lines = (text: string) => {
    if (text === '') return [];
    const list = text.split(/\r?\n/);
    // A last line without a newline is marked, so adding the newline shows as a change.
    if (list.at(-1) === '') list.pop();
    else list[list.length - 1] += `\0${NO_EOL}`;
    return list;
  };
  const a = lines(before);
  const b = lines(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const context = 3;
  const lead = Math.min(context, prefix);
  const trail = Math.min(context, suffix);
  const start = prefix - lead;
  const oldCount = a.length - suffix + trail - start;
  const newCount = b.length - suffix + trail - start;
  const range = (from: number, count: number) => `${count === 0 ? from : from + 1},${count}`;
  const out = [isNew ? '--- /dev/null' : `--- a/${path}`, `+++ b/${path}`, `@@ -${range(start, oldCount)} +${range(start, newCount)} @@`];
  const emit = (mark: string, line: string) => {
    const [text, note] = line.split('\0');
    out.push(mark + text);
    if (note) out.push(note);
  };
  for (let i = start; i < prefix; i++) emit(' ', a[i]!);
  for (let i = prefix; i < a.length - suffix; i++) emit('-', a[i]!);
  for (let i = prefix; i < b.length - suffix; i++) emit('+', b[i]!);
  for (let i = a.length - suffix; i < a.length - suffix + trail; i++) emit(' ', a[i]!);
  return `${out.join('\n')}\n`;
}

/** Whether a MEMORY.md line links to `file` (`[Title](file.md)`, also `./file.md`). */
const linksTo = (line: string, file: string) => line.includes(`](${file})`) || line.includes(`](./${file})`);

/** MEMORY.md without the line that links to `file`, the rest byte for byte; null when no line does. */
export function removeIndexLine(index: string, file: string): { text: string; line: string; at: number } | null {
  const lines = pieces(index);
  const at = lines.findIndex((line) => linksTo(line, file));
  if (at === -1) return null;
  const line = lines[at]!;
  lines.splice(at, 1);
  return { text: lines.join(''), line, at };
}

/** Puts a line taken out by `removeIndexLine` back where it was (or at the end, when the file got shorter). */
export function restoreIndexLine(index: string, line: string, at: number): string {
  const lines = pieces(index);
  const position = Math.min(at, lines.length);
  const eol = detectEol(index || line);
  // A line that was the last one, without a newline, needs one when it goes back in the middle.
  const piece = position < lines.length && !line.endsWith('\n') ? line + eol : line;
  if (position === lines.length && position > 0 && !lines[position - 1]!.endsWith('\n')) lines[position - 1] += eol;
  lines.splice(position, 0, piece);
  return lines.join('');
}

/** MEMORY.md with a line added at the end, in its line endings. */
export function appendIndexLine(index: string, line: string): string {
  const eol = detectEol(index);
  const kept = index === '' || index.endsWith('\n') ? index : index + eol;
  return `${kept}${line}${eol}`;
}
