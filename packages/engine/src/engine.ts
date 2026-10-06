import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_PROFILE_ID,
  contract,
  RpcError,
  serveRpc,
  type Contract,
  type HandlerContext,
  type LiveSession,
  type Handlers,
  type LogEntry,
  type LogLevel,
  type RpcServer,
  type SlashCommand,
  type SystemInfo,
  type Transport,
} from '@switchboard/protocol';
import { LiveRegistry } from './claude/liveRegistry.ts';
import { createProjectResolver } from './claude/projectResolver.ts';
import { sdkSessionSource, type SessionSource } from './claude/sessionSource.ts';
import { fileDiff, listBranches, listChanges, removeWorktree, revert, stage, switchBranch, worktreeStatus } from './git/gitChanges.ts';
import { SearchIndex } from './sessions/searchIndex.ts';
import { installedPlugins } from './host/capabilities.ts';
import { ActionStore, expandCommand, shellQuote, suggestActions } from './actions/actionStore.ts';
import { HostManager, type SdkRuntime } from './host/hostManager.ts';
import { UsageMonitor } from './host/usageMonitor.ts';
import { ProjectRegistry, type FolderActivity } from './projects/projectRegistry.ts';
import { createAppStateStore } from './db/appState.ts';
import { ConfigDirLane } from './profiles/configDirLane.ts';
import { AccountWatcher } from './profiles/accountWatcher.ts';
import { ProfileStore, type ProfileRuntime } from './profiles/profileStore.ts';
import { MultiProfileSource } from './profiles/profileSources.ts';
import { openCacheDatabase } from './db/database.ts';
import { findClaude } from './system/claudeBinary.ts';
import { normaliseMessage } from './claude/transcript.ts';
import { SessionIndex } from './sessions/sessionIndex.ts';
import { TerminalManager, type SpawnPty } from './terminals/terminalManager.ts';
import { TranscriptHub } from './sessions/transcriptHub.ts';
import { detectEditors, openInEditor } from './system/editors.ts';
import { FileIndex } from './system/files.ts';
import { ShellEnvironment } from './system/shellEnvironment.ts';
import { detectTerminalFont } from './system/terminalFont.ts';
import type { ShellEnv } from './system/shellEnv.ts';
import pkg from '../package.json' with { type: 'json' };

export interface EngineOptions {
  /** Where the app keeps its own data (the cache database lives here). */
  dataDir: string;
  /** The built-in profile's config folder. Defaults to $CLAUDE_CONFIG_DIR or ~/.claude. */
  claudeConfigDir?: string;
  /** Use this `claude` binary instead of searching PATH. */
  claudeBinary?: string;
  /** Skip reading the login shell (tests). Defaults to resolving it. */
  shellEnv?: Promise<ShellEnv>;
  /** Mirror of every log entry, e.g. to write it to stderr. */
  onLog?: (entry: LogEntry) => void;
  /** Where the built-in profile's sessions are read from. Defaults to the Claude Agent SDK (tests pass a fake). */
  sessionSource?: SessionSource;
  /** Start watching ~/.claude immediately. Defaults to true. */
  watchSessions?: boolean;
  /** Claude Code itself. Defaults to the Agent SDK (tests pass a fake). */
  sdk?: () => Promise<SdkRuntime>;
  /**
   * Moves files to the Trash. The desktop app routes this to Electron's
   * shell.trashItem; without it, deleted sessions are removed permanently. Session files are
   * scoped to the config folder they live in, files of a revert to their repository.
   */
  trash?: (paths: string[], scope: TrashScope) => Promise<void>;
  /** Pseudo-terminal factory. Defaults to node-pty. */
  spawnPty?: () => Promise<SpawnPty>;
}

export type TrashScope = { configDir: string } | { repoRoot: string };

export interface Engine {
  /** Serves the contract over a transport (one per window). Returns a detach function. */
  attach(transport: Transport): () => void;
  log(level: LogLevel, message: string): void;
  close(): void;
}

/** The built-in profile keeps the key used before profiles existed. */
const commandCacheKey = ({ profileId, cwd }: { profileId: string; cwd: string }) =>
  profileId === BUILTIN_PROFILE_ID ? `commands:${cwd}` : `commands:${profileId}:${cwd}`;

export function createEngine(options: EngineOptions): Engine {
  const startedAt = Date.now();
  const claudeConfigDir = options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const configDirFromEnv = Boolean(options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR);
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

  // Slow-ish (login shell), so start it now and await on demand. Before any transcript is read: the
  // shell must inherit the engine's own environment, not a profile's folder (see ConfigDirLane).
  const shell = new ShellEnvironment(appState, options.shellEnv ? () => options.shellEnv! : undefined);
  // One Claude Code login per config folder. Profiles can be added and removed at runtime, so
  // everything per profile (sources, live registries, usage) is looked up through `profiles`.
  const profiles = new ProfileStore(cache.db, appState, { configDir: claudeConfigDir, fromEnv: configDirFromEnv }, (snapshot) => {
    broadcast('profiles.changed', snapshot);
    profilesChanged();
  });
  // The SDK's transcript readers take the folder from process.env.CLAUDE_CONFIG_DIR: one folder at a time.
  const lane = new ConfigDirLane();
  const sdkSources = new Map<string, SessionSource>();
  const sourceFor = (profile: ProfileRuntime): SessionSource => {
    if (options.sessionSource && profile.id === BUILTIN_PROFILE_ID) return options.sessionSource;
    const key = `${profile.id}\0${profile.configDir}`;
    let found = sdkSources.get(key);
    if (!found) sdkSources.set(key, (found = sdkSessionSource((fn) => lane.run(profile.envDir, fn))));
    return found;
  };
  const source = new MultiProfileSource(() => profiles.runtimes().map((profile) => ({ profileId: profile.id, source: sourceFor(profile) })));
  const resolver = createProjectResolver();
  const transcripts = new TranscriptHub(source, log);
  const owned = new Set(
    (cache.db.prepare('SELECT id FROM owned_sessions').all() as Array<{ id: string }>).map((r) => r.id),
  );
  const markOwned = cache.db.prepare('INSERT OR IGNORE INTO owned_sessions (id, created_at) VALUES (?, ?)');
  const unmarkOwned = cache.db.prepare('DELETE FROM owned_sessions WHERE id = ?');
  const continued = new Set(
    (cache.db.prepare('SELECT id FROM continued_sessions').all() as Array<{ id: string }>).map((r) => r.id),
  );
  const markContinued = cache.db.prepare('INSERT OR IGNORE INTO continued_sessions (id, created_at) VALUES (?, ?)');
  const unmarkContinued = cache.db.prepare('DELETE FROM continued_sessions WHERE id = ?');
  const trash = options.trash ?? (async (paths: string[], _scope: TrashScope) => paths.forEach((p) => rmSync(p, { recursive: true, force: true })));
  const storedBaseline = appState.get('sessions.baseline');
  const baseline = typeof storedBaseline === 'number' ? storedBaseline : Date.now();
  if (typeof storedBaseline !== 'number') appState.set('sessions.baseline', baseline);
  const projects = new ProjectRegistry(cache.db, join(options.dataDir, 'project-icons'));
  const sessions = new SessionIndex({
    baseline,
    isOwned: (id) => owned.has(id),
    isContinued: (id) => continued.has(id),
    db: cache.db,
    source,
    projectsDirs: () => profiles.runtimes().map((profile) => ({ profileId: profile.id, dir: join(profile.configDir, 'projects') })),
    resolver,
    log,
    onChange: (change) => {
      broadcast('sessions.changed', change);
      scheduleSearchSync();
    },
    onTranscriptChanged: (id) => transcripts.changed(id),
  });
  // Full-text search: indexed in the background, a little after anything changes.
  const search = new SearchIndex(
    cache.db,
    source,
    () => sessions.snapshot().sessions.map((s) => ({ id: s.id, version: `${s.updatedAt}:${s.fileSize ?? ''}` })),
    log,
  );
  // A fixed delay, not a debounce: busy sessions change every second and must not keep pushing it back.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSearchSync(delayMs = 3_000) {
    if (searchTimer) return;
    searchTimer = setTimeout(() => {
      searchTimer = undefined;
      void search.sync();
    }, delayMs);
    searchTimer.unref?.();
  }
  /** The engine's own short-lived helper processes (usage, command lists): never shown as live sessions. */
  const ephemeral = new Set<string>();
  /** Running Claude Code processes, from each profile's `sessions` folder. */
  const registries = new Map<string, LiveRegistry>();
  const liveList = (): LiveSession[] => [...registries.values()].flatMap((r) => r.list());
  const scanLive = () => registries.forEach((r) => r.scan());
  /** One registry per profile folder; started ones follow profiles being added and removed. */
  const syncRegistries = (start: boolean) => {
    const wanted = new Map(profiles.runtimes().map((p) => [`${p.id}\0${p.configDir}`, p]));
    for (const [key, registry] of registries) {
      if (!wanted.has(key)) {
        registry.stop();
        registries.delete(key);
      }
    }
    for (const [key, profile] of wanted) {
      if (registries.has(key)) continue;
      const registry = new LiveRegistry({
        ignore: (id) => ephemeral.has(id),
        dir: join(profile.configDir, 'sessions'),
        profileId: profile.id,
        resolveRoot: (cwd) => resolver.resolve(cwd).root,
        onChange: () => broadcast('sessions.live', { live: liveList() }),
      });
      registries.set(key, registry);
      if (start) registry.start();
    }
  };
  const watching = options.watchSessions !== false;
  syncRegistries(watching);
  if (watching) sessions.start();
  // Signing in happens in a terminal (`/login`), outside Switchboard: follow each profile's login file.
  const accounts = new AccountWatcher(
    () => profiles.accountFiles(),
    () => {
      const snapshot = profiles.refreshAccounts();
      if (snapshot) broadcast('profiles.changed', snapshot);
    },
  );
  if (watching) accounts.start();

  /** Profiles were added or removed: read their folders (or stop reading them). */
  function profilesChanged() {
    syncRegistries(watching);
    if (watching) accounts.sync();
    broadcast('sessions.live', { live: liveList() });
    void sessions.rootsChanged();
    const ids = new Set(profiles.runtimes().map((p) => p.id));
    for (const [id, monitor] of usageMonitors) {
      if (!ids.has(id)) {
        monitor.stop();
        usageMonitors.delete(id);
      }
    }
  }

  /** The profile a session belongs to: where its transcript is, or the process that runs it. */
  const sessionProfile = (sessionId: string): string =>
    sessions.get(sessionId)?.profileId ??
    liveList().find((l) => l.sessionId === sessionId)?.profileId ??
    source.ownerOf(sessionId) ??
    profiles.defaultId();
  /** The profile new sessions in a folder's project use. */
  const folderProfile = (cwd: string) => profiles.forProject(resolver.resolve(cwd).root);
  const requireProfile = (id: string) => {
    if (!profiles.has(id)) throw new RpcError('NOT_FOUND', 'That Claude profile no longer exists');
    return id;
  };

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

  const claude = shell.forLookup().then((env) => findClaude(env, options.claudeBinary));
  const files = new FileIndex();

  const sdk = options.sdk ?? (() => import('@anthropic-ai/claude-agent-sdk'));
  /** The login shell's environment, pointed at a profile's config folder. */
  const envFor = async (profileId: string): Promise<Record<string, string>> => {
    const env = { ...(await shell.ready).env };
    const { envDir } = profiles.runtime(profileId);
    if (envDir) env.CLAUDE_CONFIG_DIR = envDir;
    return env;
  };
  /** Plan usage per profile (each login has its own limits), started when first asked for. */
  const usageMonitors = new Map<string, UsageMonitor>();
  const usageFor = (profileId: string) => {
    let monitor = usageMonitors.get(profileId);
    if (!monitor) {
      monitor = new UsageMonitor({
        sdk,
        env: () => envFor(profileId),
        claudePath: async () => (await claude)?.path,
        onChange: (snapshot) => broadcast('usage.changed', { profileId, usage: snapshot }),
        log,
        ephemeral,
      });
      usageMonitors.set(profileId, monitor);
    }
    return monitor;
  };
  const hosts = new HostManager({
    sdk,
    ephemeral,
    onUsageHint: (profileId) => usageMonitors.get(profileId)?.nudge(),
    env: envFor,
    claudePath: async () => (await claude)?.path,
    isOpenElsewhere: (id) => !hosts.has(id) && liveList().some((l) => l.sessionId === id),
    refreshLive: scanLive,
    sessionCwd: (id) => sessions.get(id)?.cwd ?? liveList().find((l) => l.sessionId === id)?.cwd ?? null,
    sessionProfile,
    onInfo: (info) => broadcast('session.host', info),
    onStream: (delta) => broadcast('session.stream', delta),
    onMessages: (id, messages) => transcripts.pushLive(id, messages),
    onPermission: (request) => broadcast('session.permission', request),
    onPermissionResolved: (requestId, sessionId) => broadcast('session.permissionResolved', { requestId, sessionId }),
    onCreated: (id) => {
      owned.add(id);
      markOwned.run(id, Date.now());
    },
    onContinued: (id) => {
      if (owned.has(id) || continued.has(id)) return;
      continued.add(id);
      markContinued.run(id, Date.now());
      sessions.republish(id);
    },
    installedPlugins: (profileId) => installedPlugins(profiles.runtime(profileId).configDir),
    commandCache: {
      // Persisted for an hour; Claude Code reports fresh lists from every running session anyway.
      get: (key) => {
        const stored = appState.get(commandCacheKey(key)) as { at: number; commands: SlashCommand[] } | null;
        return stored && Date.now() - stored.at < 3_600_000 ? stored.commands : null;
      },
      set: (key, commands) => appState.set(commandCacheKey(key), { at: Date.now(), commands }),
    },
    log,
  });

  /** Windows attached to each terminal's output. */
  const terminalViewers = new Map<string, Set<HandlerContext<Contract>>>();
  const terminals = new TerminalManager({
    ...(options.spawnPty ? { spawn: options.spawnPty } : {}),
    env: async () => (await shell.ready).env,
    claudePath: async () => (await claude)?.path,
    onData: (id, data) => {
      for (const viewer of terminalViewers.get(id) ?? []) viewer.emit('terminal.data', { id, data });
    },
    onChange: (list) => broadcast('terminals.changed', { terminals: list }),
    log,
  });
  const viewTerminal = (id: string, context: HandlerContext<Contract>, attach: boolean) => {
    let viewers = terminalViewers.get(id);
    if (attach) {
      if (!viewers) terminalViewers.set(id, (viewers = new Set()));
      if (!viewers.has(context)) {
        viewers.add(context);
        context.onDispose(() => terminalViewers.get(id)?.delete(context));
      }
    } else {
      viewers?.delete(context);
    }
  };

  const actions = new ActionStore(cache.db);

  /** Runs an action's command in a terminal tab of the session and returns the terminal id. */
  const runShellAction = async (sessionId: string, cwd: string, name: string, command: string) =>
    (await terminals.open({ sessionId, cwd, kind: 'action', command, title: name, cols: 100, rows: 20, fork: false, env: profileEnv(sessionProfile(sessionId)) })).id;
  /** A terminal for a session gets its profile's config folder, so `claude` in it uses the same login. */
  const profileEnv = (profileId: string): Record<string, string> => {
    const { envDir } = profiles.runtime(profileId);
    return envDir ? { CLAUDE_CONFIG_DIR: envDir } : {};
  };

  /**
   * For a new worktree: wait until Claude Code has created it, then run the
   * project's setup actions there one by one (untrusted shared ones are skipped).
   */
  const worktreeSetup = (sessionId: string, repoCwd: string, worktreeName: string) => {
    const root = resolver.resolve(repoCwd).root;
    const setup = actions.list(root).actions.filter((a) => a.runOnWorktreeCreate && a.type === 'shell');
    if (setup.length === 0) return undefined;
    return async () => {
      const path = join(root, '.claude', 'worktrees', worktreeName);
      const deadline = Date.now() + 30_000;
      while (!existsSync(path)) {
        if (Date.now() > deadline) throw new Error(`Worktree ${path} did not appear`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (const action of setup) {
        if (!action.trusted) {
          log('warn', `Skipped setup action "${action.name}": approve it once by running it from the actions menu`);
          continue;
        }
        const vars = { cwd: path, projectRoot: root, branch: `worktree-${worktreeName}`, worktreeName, sessionId, sessionTitle: '' };
        const id = await runShellAction(sessionId, action.cwd === 'project-root' ? root : path, `Setup: ${action.name}`, expandCommand(action.command, vars, true));
        const code = await terminals.waitForExit(id);
        if (code !== 0) log('warn', `Setup action "${action.name}" exited with ${code}`);
      }
    };
  };

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
    'sessions.list': () => ({ ...sessions.snapshot(), live: liveList() }),
    'sessions.setFlags': ({ sessionId, pinned, settled }) => {
      sessions.setFlags(sessionId, { ...(pinned !== undefined ? { pinned } : {}), ...(settled !== undefined ? { settled } : {}) });
      return {};
    },
    'session.delete': async ({ sessionId }) => {
      if (!hosts.has(sessionId) && liveList().some((l) => l.sessionId === sessionId)) {
        throw new RpcError('SESSION_BUSY_ELSEWHERE', 'This session is open in another Claude Code window. Close it there first.');
      }
      await hosts.release(sessionId);
      const transcript = sessions.pathFor(sessionId);
      if (!transcript) throw new RpcError('NOT_FOUND', 'No transcript found for this session');
      // The same files Claude Code's own deleteSession removes: the transcript and its subagent folder.
      const paths = [transcript, transcript.replace(/\.jsonl$/, '')].filter((p) => existsSync(p));
      await trash(paths, { configDir: profiles.runtime(sessionProfile(sessionId)).configDir });
      sessions.forget(sessionId);
      owned.delete(sessionId);
      unmarkOwned.run(sessionId);
      continued.delete(sessionId);
      unmarkContinued.run(sessionId);
      log('info', `Moved session ${sessionId} to the Trash`);
      return {};
    },
    'sessions.markViewed': ({ sessionId }) => {
      sessions.markViewed(sessionId);
      return {};
    },
    'projects.list': () => {
      const activity = new Map<string, FolderActivity>();
      for (const s of sessions.snapshot().sessions) {
        const entry = activity.get(s.projectRoot);
        if (entry) {
          entry.count++;
          entry.lastActivity = Math.max(entry.lastActivity, s.updatedAt);
        } else activity.set(s.projectRoot, { count: 1, lastActivity: s.updatedAt });
      }
      return { projects: projects.list(activity) };
    },
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
    'projects.setProfile': ({ root, profileId }) => {
      profiles.linkProject(root, profileId);
      return {};
    },
    'profiles.list': () => profiles.snapshot(),
    'profiles.add': ({ name, color, configDir }) => {
      const id = profiles.add(name, color, configDir);
      log('info', `Added Claude profile "${name}" (${configDir})`);
      return { id };
    },
    'profiles.update': ({ id, name, color }) => {
      profiles.update(id, { ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}) });
      return {};
    },
    'profiles.remove': ({ id }) => {
      profiles.remove(id);
      return {};
    },
    'profiles.setDefault': ({ id }) => {
      profiles.setDefault(id);
      return {};
    },
    'projects.setDefaults': ({ root, defaults }) => {
      projects.setDefaults(root, defaults);
      return {};
    },
    'projects.reorder': ({ roots }) => {
      projects.reorder(roots);
      return {};
    },
    'sessions.refresh': async () => {
      await sessions.refresh();
      scanLive();
      return {};
    },
    'transcript.get': async ({ sessionId }) => ({ sessionId, messages: await transcripts.read(sessionId) }),
    'transcript.subagent': async ({ sessionId, toolUseId }) => {
      // Each subagent leaves agent-<id>.meta.json next to its transcript, naming the tool call that started it.
      const transcript = sessions.pathFor(sessionId);
      const dir = transcript ? join(transcript.replace(/\.jsonl$/, ''), 'subagents') : null;
      let agentId: string | null = null;
      let agentType: string | null = null;
      for (const file of dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.meta.json')) : []) {
        try {
          const meta = JSON.parse(readFileSync(join(dir!, file), 'utf8')) as { toolUseId?: unknown; agentType?: unknown };
          if (meta.toolUseId === toolUseId) {
            agentId = file.replace(/^agent-/, '').replace(/\.meta\.json$/, '');
            agentType = typeof meta.agentType === 'string' ? meta.agentType : null;
            break;
          }
        } catch {
          // A half-written meta file: the next poll will see it.
        }
      }
      if (!agentId || !source.subagentMessages) return { agentId, agentType, messages: [] };
      const sink = transcripts.images.sink(sessionId);
      return { agentId, agentType, messages: (await source.subagentMessages(sessionId, agentId)).map((m) => normaliseMessage(m, sink)) };
    },
    'transcript.image': async ({ sessionId, imageId }) => {
      const image = await transcripts.image(sessionId, imageId);
      if (!image) throw new RpcError('NOT_FOUND', 'Image not found in this transcript');
      return image;
    },
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
      const { checkoutBranch, profileId: chosenProfile, ...create } = params;
      const profileId = requireProfile(chosenProfile ?? folderProfile(params.cwd));
      if (checkoutBranch) {
        if (params.worktree) throw new RpcError('INVALID', 'A new worktree gets its own branch; choose the current folder to check out a branch');
        try {
          await switchBranch(params.cwd, checkoutBranch);
        } catch (error) {
          throw new RpcError('GIT_FAILED', `Could not check out ${checkoutBranch}: ${(error as Error).message}`);
        }
      }
      const worktree = params.worktree;
      const setup = worktree ? (id: string) => worktreeSetup(id, params.cwd, worktree.name)?.() ?? Promise.resolve() : undefined;
      return { sessionId: await hosts.create({ ...create, profileId, ...(setup ? { beforeFirstMessage: setup } : {}) }) };
    },
    'session.send': (params) => hosts.send(params),
    'session.forkAt': async ({ sessionId, messageUuid }) => {
      if (!source.fork) throw new RpcError('UNSUPPORTED', 'Forking is not available');
      let forked: string;
      try {
        forked = await source.fork(sessionId, messageUuid);
      } catch (error) {
        throw new RpcError('FORK_FAILED', (error as Error).message);
      }
      owned.add(forked);
      markOwned.run(forked, Date.now());
      await sessions.refresh();
      return { sessionId: forked };
    },
    'session.rewind': ({ sessionId, messageUuid, dryRun }) => hosts.rewind(sessionId, messageUuid, dryRun),
    'session.interrupt': async ({ sessionId }) => {
      await hosts.interrupt(sessionId);
      return {};
    },
    'session.setPermissionMode': async ({ sessionId, mode }) => {
      await hosts.setPermissionMode(sessionId, mode);
      return {};
    },
    'session.setEffort': async ({ sessionId, effort }) => {
      await hosts.setEffort(sessionId, effort);
      return {};
    },
    'session.context': ({ sessionId }) => hosts.context(sessionId),
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
    'session.commands': async ({ sessionId, cwd, profileId }) => ({
      commands: await hosts.commands(sessionId, cwd, profileId ?? (sessionId ? sessionProfile(sessionId) : cwd ? folderProfile(cwd) : profiles.defaultId())),
    }),
    'session.capabilities': ({ sessionId, cwd, refresh, profileId }) =>
      hosts.capabilities(sessionId, cwd, refresh, profileId ?? (sessionId ? sessionProfile(sessionId) : folderProfile(cwd))),
    'session.mcp': async ({ sessionId, server, action }) => {
      await hosts.mcp(sessionId, server, action);
      return {};
    },
    'session.prewarm': ({ cwd, profileId }) => {
      const profile = profileId && profiles.has(profileId) ? profileId : folderProfile(cwd);
      if (existsSync(cwd)) void hosts.prewarm(cwd, profile).catch((error: Error) => log('debug', `Pre-warm failed: ${error.message}`));
      return {};
    },
    'models.list': () => ({ models: hosts.listModels() }),
    'usage.get': ({ refresh, profileId }) => usageFor(profileId && profiles.has(profileId) ? profileId : profiles.defaultId()).get(refresh),

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

    'actions.list': ({ projectRoot }) => actions.list(projectRoot),
    'actions.save': ({ projectRoot, action, previousId }) => {
      actions.save(projectRoot, action, previousId);
      return {};
    },
    'actions.delete': ({ projectRoot, id }) => {
      actions.remove(projectRoot, id);
      return {};
    },
    'actions.trust': ({ projectRoot, id }) => {
      const action = actions.list(projectRoot).actions.find((a) => a.id === id);
      if (!action) throw new RpcError('NOT_FOUND', 'No such action');
      actions.trust(projectRoot, action.command);
      return {};
    },
    'actions.suggest': ({ projectRoot }) => ({ suggestions: suggestActions(projectRoot) }),
    'actions.run': async ({ sessionId, projectRoot, cwd, id }) => {
      const action = actions.list(projectRoot).actions.find((a) => a.id === id);
      if (!action) throw new RpcError('NOT_FOUND', 'No such action');
      if (!action.trusted) throw new RpcError('UNTRUSTED', `"${action.name}" comes from ${projectRoot}/.switchboard.json and has not been approved yet`);
      const location = resolver.resolve(cwd);
      const vars = {
        cwd,
        projectRoot,
        branch: resolver.branch(location) ?? '',
        worktreeName: location.worktree?.name ?? '',
        sessionId,
        sessionTitle: sessions.get(sessionId)?.title ?? '',
      };
      if (action.type === 'prompt') {
        const sent = await hosts.send({ sessionId, text: expandCommand(action.command, vars, false), attachments: [], fork: false });
        return { kind: 'prompt' as const, sessionId: sent.sessionId, messageUuid: sent.messageUuid };
      }
      const runIn = action.cwd === 'project-root' ? projectRoot : cwd;
      return { kind: 'terminal' as const, terminalId: await runShellAction(sessionId, runIn, action.name, expandCommand(action.command, vars, true)) };
    },
    'search.query': async ({ query, limit }) => ({ hits: search.search(query, limit), indexing: { ...search.progress } }),
    'git.changes': async ({ cwd, base }) => {
      try {
        return await listChanges(cwd, base);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'git.diff': async ({ cwd, base, path }) => {
      try {
        return await fileDiff(cwd, base, path);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'git.branches': async ({ cwd }) => {
      if (!resolver.resolve(cwd).gitDir) return { current: null, branches: [] };
      try {
        return await listBranches(cwd);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'git.stage': async ({ cwd, paths, staged }) => {
      try {
        await stage(cwd, paths, staged);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
      return {};
    },
    'git.revert': async ({ cwd, paths }) => {
      try {
        const { root, untracked } = await revert(cwd, paths);
        if (untracked.length) await trash(untracked, { repoRoot: root });
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
      return {};
    },
    'worktree.status': async ({ cwd }) => {
      try {
        return await worktreeStatus(cwd);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'worktree.finish': async ({ sessionId, cwd, action, deleteBranch }) => {
      const status = await worktreeStatus(cwd).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      if (!status.isWorktree || !status.branch) throw new RpcError('NOT_A_WORKTREE', 'This session is not in a worktree');
      const branch = shellQuote(status.branch);
      if (action === 'merge') {
        if (status.uncommitted > 0) throw new RpcError('UNCOMMITTED', 'Commit or revert the uncommitted changes first; a merge only takes commits.');
        if (!status.baseBranch || status.mainCheckout.branch !== status.baseBranch) {
          throw new RpcError('WRONG_BRANCH', `The main checkout is on ${status.mainCheckout.branch ?? 'a detached HEAD'}, not ${status.baseBranch ?? 'the base branch'}.`);
        }
        if (status.mainCheckout.dirty) throw new RpcError('MAIN_DIRTY', 'The main checkout has uncommitted changes. Commit or stash them there first.');
        return { terminalId: await runShellAction(sessionId, status.root, `Merge ${status.branch}`, `git merge --no-edit ${branch}`) };
      }
      if (action === 'pr') {
        if (!status.hasRemote) throw new RpcError('NO_REMOTE', 'This repository has no remote to push to.');
        return { terminalId: await runShellAction(sessionId, status.path, 'Pull request', `git push -u origin ${branch} && gh pr create --fill --web`) };
      }
      if (status.uncommitted > 0) throw new RpcError('UNCOMMITTED', 'The worktree has uncommitted changes. Commit or revert them first.');
      await hosts.release(sessionId);
      try {
        await removeWorktree(status, deleteBranch);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
      return { terminalId: null };
    },
    'terminal.open': async (params) => {
      if (params.kind === 'claude' && params.sessionId && !params.fork) {
        if (hosts.has(params.sessionId)) {
          throw new RpcError('SESSION_RUNNING_HERE', 'This session is running in Switchboard. Stop it there first, or open a fork in the terminal.');
        }
        if (liveList().some((l) => l.sessionId === params.sessionId)) {
          throw new RpcError('SESSION_BUSY_ELSEWHERE', 'This session is open in another Claude Code window. Close it there first, or open a fork.');
        }
      }
      const profileId = params.sessionId ? sessionProfile(params.sessionId) : folderProfile(params.cwd);
      try {
        return await terminals.open({ ...params, env: profileEnv(profileId) });
      } catch (error) {
        throw new RpcError('TERMINAL_FAILED', (error as Error).message);
      }
    },
    'terminal.list': () => ({ terminals: terminals.list() }),
    'terminal.font': () => {
      const font = detectTerminalFont();
      return { fontFamily: font?.fontFamily ?? null, source: font?.source ?? null };
    },
    'terminal.attach': ({ id }, context) => {
      const result = terminals.replay(id);
      viewTerminal(id, context, true);
      return result;
    },
    'terminal.detach': ({ id }, context) => {
      viewTerminal(id, context, false);
      return {};
    },
    'terminal.write': ({ id, data }) => {
      terminals.write(id, data);
      return {};
    },
    'terminal.resize': ({ id, cols, rows }) => {
      terminals.resize(id, cols, rows);
      return {};
    },
    'terminal.close': ({ id }) => {
      terminals.close(id);
      terminalViewers.delete(id);
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
      for (const monitor of usageMonitors.values()) monitor.stop();
      terminals.closeAll();
      clearTimeout(searchTimer);
      sessions.stop();
      for (const registry of registries.values()) registry.stop();
      accounts.stop();
      transcripts.stop();
      cache.close();
    },
  };
}
