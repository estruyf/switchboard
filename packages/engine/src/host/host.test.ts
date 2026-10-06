import type { Options, PermissionResult, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { PermissionRequest, SessionHostInfo, StreamDelta } from '@switchboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { HostManager, type SdkRuntime } from './hostManager.ts';
import { describeSuggestions } from './permissions.ts';
import { buildOptions, type HostConfig } from './sessionHost.ts';

/** Minimal async channel that can also fail, like a Claude Code process dying. */
class Channel<T> implements AsyncIterable<T> {
  private items: Array<{ value: T } | { error: Error }> = [];
  private wake: (() => void) | undefined;
  private done = false;
  push(value: T) {
    this.items.push({ value });
    this.wake?.();
  }
  fail(error: Error) {
    this.items.push({ error });
    this.wake?.();
  }
  end() {
    this.done = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.items.length) {
        const item = this.items.shift()!;
        if ('error' in item) throw item.error;
        yield item.value;
      }
      if (this.done) return;
      await new Promise<void>((r) => (this.wake = r));
    }
  }
}

const SUGGESTION = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] as const;

/** Scripted stand-in for a Claude Code process. Prompts starting with `bash:` ask for permission; `crash` kills it. */
class FakeQuery {
  readonly out = new Channel<unknown>();
  interrupts = 0;
  closed = false;
  mode: string;
  model = 'fake-model';
  constructor(
    readonly prompt: AsyncIterable<SDKUserMessage>,
    readonly options: Options,
  ) {
    this.mode = options.permissionMode ?? 'default';
    void this.run();
  }
  [Symbol.asyncIterator]() {
    return this.out[Symbol.asyncIterator]();
  }
  private async run() {
    const sessionId = this.options.forkSession ? 'forked-session' : (this.options.sessionId ?? this.options.resume)!;
    const state = (s: string) => this.out.push({ type: 'system', subtype: 'session_state_changed', state: s, session_id: sessionId });
    const assistant = (text: string) =>
      this.out.push({ type: 'assistant', uuid: `a-${text}`, parent_tool_use_id: null, session_id: sessionId, message: { model: 'fake', content: [{ type: 'text', text }] } });
    for await (const message of this.prompt) {
      const text = (message.message.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
      this.out.push({ type: 'system', subtype: 'init', session_id: sessionId, cwd: this.options.cwd, model: this.model, permissionMode: this.mode });
      state('running');
      if (text === 'crash') {
        this.out.fail(new Error('Claude Code process exited with code 1'));
        return;
      }
      if (text.startsWith('bash:')) {
        state('requires_action');
        const result = (await this.options.canUseTool!('Bash', { command: text.slice(5) }, {
          signal: new AbortController().signal,
          suggestions: [...SUGGESTION] as never,
          toolUseID: 'tool-1',
        } as never)) as PermissionResult;
        state('running');
        assistant(`${result.behavior}${'updatedPermissions' in result && result.updatedPermissions ? '+always' : ''}`);
      } else {
        this.out.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', content_block: { type: 'text' } } });
        for (const chunk of ['Hel', 'lo']) {
          this.out.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } } });
        }
        assistant('Hello');
      }
      this.out.push({ type: 'result', subtype: 'success', total_cost_usd: 0.01, session_id: sessionId });
      state('idle');
    }
  }
  async interrupt() {
    this.interrupts++;
  }
  async setPermissionMode(mode: string) {
    this.mode = mode;
  }
  async setModel(model?: string) {
    this.model = model ?? 'default';
  }
  async supportedCommands() {
    return [
      { name: 'review', description: 'Review the diff', argumentHint: '' },
      { name: 'doctor', description: 'Terminal only', argumentHint: '' },
    ];
  }
  async supportedModels() {
    return [{ value: 'fake', displayName: 'Fake', description: 'Test model', supportsEffort: false }];
  }
  async getContextUsage() {
    return { percentage: 12.4 };
  }
  close() {
    this.closed = true;
    this.out.end();
  }
}

const until = async (check: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

function setup(opts: { openElsewhere?: string[]; cwds?: Record<string, string>; profiles?: Record<string, string> } = {}) {
  const queries: FakeQuery[] = [];
  const infos: SessionHostInfo[] = [];
  const streams: StreamDelta[] = [];
  const messages: Array<{ id: string; messages: RawSessionMessage[] }> = [];
  const permissions: PermissionRequest[] = [];
  const resolved: string[] = [];
  const created: string[] = [];
  const sdk: SdkRuntime = {
    query: ({ prompt, options }) => {
      const q = new FakeQuery(prompt, options);
      queries.push(q);
      return q as never;
    },
    startup: async ({ options }) =>
      ({
        query: (prompt: AsyncIterable<SDKUserMessage>) => {
          const q = new FakeQuery(prompt, options);
          queries.push(q);
          return q;
        },
        close() {},
      }) as never,
  };
  const manager = new HostManager({
    sdk: async () => sdk,
    // Each profile's processes get its config folder.
    env: async (profileId) => ({ PATH: '/usr/bin', ...(profileId === 'default' ? {} : { CLAUDE_CONFIG_DIR: `/config/${profileId}` }) }),
    claudePath: async () => '/usr/local/bin/claude',
    isOpenElsewhere: (id) => (opts.openElsewhere ?? []).includes(id),
    sessionCwd: (id) => opts.cwds?.[id] ?? null,
    sessionProfile: (id) => opts.profiles?.[id] ?? 'default',
    onInfo: (i) => infos.push(i),
    onStream: (d) => streams.push(d),
    onMessages: (id, m) => messages.push({ id, messages: m }),
    onPermission: (r) => permissions.push(r),
    onPermissionResolved: (id) => resolved.push(id),
    onCreated: (id) => created.push(id),
    log: () => {},
  });
  return { manager, queries, infos, streams, messages, permissions, resolved, created };
}

const base = { attachments: [], model: null, permissionMode: 'default' as const, effort: null, worktree: null, profileId: 'default' };
const lastState = (infos: SessionHostInfo[], id: string) => infos.filter((i) => i.sessionId === id).at(-1)?.state;

describe('HostManager', () => {
  it('creates a session, shows the prompt at once and streams the reply', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi' });
    expect(t.created).toEqual([id]);
    // The optimistic prompt is pushed before Claude Code answers.
    expect(t.messages[0]).toMatchObject({ id, messages: [{ type: 'user' }] });
    await until(() => lastState(t.infos, id) === 'idle' && t.infos.at(-1)!.contextPercent !== null);
    expect(t.queries[0]!.options).toMatchObject({ sessionId: id, cwd: '/work/app', includePartialMessages: true, enableFileCheckpointing: true });
    expect(t.streams.filter((s) => s.kind === 'text').map((s) => s.text).join('')).toBe('Hello');
    expect(t.messages.flatMap((m) => m.messages.map((x) => x.uuid))).toContain('a-Hello');
    expect(t.infos.at(-1)).toMatchObject({ model: 'fake-model', costUsd: 0.01, contextPercent: 12 });
    await expect(t.manager.commands(id, undefined, 'default')).resolves.toEqual([{ name: 'review', description: 'Review the diff', argumentHint: '' }]);
    t.manager.closeAll();
  });

  it('brokers permission prompts and applies "always allow"', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:npm test' });
    await until(() => t.permissions.length === 1);
    const request = t.permissions[0]!;
    expect(request).toMatchObject({ sessionId: id, toolName: 'Bash', toolUseId: 'tool-1', input: { command: 'npm test' } });
    expect(request.alwaysLabel).toBe('Allow Bash(npm test:*) in this project (just you)');
    expect(t.manager.list().permissions).toHaveLength(1);
    t.manager.respond(request.requestId, { behavior: 'allow', always: true });
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-allow+always')));
    expect(t.resolved).toEqual([request.requestId]);
    expect(() => t.manager.respond(request.requestId, { behavior: 'deny' })).toThrow(/already answered/);
    t.manager.closeAll();
  });

  it('denies pending prompts when interrupted', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'bash:rm -rf build' });
    await until(() => t.permissions.length === 1);
    await t.manager.interrupt(id);
    await until(() => t.messages.some((m) => m.messages.some((x) => x.uuid === 'a-deny')));
    expect(t.queries[0]!.interrupts).toBe(1);
    t.manager.closeAll();
  });

  it('refuses to resume a session open elsewhere, but can fork it', async () => {
    const t = setup({ openElsewhere: ['busy'], cwds: { busy: '/repo' } });
    await expect(t.manager.send({ sessionId: 'busy', text: 'hi', attachments: [], fork: false })).rejects.toMatchObject({ code: 'SESSION_BUSY_ELSEWHERE' });
    const forked = await t.manager.send({ sessionId: 'busy', text: 'hi', attachments: [], fork: true });
    expect(forked.sessionId).toBe('forked-session');
    expect(t.queries[0]!.options).toMatchObject({ resume: 'busy', forkSession: true, cwd: '/repo' });
    expect(t.created).toEqual(['forked-session']);
    expect(t.manager.has('forked-session')).toBe(true);
    t.manager.closeAll();
  });

  it('resumes in the folder the session ran in', async () => {
    const t = setup({ cwds: { old: '/projects/site' } });
    await t.manager.send({ sessionId: 'old', text: 'continue', attachments: [], fork: false });
    expect(t.queries[0]!.options).toMatchObject({ resume: 'old', cwd: '/projects/site' });
    await expect(t.manager.send({ sessionId: 'unknown', text: 'x', attachments: [], fork: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    t.manager.closeAll();
  });

  it('isolates a crashing Claude Code process to its own session', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'crash' });
    await until(() => lastState(t.infos, id) === 'error');
    expect(t.infos.at(-1)!.error).toMatch(/exited with code 1/);
    await expect(t.manager.interrupt(id)).rejects.toMatchObject({ code: 'NOT_RUNNING' });
    // A second session still works.
    const other = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, other) === 'idle');
    t.manager.closeAll();
  });

  it('adopts a pre-warmed process for a new session in the same folder', async () => {
    const t = setup();
    await t.manager.prewarm('/work/app', 'default');
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'Say hi', permissionMode: 'plan' });
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.mode).toBe('plan');
    t.manager.closeAll();
  });

  it('holds the first message until setup has finished', async () => {
    const t = setup();
    let finishSetup!: () => void;
    const setupDone = new Promise<void>((resolve) => (finishSetup = resolve));
    const seen: string[] = [];
    const id = await t.manager.create({
      ...base,
      cwd: '/w',
      prompt: 'hello',
      beforeFirstMessage: async (sessionId) => {
        seen.push(sessionId);
        await setupDone;
      },
    });
    expect(seen).toEqual([id]);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.messages).toEqual([]);
    finishSetup();
    await until(() => lastState(t.infos, id) === 'idle');
    expect(t.messages[0]).toMatchObject({ id, messages: [{ type: 'user' }] });
    t.manager.closeAll();
  });

  it('lists commands for a folder without starting a session, once', async () => {
    const t = setup();
    const first = await t.manager.commands(undefined, '/projects/web', 'default');
    expect(first.map((c) => c.name)).toEqual(['review']);
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.closed).toBe(true);
    await t.manager.commands(undefined, '/projects/web', 'default');
    expect(t.queries).toHaveLength(1);
    // Another profile has its own user commands, skills and plugins.
    await t.manager.commands(undefined, '/projects/web', 'work');
    expect(t.queries).toHaveLength(2);
    expect(t.queries[1]!.options.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/config/work' });
    t.manager.closeAll();
  });

  it('runs each session with its profile, and resumes with the profile it was created with', async () => {
    const t = setup({ cwds: { old: '/work/app' }, profiles: { old: 'work' } });
    await t.manager.prewarm('/work/app', 'default');
    const id = await t.manager.create({ ...base, cwd: '/work/app', prompt: 'hi', profileId: 'work' });
    await until(() => lastState(t.infos, id) === 'idle');
    // The process pre-warmed for the default profile is not adopted by a session of another one.
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.options.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/config/work' });
    expect(t.infos.at(-1)).toMatchObject({ sessionId: id, profileId: 'work' });

    await t.manager.send({ sessionId: 'old', text: 'continue', attachments: [], fork: false });
    await until(() => t.queries.length === 2);
    expect(t.queries[1]!.options).toMatchObject({ resume: 'old', env: { CLAUDE_CONFIG_DIR: '/config/work' } });
    t.manager.closeAll();
  });

  it('closes a session on request', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    t.manager.close(id);
    expect(lastState(t.infos, id)).toBe('closed');
    await until(() => t.queries[0]!.closed);
  });

  it('resumes a stopped session in the permission mode it last had', async () => {
    const t = setup({ cwds: { old: '/w' } });
    await t.manager.send({ sessionId: 'old', text: 'hello', attachments: [], fork: false });
    await until(() => lastState(t.infos, 'old') === 'idle');
    expect(t.queries[0]!.options.permissionMode).toBe('default');
    await t.manager.setPermissionMode('old', 'auto');
    t.manager.close('old');

    await t.manager.send({ sessionId: 'old', text: 'again', attachments: [], fork: false });
    await until(() => t.queries.length === 2);
    expect(t.queries[1]!.options.permissionMode).toBe('auto');
    t.manager.closeAll();
  });

  it('follows mode changes Claude Code reports on its own', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    t.queries[0]!.out.push({ type: 'system', subtype: 'status', status: null, permissionMode: 'acceptEdits', session_id: id });
    await until(() => t.infos.at(-1)?.permissionMode === 'acceptEdits');
    t.manager.closeAll();
  });

  it('tracks background tasks and keeps their session open while they run', async () => {
    const t = setup();
    const id = await t.manager.create({ ...base, cwd: '/w', prompt: 'hello' });
    await until(() => lastState(t.infos, id) === 'idle');
    const tasks = (list: unknown[]) => t.queries[0]!.out.push({ type: 'system', subtype: 'background_tasks_changed', tasks: list, session_id: id });
    tasks([
      { task_id: 'b1', task_type: 'local_bash', description: 'npm run test:links' },
      { task_id: 'w1', task_type: 'monitor', description: 'Watching files', ambient: true },
    ]);
    await until(() => t.infos.at(-1)!.backgroundTasks.length > 0);
    expect(t.infos.at(-1)).toMatchObject({ state: 'idle', backgroundTasks: [{ taskId: 'b1', type: 'local_bash', description: 'npm run test:links' }] });

    // Long idle, but a task is still running: the reaper leaves it alone.
    t.manager.reapIdle(Date.now() + 2 * 60 * 60_000);
    expect(lastState(t.infos, id)).toBe('idle');

    tasks([]);
    await until(() => t.infos.at(-1)!.backgroundTasks.length === 0);
    t.manager.reapIdle(Date.now() + 2 * 60 * 60_000);
    expect(lastState(t.infos, id)).toBe('closed');
    t.manager.closeAll();
  });
});

describe('buildOptions', () => {
  const config: HostConfig = {
    sessionId: 's1',
    cwd: '/repo',
    profileId: 'default',
    mode: 'new',
    model: 'opus',
    permissionMode: 'acceptEdits',
    effort: 'high',
    worktree: { name: 'fix-login', baseRef: 'head' },
    env: { PATH: '/bin' },
    claudePath: '/bin/claude',
    canUseTool: async () => ({ behavior: 'deny', message: '' }),
  };
  it('maps a new worktree session onto Claude Code options', () => {
    const options = buildOptions(config, () => {});
    expect(options).toMatchObject({
      cwd: '/repo',
      sessionId: 's1',
      model: 'opus',
      effort: 'high',
      permissionMode: 'acceptEdits',
      extraArgs: { worktree: 'fix-login' },
      settings: { worktree: { baseRef: 'head' } },
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      pathToClaudeCodeExecutable: '/bin/claude',
    });
    expect(options.env).toEqual({ PATH: '/bin', CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' });
    expect(options.resume).toBeUndefined();
  });
  it('resumes or forks instead of assigning an id', () => {
    expect(buildOptions({ ...config, mode: 'resume', worktree: null }, () => {})).toMatchObject({ resume: 's1' });
    const fork = buildOptions({ ...config, mode: 'fork', worktree: null, model: null, effort: null }, () => {});
    expect(fork).toMatchObject({ resume: 's1', forkSession: true });
    expect(fork.sessionId).toBeUndefined();
    expect(fork.model).toBeUndefined();
  });
});

describe('describeSuggestions', () => {
  it('says what always-allow changes', () => {
    expect(describeSuggestions(undefined)).toBeNull();
    expect(describeSuggestions([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])).toBe('Switch to Accept edits for this session');
    expect(describeSuggestions([{ type: 'addRules', rules: [{ toolName: 'WebFetch' }], behavior: 'allow', destination: 'userSettings' }])).toBe('Allow WebFetch everywhere');
  });
});
