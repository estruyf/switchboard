import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  contract,
  serveRpc,
  type Contract,
  type Handlers,
  type LogEntry,
  type LogLevel,
  type RpcServer,
  type SystemInfo,
  type Transport,
} from '@switchboard/protocol';
import { createAppStateStore } from './db/appState.ts';
import { openCacheDatabase } from './db/database.ts';
import { findClaude } from './system/claudeBinary.ts';
import { resolveShellEnv, type ShellEnv } from './system/shellEnv.ts';
import pkg from '../package.json' with { type: 'json' };

export interface EngineOptions {
  /** Where the app keeps its own data (the cache database lives here). */
  dataDir: string;
  /** Defaults to $CLAUDE_CONFIG_DIR or ~/.claude. */
  claudeConfigDir?: string;
  /** Use this `claude` binary instead of searching PATH. */
  claudeBinary?: string;
  /** Skip reading the login shell (tests). Defaults to resolving it. */
  shellEnv?: Promise<ShellEnv>;
  /** Mirror of every log entry, e.g. to write it to stderr. */
  onLog?: (entry: LogEntry) => void;
}

export interface Engine {
  /** Serves the contract over a transport (one per window). Returns a detach function. */
  attach(transport: Transport): () => void;
  log(level: LogLevel, message: string): void;
  close(): void;
}

export function createEngine(options: EngineOptions): Engine {
  const startedAt = Date.now();
  const claudeConfigDir = options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const cache = openCacheDatabase(join(options.dataDir, 'cache.sqlite'));
  const appState = createAppStateStore(cache.db);
  const servers = new Set<RpcServer<Contract>>();

  const log = (level: LogLevel, message: string) => {
    const entry: LogEntry = { level, message, at: Date.now() };
    options.onLog?.(entry);
    for (const server of servers) server.emit('engine.log', entry);
  };

  if (cache.recovered) log('warn', 'Cache database was unreadable and has been rebuilt');

  // Both are slow-ish (login shell, `claude --version`), so start them now and await on demand.
  const shellEnv = options.shellEnv ?? resolveShellEnv();
  const claude = shellEnv.then((shell) => findClaude(shell.env, options.claudeBinary));

  const handlers: Handlers<Contract> = {
    'system.info': async (): Promise<SystemInfo> => {
      const shell = await shellEnv;
      return {
        engineVersion: pkg.version,
        startedAt,
        versions: {
          node: process.versions.node,
          electron: process.versions.electron ?? null,
          sqlite: cache.sqliteVersion,
        },
        paths: { dataDir: options.dataDir, database: cache.path, claudeConfigDir },
        shell: { path: shell.shell, resolved: shell.resolved, durationMs: shell.durationMs },
        claude: await claude,
      };
    },
    'system.ping': ({ sentAt }) => ({ sentAt, engineTime: Date.now() }),
    'appState.get': ({ key }) => ({ value: appState.get(key) }),
    'appState.set': ({ key, value }) => {
      appState.set(key, value);
      return {};
    },
  };

  return {
    attach(transport) {
      const server = serveRpc(contract, transport, handlers, {
        onUnexpectedError: (method, error) =>
          log('error', `${method} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`),
      });
      servers.add(server);
      return () => {
        servers.delete(server);
        server.dispose();
      };
    },
    log,
    close() {
      for (const server of servers) server.dispose();
      servers.clear();
      cache.close();
    },
  };
}
