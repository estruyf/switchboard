import { randomUUID } from 'node:crypto';
import type { CanUseTool, Options, PermissionResult, PermissionUpdate, Query, SDKUserMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import {
  RpcError,
  type Capabilities,
  type ContextUsage,
  type Effort,
  type ImageAttachment,
  type LogLevel,
  type ModelOption,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type PluginInfo,
  type RewindResult,
  type SessionHostInfo,
  type SlashCommand,
  type StreamDelta,
  type WorktreeRequest,
} from '@switchboard/protocol';
import { clipJson } from '../claude/transcript.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { describeSuggestions } from './permissions.ts';
import { readCapabilities } from './capabilities.ts';
import { buildOptions, SessionHost, type HostConfig, type StartQuery } from './sessionHost.ts';

/** The two SDK entry points the manager needs; injected so tests can fake Claude Code. */
export interface SdkRuntime {
  query(args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): Query;
  startup(args: { options: Options }): Promise<WarmQuery>;
}

export interface HostManagerDeps {
  sdk: () => Promise<SdkRuntime>;
  /** The full login-shell environment for Claude Code processes. */
  env: () => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  /** True when a Claude Code process outside this app has the session open. */
  isOpenElsewhere: (sessionId: string) => boolean;
  /** Re-reads the live registry now (instead of waiting for the next poll). */
  refreshLive?: () => void;
  /** The folder a session ran in (resumes must start there, or tools act in the wrong place). */
  sessionCwd: (sessionId: string) => string | null;
  onInfo: (info: SessionHostInfo) => void;
  onStream: (delta: StreamDelta) => void;
  onMessages: (sessionId: string, messages: RawSessionMessage[]) => void;
  onPermission: (request: PermissionRequest) => void;
  onPermissionResolved: (requestId: string, sessionId: string) => void;
  /** A session this app created (for the "Switchboard" origin badge). */
  onCreated: (sessionId: string) => void;
  log: (level: LogLevel, message: string) => void;
  /** Close processes idle for longer than this (default 30 min). The transcript stays; sending resumes. */
  idleTimeoutMs?: number;
  /** Discard an unused pre-warmed process after this long (default 2 min). */
  warmTtlMs?: number;
  /** Plan usage probably changed. */
  onUsageHint?: () => void;
  /** Helper processes register in the live registry while they run; the engine hides them. */
  ephemeral?: { add(sessionId: string): void; delete(sessionId: string): void };
  /** Installed plugins, for sessions that aren't running (their own list comes from Claude Code). */
  installedPlugins?: () => PluginInfo[];
  /** Persisted command lists per folder, so the palette is instant after a restart. */
  commandCache?: { get(cwd: string): SlashCommand[] | null; set(cwd: string, commands: SlashCommand[]): void };
}

/** Commands that only work in the terminal UI; Claude Code reports more at init. */
const TERMINAL_ONLY = new Set(['doctor', 'color', 'focus', 'reload-plugins']);

interface Pending {
  request: PermissionRequest;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[] | undefined;
  resolve: (result: PermissionResult) => void;
}

interface Warm {
  cwd: string;
  sessionId: string;
  warm: Promise<WarmQuery>;
  /** canUseTool is fixed at startup, so it forwards to whichever host adopts this process. */
  route: { canUseTool: CanUseTool | null };
  timer: ReturnType<typeof setTimeout>;
}

export interface CreateParams {
  cwd: string;
  prompt: string;
  attachments: ImageAttachment[];
  model: string | null;
  permissionMode: PermissionMode;
  effort: Effort | null;
  worktree: WorktreeRequest | null;
  /**
   * Runs after Claude Code has started (and created the worktree) but before
   * the first message, e.g. setup actions. Failures are logged; the message still goes.
   */
  beforeFirstMessage?: (sessionId: string) => Promise<void>;
}

const DEFAULT_MODELS: ModelOption[] = [
  { value: 'default', displayName: 'Default', description: 'Your Claude Code default', supportsEffort: true },
  { value: 'opus', displayName: 'Opus', description: 'Most capable', supportsEffort: true },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Fast and capable', supportsEffort: true },
  { value: 'haiku', displayName: 'Haiku', description: 'Fastest', supportsEffort: false },
];

/** Owns every Claude Code process this app runs, and brokers their permission prompts. */
export class HostManager {
  private readonly hosts = new Map<string, SessionHost>();
  private readonly pending = new Map<string, Pending>();
  private readonly commandsByCwd = new Map<string, SlashCommand[]>();
  private models: ModelOption[] = DEFAULT_MODELS;
  private warm: Warm | undefined;
  /** When this app stopped a session's process; its registry entry lingers until the process exits. */
  private readonly closedAt = new Map<string, number>();
  private readonly reaper: ReturnType<typeof setInterval>;

  constructor(private readonly deps: HostManagerDeps) {
    this.reaper = setInterval(() => this.reapIdle(), 60_000);
    this.reaper.unref?.();
  }

  list(): { hosts: SessionHostInfo[]; permissions: PermissionRequest[] } {
    return {
      hosts: [...this.hosts.values()].map((h) => h.info),
      permissions: [...this.pending.values()].map((p) => p.request),
    };
  }

  has(sessionId: string): boolean {
    return this.hosts.get(sessionId)?.active ?? false;
  }

  async create(params: CreateParams): Promise<string> {
    const warm = this.takeWarm(params);
    const sessionId = warm?.sessionId ?? randomUUID();
    const host = await this.spawn(
      {
        sessionId,
        cwd: params.cwd,
        mode: 'new',
        model: params.model,
        permissionMode: params.permissionMode,
        effort: params.effort,
        worktree: params.worktree,
      },
      warm,
    );
    this.deps.onCreated(sessionId);
    if (warm) {
      // The warm process started with defaults; apply this session's choices before the first message.
      if (params.model) await host.setModel(params.model).catch(() => {});
      if (params.permissionMode !== 'default') await host.setPermissionMode(params.permissionMode).catch(() => {});
    }
    if (params.beforeFirstMessage) {
      // Return the id now, so the window can show the session (and its setup terminals) right away.
      const before = params.beforeFirstMessage;
      void before(sessionId)
        .catch((error: Error) => this.deps.log('warn', `Worktree setup failed: ${error.message}`))
        .then(() => host.active && host.send(params.prompt, params.attachments));
    } else {
      host.send(params.prompt, params.attachments);
    }
    return sessionId;
  }

  /** The running host for a session, resuming it (or starting a fork) when it isn't running here. */
  private async ensureHost(sessionId: string, fork: boolean, busyMessage: string): Promise<SessionHost> {
    const running = fork ? undefined : this.hosts.get(sessionId);
    if (running?.active) return running;
    if (!fork && this.deps.isOpenElsewhere(sessionId) && this.recentlyClosed(sessionId)) {
      await this.waitForExit(sessionId);
    }
    if (!fork && this.deps.isOpenElsewhere(sessionId)) throw new RpcError('SESSION_BUSY_ELSEWHERE', busyMessage);
    const cwd = this.deps.sessionCwd(sessionId);
    if (!cwd) throw new RpcError('NOT_FOUND', 'Unknown session, or its folder is not recorded');
    return this.spawn({ sessionId, cwd, mode: fork ? 'fork' : 'resume', model: null, permissionMode: 'default', effort: null, worktree: null });
  }

  async send(params: { sessionId: string; text: string; attachments: ImageAttachment[]; fork: boolean }): Promise<{ sessionId: string; messageUuid: string }> {
    const host = await this.ensureHost(params.sessionId, params.fork, 'This session is open in another Claude Code window. Fork it to continue here.');
    const messageUuid = host.send(params.text, params.attachments);
    // A fork only learns its new id once Claude Code has started.
    const sessionId = params.fork ? await host.initialized : host.sessionId;
    if (params.fork) this.deps.onCreated(sessionId);
    return { sessionId, messageUuid };
  }

  /**
   * Restores files to how they were before one of your messages. `dryRun` only reports what would change.
   * Needs the session's process, so it is resumed here if it isn't running (not while open elsewhere).
   */
  async rewind(sessionId: string, userMessageId: string, dryRun: boolean): Promise<RewindResult> {
    const host = await this.ensureHost(sessionId, false, 'This session is open in another Claude Code window. Close it there to rewind its files.');
    if (host.info.state === 'running' || host.info.state === 'needs-you') {
      throw new RpcError('SESSION_BUSY', 'Claude is working in this session. Stop it first, then rewind.');
    }
    try {
      return await host.rewindFiles(userMessageId, dryRun);
    } catch (error) {
      throw new RpcError('REWIND_FAILED', (error as Error).message);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    // Pending prompts would otherwise keep the turn alive after the interrupt.
    for (const [requestId, pending] of this.pending) {
      if (pending.request.sessionId === sessionId) this.settle(requestId, { behavior: 'deny', message: 'Interrupted by the user.', interrupt: true });
    }
    await this.require(sessionId).interrupt();
  }

  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    return this.require(sessionId).setPermissionMode(mode);
  }

  setEffort(sessionId: string, effort: Effort | null): Promise<void> {
    return this.require(sessionId).setEffort(effort);
  }

  async context(sessionId: string): Promise<ContextUsage> {
    try {
      return await this.require(sessionId).contextUsage();
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError('CONTEXT_FAILED', (error as Error).message);
    }
  }

  setModel(sessionId: string, model: string | null): Promise<void> {
    return this.require(sessionId).setModel(model);
  }

  close(sessionId: string): void {
    const host = this.hosts.get(sessionId);
    if (host?.active) this.closedAt.set(sessionId, Date.now());
    host?.close();
    for (const [requestId, pending] of this.pending) {
      if (pending.request.sessionId === sessionId) this.settle(requestId, { behavior: 'deny', message: 'Session closed.' });
    }
  }

  /** Stops a session this app runs (if it does) and waits for its process to leave the registry. */
  async release(sessionId: string): Promise<void> {
    if (!this.has(sessionId)) return;
    this.close(sessionId);
    await this.waitForExit(sessionId);
  }

  respond(requestId: string, decision: PermissionDecision): void {
    const pending = this.pending.get(requestId);
    if (!pending) throw new RpcError('NOT_FOUND', 'This request was already answered or cancelled');
    if (decision.behavior === 'allow') {
      const result: PermissionResult = {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? pending.input,
      };
      if (decision.always && pending.suggestions) result.updatedPermissions = pending.suggestions;
      this.settle(requestId, result);
    } else {
      this.settle(requestId, { behavior: 'deny', message: decision.message ?? 'The user declined this action.', interrupt: decision.interrupt ?? false });
    }
  }

  /**
   * Slash commands (built-ins, custom commands, skills, plugins) for a session
   * or folder. Without a running session, a short-lived Claude Code process is
   * asked once (~0.6 s, no prompt is sent) and the answer is cached.
   */
  async commands(sessionId: string | undefined, cwd: string | undefined): Promise<SlashCommand[]> {
    const host = sessionId ? this.hosts.get(sessionId) : undefined;
    const folder = host?.info.cwd ?? cwd;
    const list = host?.commands.length ? host.commands : folder ? (this.commandsByCwd.get(folder) ?? (await this.fetchCommands(folder))) : [];
    for (const name of host?.terminalOnly ?? []) TERMINAL_ONLY.add(name);
    return list.filter((c) => !TERMINAL_ONLY.has(c.name));
  }

  private readonly commandFetches = new Map<string, Promise<SlashCommand[]>>();

  private fetchCommands(cwd: string): Promise<SlashCommand[]> {
    const cached = this.deps.commandCache?.get(cwd);
    if (cached) {
      this.commandsByCwd.set(cwd, cached);
      return Promise.resolve(cached);
    }
    let pending = this.commandFetches.get(cwd);
    if (!pending) {
      pending = this.listCommands(cwd)
        .then((commands) => {
          this.commandsByCwd.set(cwd, commands);
          this.deps.commandCache?.set(cwd, commands);
          return commands;
        })
        .catch((error: Error) => {
          this.deps.log('debug', `Listing commands in ${cwd} failed: ${error.message}`);
          return [];
        })
        .finally(() => this.commandFetches.delete(cwd));
      this.commandFetches.set(cwd, pending);
    }
    return pending;
  }

  private listCommands(cwd: string): Promise<SlashCommand[]> {
    return this.withHelper(cwd, async (query) =>
      (await query.supportedCommands()).map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint })),
    );
  }

  private readonly capabilityCache = new Map<string, { at: number; value: Promise<Capabilities> }>();

  /**
   * What a session can use. A session running here answers live (and its MCP servers can be
   * toggled); otherwise a helper process for the folder answers, cached for a minute.
   */
  async capabilities(sessionId: string | undefined, cwd: string, refresh: boolean): Promise<Capabilities> {
    const host = sessionId ? this.hosts.get(sessionId) : undefined;
    const plugins = () => this.deps.installedPlugins?.() ?? [];
    if (host?.active) return host.capabilities(plugins);
    const cached = this.capabilityCache.get(cwd);
    if (cached && !refresh && Date.now() - cached.at < 60_000) return cached.value;
    // A fresh helper has every MCP server pending; give them up to 5 s to connect.
    const value = this.withHelper(cwd, (query) => readCapabilities(query, plugins(), false, 5_000));
    this.capabilityCache.set(cwd, { at: Date.now(), value });
    value.catch(() => this.capabilityCache.delete(cwd));
    return value;
  }

  async mcp(sessionId: string, server: string, action: 'enable' | 'disable' | 'reconnect'): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host?.active) throw new RpcError('NOT_RUNNING', 'Start the session in Switchboard to change its MCP servers.');
    try {
      await host.mcp(server, action);
    } catch (error) {
      throw new RpcError('MCP_FAILED', (error as Error).message);
    }
  }

  /**
   * Runs `ask` against a short-lived Claude Code process for `cwd` that never gets a prompt,
   * so no session is written. It answers control requests (commands, agents, MCP) and is closed after.
   */
  private async withHelper<T>(cwd: string, ask: (query: Query) => Promise<T>): Promise<T> {
    const [env, claudePath, sdk] = await Promise.all([this.deps.env(), this.deps.claudePath(), this.deps.sdk()]);
    // A prompt that never yields: Claude Code starts, answers the question, and no session is written.
    const idle: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    const helperId = randomUUID();
    this.deps.ephemeral?.add(helperId);
    setTimeout(() => this.deps.ephemeral?.delete(helperId), 30_000).unref?.();
    const query = sdk.query({
      prompt: idle,
      options: {
        sessionId: helperId,
        persistSession: false,
        cwd,
        env,
        pathToClaudeCodeExecutable: claudePath,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
      },
    });
    try {
      return await Promise.race([ask(query), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 20_000))]);
    } finally {
      query.close();
    }
  }

  listModels(): ModelOption[] {
    return this.models;
  }

  /** Starts a Claude Code process for `cwd` so a new session there answers about a second faster. */
  async prewarm(cwd: string): Promise<void> {
    if (this.warm?.cwd === cwd) return;
    this.discardWarm();
    const sessionId = randomUUID();
    const route: Warm['route'] = { canUseTool: null };
    const options = buildOptions(
      {
        sessionId,
        cwd,
        mode: 'new',
        model: null,
        permissionMode: 'default',
        effort: null,
        worktree: null,
        env: await this.deps.env(),
        claudePath: await this.deps.claudePath(),
        canUseTool: (...args) => (route.canUseTool ? route.canUseTool(...args) : Promise.resolve({ behavior: 'deny', message: 'Not ready' })),
      },
      this.deps.log,
    );
    const warm = (await this.deps.sdk()).startup({ options });
    warm.catch((error: unknown) => this.deps.log('debug', `Pre-warm failed: ${(error as Error).message}`));
    const timer = setTimeout(() => this.discardWarm(), this.deps.warmTtlMs ?? 120_000);
    timer.unref?.();
    this.warm = { cwd, sessionId, warm, route, timer };
  }

  closeAll(): void {
    clearInterval(this.reaper);
    this.discardWarm();
    for (const id of [...this.hosts.keys()]) this.close(id);
  }

  // ---------------------------------------------------------------------------

  private recentlyClosed(sessionId: string): boolean {
    const at = this.closedAt.get(sessionId) ?? this.hosts.get(sessionId)?.closedAt;
    return at !== undefined && Date.now() - at < 15_000;
  }

  /** Gives a process this app just stopped up to 5 s to exit and leave the registry. */
  private async waitForExit(sessionId: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      this.deps.refreshLive?.();
      if (!this.deps.isOpenElsewhere(sessionId)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private require(sessionId: string): SessionHost {
    const host = this.hosts.get(sessionId);
    if (!host?.active) throw new RpcError('NOT_RUNNING', 'This session is not running in Switchboard');
    return host;
  }

  /** A warm process is only usable for a plain new session in the same folder (effort and worktree are fixed at startup). */
  private takeWarm(params: CreateParams): Warm | undefined {
    const warm = this.warm;
    if (!warm || warm.cwd !== params.cwd || params.worktree || params.effort) return undefined;
    clearTimeout(warm.timer);
    this.warm = undefined;
    return warm;
  }

  private discardWarm(): void {
    const warm = this.warm;
    if (!warm) return;
    this.warm = undefined;
    clearTimeout(warm.timer);
    void warm.warm.then((w) => w.close()).catch(() => {});
  }

  private async spawn(config: Omit<HostConfig, 'env' | 'claudePath' | 'canUseTool'>, warm?: Warm): Promise<SessionHost> {
    const [env, claudePath, sdk] = await Promise.all([this.deps.env(), this.deps.claudePath(), this.deps.sdk()]);
    // The session id can change (forks), so permission prompts look it up through the host.
    let hostRef: SessionHost | undefined;
    const canUseTool: CanUseTool = (toolName, input, options) => this.ask(hostRef!.sessionId, toolName, input, options);
    const startQuery: StartQuery = warm
      ? async ({ prompt }) => {
          warm.route.canUseTool = canUseTool;
          return (await warm.warm).query(prompt);
        }
      : (args) => sdk.query(args);
    const host = new SessionHost(
      { ...config, env, claudePath, canUseTool },
      {
        info: (info) => this.onInfo(host, info),
        stream: (delta) => this.deps.onStream(delta),
        messages: (id, messages) => this.deps.onMessages(id, messages),
        log: this.deps.log,
        usageHint: () => this.deps.onUsageHint?.(),
      },
      startQuery,
    );
    hostRef = host;
    this.hosts.set(config.sessionId, host);
    host.start();
    return host;
  }

  private onInfo(host: SessionHost, info: SessionHostInfo): void {
    // Re-key when Claude Code reports a different id (forks get a new one at startup).
    for (const [key, value] of this.hosts) {
      if (value === host && key !== info.sessionId) {
        this.hosts.delete(key);
        this.hosts.set(info.sessionId, host);
      }
    }
    if (host.commands.length) {
      this.commandsByCwd.set(info.cwd, host.commands);
      this.deps.commandCache?.set(info.cwd, host.commands);
    }
    if (host.models.length) this.models = host.models;
    this.deps.onInfo(info);
  }

  private ask(sessionId: string, toolName: string, input: Record<string, unknown>, options: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const requestId = randomUUID();
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
      const request: PermissionRequest = {
        requestId,
        sessionId,
        toolName,
        toolUseId: str(options.toolUseID),
        input: clipJson(input, 20_000).value,
        title: str((options as { title?: unknown }).title),
        description: str((options as { description?: unknown }).description),
        decisionReason: str(options.decisionReason),
        blockedPath: str(options.blockedPath),
        alwaysLabel: describeSuggestions(options.suggestions),
        agentId: str(options.agentID),
        createdAt: Date.now(),
      };
      this.pending.set(requestId, { request, input, suggestions: options.suggestions, resolve });
      options.signal.addEventListener('abort', () => this.settle(requestId, { behavior: 'deny', message: 'Cancelled.' }), { once: true });
      this.deps.onPermission(request);
    });
  }

  private settle(requestId: string, result: PermissionResult): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.resolve(result);
    this.deps.onPermissionResolved(requestId, pending.request.sessionId);
  }

  private reapIdle(): void {
    const limit = this.deps.idleTimeoutMs ?? 30 * 60_000;
    for (const host of this.hosts.values()) {
      if (host.active && host.info.state === 'idle' && Date.now() - host.lastActivity > limit) {
        this.deps.log('info', `Closing idle session ${host.sessionId}`);
        this.closedAt.set(host.sessionId, Date.now());
        host.close();
      }
    }
  }
}
