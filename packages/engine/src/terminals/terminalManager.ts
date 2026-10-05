import { randomUUID } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import type { LogLevel, TerminalInfo, TerminalKind } from '@switchboard/protocol';

/** The slice of node-pty's IPty the manager uses (injectable for tests). */
export interface Pty {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => Pty;

export interface TerminalManagerOptions {
  /** Defaults to node-pty. */
  spawn?: () => Promise<SpawnPty>;
  /** The login-shell environment (PATH, nvm, …). */
  env: () => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  onData: (id: string, data: string) => void;
  onChange: (terminals: TerminalInfo[]) => void;
  log: (level: LogLevel, message: string) => void;
}

/** Output kept per terminal for replay when a window (re)attaches. */
export const REPLAY_LIMIT = 400_000;
const FLUSH_MS = 8;

/** Environment variables of an enclosing Claude Code that must not leak into the user's terminals. */
const STRIP_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS'];

interface Terminal {
  info: TerminalInfo;
  pty: Pty;
  replay: string[];
  replayLength: number;
  pending: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * node-pty's prebuilt `spawn-helper` can lose its executable bit when npm
 * extracts it, and then every spawn fails with "posix_spawnp failed".
 */
export function ensureSpawnHelperExecutable(): void {
  if (process.platform === 'win32') return;
  let root: string;
  try {
    root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  } catch {
    return;
  }
  for (const dir of [`prebuilds/${process.platform}-${process.arch}`, 'build/Release']) {
    const helper = join(root, dir, 'spawn-helper').replace('app.asar', 'app.asar.unpacked');
    if (!existsSync(helper)) continue;
    try {
      accessSync(helper, constants.X_OK);
    } catch {
      try {
        chmodSync(helper, 0o755);
      } catch {
        // Read-only install (e.g. a signed app bundle): nothing we can do here.
      }
    }
  }
}

async function loadNodePty(): Promise<SpawnPty> {
  ensureSpawnHelperExecutable();
  const pty = await import('node-pty');
  return (file, args, options) => pty.spawn(file, args, options);
}

/** Terminals for session panels: login shells and the Claude Code TUI. They outlive window switches. */
export class TerminalManager {
  private readonly terminals = new Map<string, Terminal>();
  private spawnPty: Promise<SpawnPty> | undefined;

  constructor(private readonly options: TerminalManagerOptions) {}

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((t) => t.info);
  }

  async open(params: { sessionId: string | null; cwd: string; kind: TerminalKind; cols: number; rows: number; fork: boolean }): Promise<TerminalInfo> {
    if (!existsSync(params.cwd)) throw new Error(`Folder not found: ${params.cwd}`);
    const baseEnv = await this.options.env();
    const env: Record<string, string> = { ...baseEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Switchboard' };
    for (const key of STRIP_ENV) delete env[key];

    let file: string;
    let args: string[];
    let title: string;
    if (params.kind === 'claude') {
      const claude = await this.options.claudePath();
      if (!claude) throw new Error('Claude Code was not found on your PATH');
      file = claude;
      args = params.sessionId ? ['--resume', params.sessionId, ...(params.fork ? ['--fork-session'] : [])] : [];
      title = params.fork ? 'Claude (fork)' : 'Claude';
    } else {
      file = env.SHELL || '/bin/zsh';
      args = ['-l'];
      title = basename(file);
    }

    this.spawnPty ??= this.options.spawn ? this.options.spawn() : loadNodePty();
    const pty = (await this.spawnPty)(file, args, { name: 'xterm-256color', cols: params.cols, rows: params.rows, cwd: params.cwd, env });
    const terminal: Terminal = {
      info: {
        id: randomUUID(),
        sessionId: params.sessionId,
        kind: params.kind,
        title,
        cwd: params.cwd,
        pid: pty.pid,
        cols: params.cols,
        rows: params.rows,
        exitCode: null,
        startedAt: Date.now(),
      },
      pty,
      replay: [],
      replayLength: 0,
      pending: '',
      timer: undefined,
    };
    this.terminals.set(terminal.info.id, terminal);

    pty.onData((data) => this.buffer(terminal, data));
    pty.onExit(({ exitCode }) => {
      this.flush(terminal);
      terminal.info = { ...terminal.info, exitCode };
      this.changed();
    });
    this.options.log('info', `Opened ${params.kind} terminal in ${params.cwd} (pid ${pty.pid})`);
    this.changed();
    return terminal.info;
  }

  /** Recent output, for a window attaching to a running terminal. */
  replay(id: string): { info: TerminalInfo; replay: string } {
    const terminal = this.require(id);
    this.flush(terminal);
    return { info: terminal.info, replay: terminal.replay.join('') };
  }

  write(id: string, data: string): void {
    const terminal = this.require(id);
    if (terminal.info.exitCode === null) terminal.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.require(id);
    if (terminal.info.exitCode !== null || (terminal.info.cols === cols && terminal.info.rows === rows)) return;
    terminal.pty.resize(cols, rows);
    terminal.info = { ...terminal.info, cols, rows };
  }

  close(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    if (terminal.timer) clearTimeout(terminal.timer);
    if (terminal.info.exitCode === null) {
      try {
        terminal.pty.kill();
      } catch {
        // Already gone.
      }
    }
    this.terminals.delete(id);
    this.changed();
  }

  closeAll(): void {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }

  private require(id: string): Terminal {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error('This terminal is gone');
    return terminal;
  }

  /** Batches output: a busy process writes thousands of tiny chunks; windows get one message per ~8 ms. */
  private buffer(terminal: Terminal, data: string): void {
    terminal.pending += data;
    terminal.timer ??= setTimeout(() => this.flush(terminal), FLUSH_MS);
  }

  private flush(terminal: Terminal): void {
    if (terminal.timer) clearTimeout(terminal.timer);
    terminal.timer = undefined;
    const data = terminal.pending;
    if (!data) return;
    terminal.pending = '';
    terminal.replay.push(data);
    terminal.replayLength += data.length;
    while (terminal.replayLength > REPLAY_LIMIT && terminal.replay.length > 1) {
      terminal.replayLength -= terminal.replay.shift()!.length;
    }
    this.options.onData(terminal.info.id, data);
  }

  private changed(): void {
    this.options.onChange(this.list());
  }
}
