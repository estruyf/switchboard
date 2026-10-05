import { randomUUID } from 'node:crypto';
import type { CanUseTool, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  Effort,
  HostState,
  ImageAttachment,
  LogLevel,
  ModelOption,
  PermissionMode,
  Capabilities,
  PluginInfo,
  RewindResult,
  ContextUsage,
  SessionHostInfo,
  SlashCommand,
  StreamDelta,
  WorktreeRequest,
} from '@switchboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { pluginsFromInit, readCapabilities } from './capabilities.ts';
import { InputQueue } from './inputQueue.ts';

/** Starts the Claude Code process for a host. Real hosts use the SDK's `query()` (or a pre-warmed one). */
export type StartQuery = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query | Promise<Query>;

export interface HostEvents {
  info(info: SessionHostInfo): void;
  stream(delta: StreamDelta): void;
  /** Complete messages as they happen, for the live transcript (same uuids as the file). */
  messages(sessionId: string, messages: RawSessionMessage[]): void;
  log(level: LogLevel, message: string): void;
  /** Plan usage probably changed (a turn finished, or Claude Code reported a rate-limit update). */
  usageHint?(): void;
}

export interface HostConfig {
  /** For new sessions the id we assign; for resume/fork the id being resumed until init reports the real one. */
  sessionId: string;
  cwd: string;
  mode: 'new' | 'resume' | 'fork';
  model: string | null;
  permissionMode: PermissionMode;
  effort: Effort | null;
  worktree: WorktreeRequest | null;
  env: Record<string, string>;
  claudePath: string | undefined;
  canUseTool: CanUseTool;
}

const STATE_FROM_SDK: Record<string, HostState> = { running: 'running', requires_action: 'needs-you', idle: 'idle' };
const STREAM_FLUSH_MS = 30;

export function buildOptions(config: HostConfig, log: HostEvents['log']): Options {
  const options: Options = {
    cwd: config.cwd,
    // Session state events drive the status dot; they are opt-in.
    env: { ...config.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' },
    pathToClaudeCodeExecutable: config.claudePath,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    enableFileCheckpointing: true,
    permissionMode: config.permissionMode,
    canUseTool: config.canUseTool,
    stderr: (data) => log('debug', `[claude] ${data.trimEnd()}`),
  };
  if (config.model) options.model = config.model;
  if (config.effort) options.effort = config.effort;
  if (config.mode === 'new') options.sessionId = config.sessionId;
  else {
    options.resume = config.sessionId;
    if (config.mode === 'fork') options.forkSession = true;
  }
  if (config.worktree) {
    // Claude Code creates the worktree itself (same place and naming as `claude --worktree`).
    options.extraArgs = { worktree: config.worktree.name };
    if (config.worktree.baseRef === 'head') options.settings = { worktree: { baseRef: 'head' } };
  }
  return options;
}

function toRaw(message: Extract<SDKMessage, { type: 'assistant' | 'user' }>): RawSessionMessage {
  return {
    type: message.type,
    uuid: message.uuid ?? randomUUID(),
    message: message.message,
    parent_tool_use_id: message.parent_tool_use_id ?? null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * One Claude Code process driven through the SDK in streaming-input mode.
 * Never throws out of its message loop: failures become the `error` state,
 * because one broken session must not take the engine (and every other session) down.
 */
export class SessionHost {
  private readonly input = new InputQueue<SDKUserMessage>();
  private query: Promise<Query | undefined> = Promise.resolve(undefined);
  private closing = false;
  private initResolve!: (sessionId: string) => void;
  private initReject!: (error: Error) => void;
  /** Resolves with the real session id once Claude Code has started (matters for forks). */
  readonly initialized: Promise<string>;
  private streamBuffer: StreamDelta | null = null;
  private streamTimer: ReturnType<typeof setTimeout> | undefined;
  commands: SlashCommand[] = [];
  /** Plugins from Claude Code's startup message (null until it has started a turn). */
  plugins: PluginInfo[] | null = null;
  /** Commands that only work in the terminal UI (reported by Claude Code at init). */
  terminalOnly: string[] = [];
  models: ModelOption[] = [];
  lastActivity = Date.now();
  /** When the process ended (closed or crashed), for telling our own exiting process apart from another window. */
  closedAt: number | undefined;
  info: SessionHostInfo;

  constructor(
    private readonly config: HostConfig,
    private readonly events: HostEvents,
    private readonly startQuery: StartQuery,
  ) {
    this.info = {
      sessionId: config.sessionId,
      cwd: config.cwd,
      state: 'starting',
      model: config.model,
      permissionMode: config.permissionMode,
      effort: config.effort,
      costUsd: 0,
      contextPercent: null,
      contextTokens: null,
      contextMax: null,
      error: null,
      startedAt: Date.now(),
      queued: 0,
    };
    this.initialized = new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
    // Nobody may be awaiting it; a rejection here must not become an unhandled rejection.
    this.initialized.catch(() => {});
  }

  get sessionId(): string {
    return this.info.sessionId;
  }

  get active(): boolean {
    return this.info.state !== 'closed' && this.info.state !== 'error';
  }

  start(): void {
    this.query = (async () => this.startQuery({ prompt: this.input, options: buildOptions(this.config, this.events.log) }))().then(
      (query) => {
        void this.loop(query);
        return query;
      },
      (error: unknown) => {
        this.fail(error);
        return undefined;
      },
    );
    this.events.info(this.info);
  }

  /** Queues a user message. It shows up in the transcript immediately, with the uuid Claude Code will store. */
  send(text: string, attachments: readonly ImageAttachment[] = []): string {
    if (!this.active) throw new Error('This session is not running');
    const uuid = randomUUID();
    const content = [
      ...attachments.map((a) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: a.mediaType, data: a.data } })),
      ...(text ? [{ type: 'text' as const, text }] : []),
    ];
    const message: SDKUserMessage = { type: 'user', uuid, parent_tool_use_id: null, message: { role: 'user', content } };
    this.input.push(message);
    this.lastActivity = Date.now();
    this.events.messages(this.sessionId, [
      { type: 'user', uuid, message: message.message, parent_tool_use_id: null, timestamp: new Date().toISOString() },
    ]);
    if (this.info.state === 'running' || this.info.state === 'needs-you') this.update({ queued: this.info.queued + 1 });
    return uuid;
  }

  async capabilities(fallbackPlugins: () => PluginInfo[]): Promise<Capabilities> {
    const query = await this.query;
    if (!query) throw new Error('This session is not running');
    return readCapabilities(query, this.plugins ?? fallbackPlugins(), true);
  }

  async mcp(server: string, action: 'enable' | 'disable' | 'reconnect'): Promise<void> {
    const query = await this.query;
    if (!query) throw new Error('This session is not running');
    if (action === 'reconnect') await query.reconnectMcpServer(server);
    else await query.toggleMcpServer(server, action === 'enable');
  }

  /** Restores the files Claude changed to how they were before `userMessageId` (Claude Code's own checkpoints). */
  async rewindFiles(userMessageId: string, dryRun: boolean): Promise<RewindResult> {
    const query = await this.query;
    if (!query) throw new Error('This session is not running');
    const result = await query.rewindFiles(userMessageId, { dryRun });
    return {
      canRewind: result.canRewind,
      error: result.error ?? null,
      files: result.filesChanged ?? [],
      insertions: result.insertions ?? 0,
      deletions: result.deletions ?? 0,
    };
  }

  async interrupt(): Promise<void> {
    await (await this.query)?.interrupt();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await (await this.query)?.setPermissionMode(mode);
    this.update({ permissionMode: mode });
  }

  async setEffort(effort: Effort | null): Promise<void> {
    await (await this.query)?.applyFlagSettings({ effortLevel: effort });
    this.update({ effort });
  }

  async contextUsage(): Promise<ContextUsage> {
    const query = await this.query;
    if (!query) throw new Error('This session is not running');
    const usage = await query.getContextUsage({ detail: 'summary' });
    return {
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      model: usage.model,
      categories: usage.categories.map((c) => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
    };
  }

  async setModel(model: string | null): Promise<void> {
    await (await this.query)?.setModel(model ?? undefined);
    this.update({ model });
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    void this.query.then((query) => {
      try {
        query?.close();
      } catch (error) {
        this.events.log('warn', `Closing session ${this.sessionId} failed: ${(error as Error).message}`);
      }
    });
    this.flushStream();
    this.update({ state: 'closed' });
  }

  private update(patch: Partial<SessionHostInfo>): void {
    if ((patch.state === 'closed' || patch.state === 'error') && this.closedAt === undefined) this.closedAt = Date.now();
    this.info = { ...this.info, ...patch };
    this.events.info(this.info);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.events.log('error', `Session ${this.sessionId} failed: ${message}`);
    this.initReject(new Error(message));
    this.update({ state: 'error', error: message });
  }

  private async loop(query: Query): Promise<void> {
    try {
      for await (const message of query) {
        try {
          this.handle(message);
        } catch (error) {
          this.events.log('warn', `Could not handle ${message.type} message: ${(error as Error).message}`);
        }
      }
      if (!this.closing) this.update({ state: 'closed' });
    } catch (error) {
      if (this.closing) return;
      this.fail(error);
    } finally {
      this.flushStream();
      this.initReject(new Error('Session ended before it started'));
    }
  }

  private handle(message: SDKMessage): void {
    this.lastActivity = Date.now();
    switch (message.type) {
      case 'system':
        return this.handleSystem(message);
      case 'stream_event':
        if (message.parent_tool_use_id === null) this.handleStreamEvent(message.event as { type: string; [key: string]: unknown });
        return;
      // Subagent messages live in their own transcript file (shown inside the Task card),
      // so only the main conversation is pushed live.
      case 'assistant':
        if (message.parent_tool_use_id !== null) return;
        this.events.messages(this.sessionId, [toRaw(message)]);
        this.pushStream('clear', '');
        return;
      case 'user':
        if (message.parent_tool_use_id !== null || ('isReplay' in message && message.isReplay)) return;
        this.events.messages(this.sessionId, [toRaw(message)]);
        return;
      case 'result':
        this.update({ costUsd: message.total_cost_usd ?? this.info.costUsd });
        void this.refreshContext();
        this.events.usageHint?.();
        return;
      case 'rate_limit_event':
        this.events.usageHint?.();
        return;
      default:
        return;
    }
  }

  private handleSystem(message: Extract<SDKMessage, { type: 'system' }>): void {
    if (message.subtype === 'init') {
      const init = message as Extract<SDKMessage, { subtype: 'init' }>;
      const first = this.info.state === 'starting';
      this.update({
        sessionId: init.session_id,
        cwd: init.cwd,
        model: init.model,
        permissionMode: init.permissionMode as PermissionMode,
        state: first ? 'idle' : this.info.state,
      });
      const terminalOnly = (init as { terminal_slash_commands?: unknown }).terminal_slash_commands;
      if (Array.isArray(terminalOnly)) this.terminalOnly = terminalOnly.filter((c): c is string => typeof c === 'string');
      this.plugins = pluginsFromInit((init as { plugins?: unknown }).plugins);
      this.initResolve(init.session_id);
      if (first) {
        void this.loadCatalogs();
        void this.refreshContext();
      }
      return;
    }
    if (message.subtype === 'session_state_changed') {
      const state = STATE_FROM_SDK[(message as { state: string }).state];
      if (!state || this.closing) return;
      this.update(state === 'idle' ? { state, queued: 0 } : { state });
      if (state === 'idle') this.pushStream('clear', '');
    }
  }

  private handleStreamEvent(event: { type: string; [key: string]: unknown }): void {
    if (event.type === 'content_block_start') {
      const block = event.content_block as { type?: string; name?: string } | undefined;
      if (block?.type === 'tool_use' || block?.type === 'server_tool_use') this.pushStream('tool', block.name ?? 'tool');
      else this.pushStream('clear', '');
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta as { type?: string; text?: string; thinking?: string } | undefined;
      if (delta?.type === 'text_delta' && delta.text) this.pushStream('text', delta.text);
      else if (delta?.type === 'thinking_delta' && delta.thinking) this.pushStream('thinking', delta.thinking);
    }
  }

  /** Coalesces token deltas so the UI gets ~30 updates a second instead of one per token. */
  private pushStream(kind: StreamDelta['kind'], text: string): void {
    const buffered = this.streamBuffer;
    if (buffered && buffered.kind === kind && (kind === 'text' || kind === 'thinking')) {
      buffered.text += text;
      return;
    }
    this.flushStream();
    this.streamBuffer = { sessionId: this.sessionId, kind, text };
    if (kind === 'clear' || kind === 'tool') this.flushStream();
    else this.streamTimer = setTimeout(() => this.flushStream(), STREAM_FLUSH_MS);
  }

  private flushStream(): void {
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.streamTimer = undefined;
    const buffered = this.streamBuffer;
    this.streamBuffer = null;
    if (buffered) this.events.stream(buffered);
  }

  private async loadCatalogs(): Promise<void> {
    try {
      const query = await this.query;
      if (!query) return;
      const [commands, models] = await Promise.all([query.supportedCommands(), query.supportedModels()]);
      this.commands = commands.map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint }));
      this.models = models.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
        supportsEffort: m.supportsEffort ?? false,
      }));
    } catch (error) {
      this.events.log('debug', `Loading commands/models failed: ${(error as Error).message}`);
    }
  }

  private async refreshContext(): Promise<void> {
    try {
      // `summary` answers from the last response and local estimates, without extra API calls.
      const usage = await (await this.query)?.getContextUsage({ detail: 'summary' });
      if (usage) this.update({ contextPercent: Math.round(usage.percentage), contextTokens: usage.totalTokens, contextMax: usage.maxTokens });
    } catch {
      // Context usage is informational only.
    }
  }
}
