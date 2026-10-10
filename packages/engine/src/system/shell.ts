import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

/** The shell terminal tabs and shell actions run in, and how to talk to it. */
export interface UserShell {
  file: string;
  kind: 'posix' | 'powershell';
  /** Arguments for an interactive shell in a terminal tab. */
  interactive: string[];
  /** Arguments that run one command line, with the user's shell config read so aliases and nvm work. */
  run(command: string): string[];
  /** Quotes a value so the shell passes it on as one argument and never runs it as code. */
  quote(value: string): string;
  /** Commands that run one after the other, each only when the one before it succeeded. */
  sequence(commands: string[]): string;
}

const andAnd = (commands: string[]) => commands.join(' && ');

/** Windows PowerShell 5.1 has no `&&`: each next command runs when `$?` says the last one succeeded. */
const powershell5Sequence = (commands: string[]) => commands.reduce((line, command) => `${line}; if ($?) { ${command} }`);

/** Quotes a value for POSIX shells: `it's` → `'it'\''s'`. */
export const posixQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Quotes a value for PowerShell: `it's` → `'it''s'`. Inside single quotes nothing expands, and PowerShell also
 * ends the string at the typographic single quotes (‘ ’ ‚ ‛), so those are doubled too.
 */
export const powershellQuote = (value: string) => `'${value.replace(/['‘’‚‛]/g, '$&$&')}'`;

/**
 * The user's shell. On macOS and Linux it is `$SHELL` as a login shell. On Windows there is no `$SHELL`:
 * PowerShell 7 (`pwsh.exe`) when it is on PATH, else the Windows PowerShell every Windows has. A command runs
 * as `-EncodedCommand`, so no quoting between Node, the Windows command line and PowerShell can change it.
 */
export function userShell(env: Record<string, string>, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync): UserShell {
  if (platform !== 'win32') {
    return { file: env.SHELL || '/bin/zsh', kind: 'posix', interactive: ['-l'], run: (command) => ['-ilc', command], quote: posixQuote, sequence: andAnd };
  }
  const pwsh = (env.PATH ?? '')
    .split(win32.delimiter)
    .filter(Boolean)
    .map((dir) => win32.join(dir, 'pwsh.exe'))
    .find(exists);
  const file = pwsh ?? win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return {
    file,
    kind: 'powershell',
    interactive: ['-NoLogo'],
    run: (command) => ['-NoLogo', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    quote: powershellQuote,
    // PowerShell 7 has `&&`; the Windows PowerShell every Windows has (5.1) doesn't.
    sequence: pwsh ? andAnd : powershell5Sequence,
  };
}
