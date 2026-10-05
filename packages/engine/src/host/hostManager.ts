import { randomUUID } from 'node:crypto';
import type { CanUseTool, Options, PermissionResult, PermissionUpdate, Query, SDKUserMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import {
  RpcError,
  type Effort,
  type ImageAttachment,
  type LogLevel,
  type ModelOption,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type SessionHostInfo,
  type SlashCommand,
  type StreamDelta,
  type WorktreeRequest,
} from '@switchboard/protocol';
import { clipJson } from '../claude/transcript.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { describeSuggestions } from './permissions.ts';
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
}

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
    host.send(params.prompt, params.attachments);
    return sessionId;
  }

  async send(params: { sessionId: string; text: string; attachments: ImageAttachment[]; fork: boolean }): Promise<{ sessionId: string; messageUuid: string }> {
    let host = params.fork ? undefined : this.hosts.get(params.sessionId);
    if (!host?.active) {
      if (!params.fork && this.deps.isOpenElsewhere(params.sessionId) && this.recentlyClosed(params.sessionId)) {
        await this.waitForExit(params.sessionId);
      }
      if (!params.fork && this.deps.isOpenElsewhere(params.sessionId)) {
        throw new RpcError('SESSION_BUSY_ELSEWHERE', 'This session is open in another Claude Code window. Fork it to continue here.');
      }
      const cwd = this.deps.sessionCwd(params.sessionId);
      if (!cwd) throw new RpcError('NOT_FOUND', 'Unknown session, or its folder is not recorded');
      host = await this.spawn({
        sessionId: params.sessionId,
        cwd,
        mode: params.fork ? 'fork' : 'resume',
        model: null,
        permissionMode: 'default',
        effort: null,
        worktree: null,
      });
    }
    const messageUuid = host.send(params.text, params.attachments);
    // A fork only learns its new id once Claude Code has started.
    const sessionId = params.fork ? await host.initialized : host.sessionId;
    if (params.fork) this.deps.onCreated(sessionId);
    return { sessionId, messageUuid };
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

  commands(sessionId: string | undefined, cwd: string | undefined): SlashCommand[] {
    const host = sessionId ? this.hosts.get(sessionId) : undefined;
    if (host?.commands.length) return host.commands;
    const folder = host?.info.cwd ?? cwd;
    return (folder && this.commandsByCwd.get(folder)) || [...this.commandsByCwd.values()][0] || [];
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
    if (host.commands.length) this.commandsByCwd.set(info.cwd, host.commands);
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
