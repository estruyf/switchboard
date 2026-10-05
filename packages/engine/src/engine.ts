import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  contract,
  serveRpc,
  type Contract,
  type HandlerContext,
  type Handlers,
  type LogEntry,
  type LogLevel,
  type RpcServer,
  type SystemInfo,
  type Transport,
} from '@switchboard/protocol';
import { LiveRegistry } from './claude/liveRegistry.ts';
import { createProjectResolver } from './claude/projectResolver.ts';
import { sdkSessionSource, type SessionSource } from './claude/sessionSource.ts';
import { createAppStateStore } from './db/appState.ts';
import { openCacheDatabase } from './db/database.ts';
import { findClaude } from './system/claudeBinary.ts';
import { SessionIndex } from './sessions/sessionIndex.ts';
import { TranscriptHub } from './sessions/transcriptHub.ts';
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
  /** Where sessions are read from. Defaults to the Claude Agent SDK (tests pass a fake). */
  sessionSource?: SessionSource;
  /** Start watching ~/.claude immediately. Defaults to true. */
  watchSessions?: boolean;
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

  const broadcast: RpcServer<Contract>['emit'] = (name, payload) => {
    for (const server of servers) server.emit(name, payload);
  };

  // The SDK reads CLAUDE_CONFIG_DIR itself; keep it pointed at the same folder we watch.
  if (options.claudeConfigDir && !options.sessionSource) process.env.CLAUDE_CONFIG_DIR = options.claudeConfigDir;
  const source = options.sessionSource ?? sdkSessionSource();
  const resolver = createProjectResolver();
  const transcripts = new TranscriptHub(source, log);
  const sessions = new SessionIndex({
    db: cache.db,
    source,
    projectsDir: join(claudeConfigDir, 'projects'),
    resolver,
    log,
    onChange: (change) => broadcast('sessions.changed', change),
    onTranscriptChanged: (id) => transcripts.changed(id),
  });
  const registry = new LiveRegistry({
    dir: join(claudeConfigDir, 'sessions'),
    resolveRoot: (cwd) => resolver.resolve(cwd).root,
    onChange: (live) => broadcast('sessions.live', { live }),
  });
  if (options.watchSessions !== false) {
    sessions.start();
    registry.start();
  }

  /** Transcript subscriptions per connection, so `transcript.unwatch` and disconnects can clean up. */
  const subscriptions = new WeakMap<HandlerContext<Contract>, Map<string, () => void>>();
  const subscriptionsFor = (context: HandlerContext<Contract>) => {
    let map = subscriptions.get(context);
    if (!map) {
      const created = new Map<string, () => void>();
      subscriptions.set(context, created);
      context.onDispose(() => {
        for (const stop of created.values()) stop();
        created.clear();
      });
      map = created;
    }
    return map;
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
    'sessions.list': () => ({ ...sessions.snapshot(), live: registry.list() }),
    'sessions.refresh': async () => {
      await sessions.refresh();
      registry.scan();
      return {};
    },
    'transcript.get': async ({ sessionId }) => ({ sessionId, messages: await transcripts.read(sessionId) }),
    'transcript.watch': ({ sessionId }, context) => {
      const map = subscriptionsFor(context);
      if (!map.has(sessionId)) {
        map.set(sessionId, transcripts.watch(sessionId, (update) => context.emit('transcript.updated', update)));
      }
      return {};
    },
    'transcript.unwatch': ({ sessionId }, context) => {
      const map = subscriptionsFor(context);
      map.get(sessionId)?.();
      map.delete(sessionId);
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
      sessions.stop();
      registry.stop();
      transcripts.stop();
      cache.close();
    },
  };
}
