import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { EditorInfo } from '@switchboard/protocol';

interface EditorSpec extends EditorInfo {
  /** macOS app bundle name (without .app). */
  app?: string;
  /** CLI that can jump to a line, when on PATH. */
  cli?: string;
  gotoArgs?: (path: string, line: number | undefined) => string[];
}

const dashG = (path: string, line: number | undefined) => ['-g', line ? `${path}:${line}` : path];
const colon = (path: string, line: number | undefined) => [line ? `${path}:${line}` : path];
const jetbrains = (path: string, line: number | undefined) => (line ? ['--line', String(line), path] : [path]);

/** Known apps, in the order they are offered. Only installed ones are shown. */
export const EDITOR_SPECS: readonly EditorSpec[] = [
  { id: 'vscode', name: 'VS Code', kind: 'editor', app: 'Visual Studio Code', cli: 'code', gotoArgs: dashG },
  { id: 'vscode-insiders', name: 'VS Code Insiders', kind: 'editor', app: 'Visual Studio Code - Insiders', cli: 'code-insiders', gotoArgs: dashG },
  { id: 'cursor', name: 'Cursor', kind: 'editor', app: 'Cursor', cli: 'cursor', gotoArgs: dashG },
  { id: 'windsurf', name: 'Windsurf', kind: 'editor', app: 'Windsurf', cli: 'windsurf', gotoArgs: dashG },
  { id: 'zed', name: 'Zed', kind: 'editor', app: 'Zed', cli: 'zed', gotoArgs: colon },
  { id: 'sublime', name: 'Sublime Text', kind: 'editor', app: 'Sublime Text', cli: 'subl', gotoArgs: colon },
  { id: 'webstorm', name: 'WebStorm', kind: 'editor', app: 'WebStorm', cli: 'webstorm', gotoArgs: jetbrains },
  { id: 'idea', name: 'IntelliJ IDEA', kind: 'editor', app: 'IntelliJ IDEA', cli: 'idea', gotoArgs: jetbrains },
  { id: 'xcode', name: 'Xcode', kind: 'editor', app: 'Xcode', cli: 'xed', gotoArgs: (p, l) => (l ? ['-l', String(l), p] : [p]) },
  { id: 'finder', name: 'Finder', kind: 'finder' },
  { id: 'terminal', name: 'Terminal', kind: 'terminal', app: 'Terminal' },
  { id: 'iterm', name: 'iTerm', kind: 'terminal', app: 'iTerm' },
  { id: 'ghostty', name: 'Ghostty', kind: 'terminal', app: 'Ghostty' },
  { id: 'warp', name: 'Warp', kind: 'terminal', app: 'Warp' },
];

function appInstalled(app: string, home: string): boolean {
  return [
    `/Applications/${app}.app`,
    join(home, 'Applications', `${app}.app`),
    `/System/Applications/Utilities/${app}.app`,
    `/System/Applications/${app}.app`,
  ].some((p) => existsSync(p));
}

export function findOnPath(binary: string, env: Record<string, string>): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Editors, terminals and Finder installed on this Mac. */
export function detectEditors(env: Record<string, string>, home = homedir()): EditorInfo[] {
  if (process.platform !== 'darwin') {
    return EDITOR_SPECS.filter((e) => e.cli && findOnPath(e.cli, env)).map(({ id, name, kind }) => ({ id, name, kind }));
  }
  return EDITOR_SPECS.filter((e) => e.kind === 'finder' || (e.app && appInstalled(e.app, home)) || (e.cli && findOnPath(e.cli, env))).map(
    ({ id, name, kind }) => ({ id, name, kind }),
  );
}

/** The command that opens `path` (optionally at `line`) in an editor. Pure, for testing. */
export function openCommand(
  editorId: string,
  path: string,
  line: number | undefined,
  env: Record<string, string>,
  isDirectory: boolean,
): { command: string; args: string[] } {
  const spec = EDITOR_SPECS.find((e) => e.id === editorId);
  if (!spec) throw new Error(`Unknown editor: ${editorId}`);
  if (spec.kind === 'finder') return { command: 'open', args: isDirectory ? [path] : ['-R', path] };
  if (spec.kind === 'terminal') return { command: 'open', args: ['-a', spec.app!, isDirectory ? path : dirname(path)] };
  const cli = spec.cli ? findOnPath(spec.cli, env) : null;
  if (cli && spec.gotoArgs) return { command: cli, args: spec.gotoArgs(path, line) };
  // Without the CLI we can still open the file or folder, just not jump to a line.
  return { command: 'open', args: ['-a', spec.app!, path] };
}

export function openInEditor(editorId: string, path: string, line: number | undefined, env: Record<string, string>): void {
  const isDirectory = statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  const { command, args } = openCommand(editorId, path, line, env, isDirectory);
  const child = spawn(command, args, { env, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
