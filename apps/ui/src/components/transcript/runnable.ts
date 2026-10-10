/** Fenced-block languages that are shell commands, so the block gets a Run button. */
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'shellsession', 'terminal']);

/** Whether a code block in this language can be run in the session's terminal. */
export function isRunnable(language: string | undefined): boolean {
  return language !== undefined && SHELL_LANGUAGES.has(language.toLowerCase());
}

/**
 * What to type into the shell for a block: in a transcript-style block (`console`, or lines that
 * start with `$ `) only the prompt lines, without the `$`, since the rest is output. Blank lines
 * and trailing whitespace are dropped. Empty when there is nothing to run.
 */
export function commandToRun(code: string): string {
  const lines = code.split('\n').map((line) => line.trimEnd());
  const prompted = lines.filter((line) => /^\s*\$ /.test(line));
  const commands = prompted.length > 0 ? prompted.map((line) => line.replace(/^\s*\$ /, '')) : lines;
  return commands.filter((line) => line.trim() !== '').join('\n');
}
