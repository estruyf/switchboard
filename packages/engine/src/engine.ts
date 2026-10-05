import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  contract,
  RpcError,
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
import { HostManager, type SdkRuntime } from './host/hostManager.ts';
import { ProjectRegistry } from './projects/projectRegistry.ts';
import { createAppStateStore } from './db/appState.ts';
import { openCacheDatabase } from './db/database.ts';
import { findClaude } from './system/claudeBinary.ts';
import { SessionIndex } from './sessions/sessionIndex.ts';
import { TranscriptHub } from './sessions/transcriptHub.ts';
import { detectEditors, openInEditor } from './system/editors.ts';
import { FileIndex } from './system/files.ts';
import { ShellEnvironment } from './system/shellEnvironment.ts';
import type { ShellEnv } from './system/shellEnv.ts';
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
  /** Claude Code itself. Defaults to the Agent SDK (tests pass a fake). */
  sdk?: () => Promise<SdkRuntime>;
  /**
   * Moves files to the Trash. The desktop app routes this to Electron's
   * shell.trashItem; without it, deleted sessions are removed permanently.
   */
  trash?: (paths: string[]) => Promise<void>;
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
  const owned = new Set(
    (cache.db.prepare('SELECT id FROM owned_sessions').all() as Array<{ id: string }>).map((r) => r.id),
  );
  const markOwned = cache.db.prepare('INSERT OR IGNORE INTO owned_sessions (id, created_at) VALUES (?, ?)');
  const unmarkOwned = cache.db.prepare('DELETE FROM owned_sessions WHERE id = ?');
  const trash = options.trash ?? (async (paths: string[]) => paths.forEach((p) => rmSync(p, { recursive: true, force: true })));
  const storedBaseline = appState.get('sessions.baseline');
  const baseline = typeof storedBaseline === 'number' ? storedBaseline : Date.now();
  if (typeof storedBaseline !== 'number') appState.set('sessions.baseline', baseline);
  const projects = new ProjectRegistry(cache.db, join(options.dataDir, 'project-icons'));
  const sessions = new SessionIndex({
    baseline,
    isOwned: (id) => owned.has(id),
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
  const shell = new ShellEnvironment(appState, options.shellEnv ? () => options.shellEnv! : undefined);
  const claude = shell.forLookup().then((env) => findClaude(env, options.claudeBinary));
  const files = new FileIndex();

  const hosts = new HostManager({
    sdk: options.sdk ?? (() => import('@anthropic-ai/claude-agent-sdk')),
    env: async () => (await shell.ready).env,
    claudePath: async () => (await claude)?.path,
    isOpenElsewhere: (id) => !hosts.has(id) && registry.list().some((l) => l.sessionId === id),
    refreshLive: () => registry.scan(),
    sessionCwd: (id) => sessions.get(id)?.cwd ?? registry.list().find((l) => l.sessionId === id)?.cwd ?? null,
    onInfo: (info) => broadcast('session.host', info),
    onStream: (delta) => broadcast('session.stream', delta),
    onMessages: (id, messages) => transcripts.pushLive(id, messages),
    onPermission: (request) => broadcast('session.permission', request),
    onPermissionResolved: (requestId, sessionId) => broadcast('session.permissionResolved', { requestId, sessionId }),
    onCreated: (id) => {
      owned.add(id);
      markOwned.run(id, Date.now());
    },
    log,
  });

  const defaultEditorKey = 'editor.default';
  const editorEnv = () => shell.forLookup();

  const handlers: Handlers<Contract> = {
    'system.info': async (): Promise<SystemInfo> => {
      const described = await shell.describe();
      return {
        engineVersion: pkg.version,
        startedAt,
        versions: {
          node: process.versions.node,
          electron: process.versions.electron ?? null,
          sqlite: cache.sqliteVersion,
        },
        paths: { dataDir: options.dataDir, database: cache.path, claudeConfigDir },
        shell: { path: described.shell, resolved: described.resolved, cached: described.cached, durationMs: described.durationMs },
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
    'sessions.setFlags': ({ sessionId, pinned, settled }) => {
      sessions.setFlags(sessionId, { ...(pinned !== undefined ? { pinned } : {}), ...(settled !== undefined ? { settled } : {}) });
      return {};
    },
    'session.delete': async ({ sessionId }) => {
      if (!hosts.has(sessionId) && registry.list().some((l) => l.sessionId === sessionId)) {
        throw new RpcError('SESSION_BUSY_ELSEWHERE', 'This session is open in another Claude Code window. Close it there first.');
      }
      await hosts.release(sessionId);
      const transcript = sessions.pathFor(sessionId);
      if (!transcript) throw new RpcError('NOT_FOUND', 'No transcript found for this session');
      // The same files Claude Code's own deleteSession removes: the transcript and its subagent folder.
      const paths = [transcript, transcript.replace(/\.jsonl$/, '')].filter((p) => existsSync(p));
      await trash(paths);
      sessions.forget(sessionId);
      owned.delete(sessionId);
      unmarkOwned.run(sessionId);
      log('info', `Moved session ${sessionId} to the Trash`);
      return {};
    },
    'sessions.markViewed': ({ sessionId }) => {
      sessions.markViewed(sessionId);
      return {};
    },
    'projects.list': () => ({ projects: projects.list(new Set(sessions.snapshot().sessions.map((s) => s.projectRoot))) }),
    'projects.add': ({ path }) => {
      projects.add(path);
      return {};
    },
    'projects.remove': ({ root }) => {
      projects.remove(root);
      return {};
    },
    'projects.setIcon': ({ root, icon }) => {
      projects.setIcon(root, icon);
      return {};
    },
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

    'hosts.list': () => hosts.list(),
    'session.create': async (params) => {
      if (!existsSync(params.cwd)) throw new RpcError('NOT_FOUND', `Folder not found: ${params.cwd}`);
      if (params.worktree && !resolver.resolve(params.cwd).gitDir) {
        throw new RpcError('NOT_A_REPO', 'Worktrees need a git repository');
      }
      return { sessionId: await hosts.create(params) };
    },
    'session.send': (params) => hosts.send(params),
    'session.interrupt': async ({ sessionId }) => {
      await hosts.interrupt(sessionId);
      return {};
    },
    'session.setPermissionMode': async ({ sessionId, mode }) => {
      await hosts.setPermissionMode(sessionId, mode);
      return {};
    },
    'session.setModel': async ({ sessionId, model }) => {
      await hosts.setModel(sessionId, model);
      return {};
    },
    'session.close': ({ sessionId }) => {
      hosts.close(sessionId);
      return {};
    },
    'session.respond': ({ requestId, decision }) => {
      hosts.respond(requestId, decision);
      return {};
    },
    'session.commands': ({ sessionId, cwd }) => ({ commands: hosts.commands(sessionId, cwd) }),
    'session.prewarm': ({ cwd }) => {
      if (existsSync(cwd)) void hosts.prewarm(cwd).catch((error: Error) => log('debug', `Pre-warm failed: ${error.message}`));
      return {};
    },
    'models.list': () => ({ models: hosts.listModels() }),

    'projects.inspect': ({ path }) => {
      const exists = existsSync(path);
      const location = resolver.resolve(path);
      return { path, exists, isGitRepo: exists && location.gitDir !== null, root: location.root, branch: resolver.branch(location) };
    },
    'files.search': async ({ cwd, query, limit }) => ({ files: await files.search(cwd, query, limit) }),
    'editors.list': async () => {
      const editors = detectEditors(await editorEnv());
      const stored = appState.get(defaultEditorKey);
      const defaultId = typeof stored === 'string' && editors.some((e) => e.id === stored) ? stored : (editors.find((e) => e.kind === 'editor')?.id ?? null);
      return { editors, defaultId };
    },
    'editors.open': async ({ path, line, editorId }) => {
      const env = await editorEnv();
      const stored = appState.get(defaultEditorKey);
      const id = editorId ?? (typeof stored === 'string' ? stored : detectEditors(env).find((e) => e.kind === 'editor')?.id);
      if (!id) throw new RpcError('NO_EDITOR', 'No editor found. Install one or pick one in the Open in menu.');
      if (!existsSync(path)) throw new RpcError('NOT_FOUND', `Not found: ${path}`);
      openInEditor(id, path, line, env);
      if (editorId && (detectEditors(env).find((e) => e.id === editorId)?.kind === 'editor')) appState.set(defaultEditorKey, editorId);
      return {};
    },
    'editors.setDefault': ({ editorId }) => {
      appState.set(defaultEditorKey, editorId);
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
      hosts.closeAll();
      sessions.stop();
      registry.stop();
      transcripts.stop();
      cache.close();
    },
  };
}
