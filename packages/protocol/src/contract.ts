import { z } from 'zod';
import type { ContractShape } from './rpc.ts';
import {
  EditorInfo,
  Effort,
  ImageAttachment,
  ModelOption,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  ProjectInspection,
  SessionHostInfo,
  SlashCommand,
  StreamDelta,
  WorktreeRequest,
} from './host.ts';
import {
  LiveSession,
  ProjectIconChoice,
  ProjectInfo,
  SessionsChanged,
  SessionsSnapshot,
  TranscriptMessage,
  TranscriptUpdate,
} from './sessions.ts';

export const ClaudeInstall = z.object({
  path: z.string(),
  /** Semver from `claude --version`, or null when the binary exists but the version could not be read. */
  version: z.string().nullable(),
});
export type ClaudeInstall = z.infer<typeof ClaudeInstall>;

export const SystemInfo = z.object({
  engineVersion: z.string(),
  startedAt: z.number(),
  versions: z.object({
    node: z.string(),
    electron: z.string().nullable(),
    sqlite: z.string(),
  }),
  paths: z.object({
    dataDir: z.string(),
    database: z.string(),
    claudeConfigDir: z.string(),
  }),
  shell: z.object({
    path: z.string(),
    /** False when the login-shell environment could not be read and process.env was used instead. */
    resolved: z.boolean(),
    /** True when the environment came from the cache of a previous launch (refreshed in the background). */
    cached: z.boolean(),
    durationMs: z.number(),
  }),
  /** Null when no `claude` binary was found. */
  claude: ClaudeInstall.nullable(),
});
export type SystemInfo = z.infer<typeof SystemInfo>;

export const LogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevel>;

export const LogEntry = z.object({
  level: LogLevel,
  message: z.string(),
  at: z.number(),
});
export type LogEntry = z.infer<typeof LogEntry>;

const AppStateKey = z.string().min(1).max(200);
const SessionId = z.string().min(1).max(200);
const AbsolutePath = z.string().min(1).max(4096).startsWith('/');
const Prompt = z.string().max(200_000);

/** Every request the UI can make and every event the engine can push. */
export const contract = {
  requests: {
    'system.info': {
      params: z.object({}),
      result: SystemInfo,
    },
    'system.ping': {
      params: z.object({ sentAt: z.number() }),
      result: z.object({ sentAt: z.number(), engineTime: z.number() }),
    },
    'appState.get': {
      params: z.object({ key: AppStateKey }),
      result: z.object({ value: z.json().nullable() }),
    },
    'appState.set': {
      params: z.object({ key: AppStateKey, value: z.json() }),
      result: z.object({}),
    },
    /** Sidebar data. Answers from the cache immediately; `sessions.changed` follows when the scan finishes. */
    'sessions.list': {
      params: z.object({}),
      result: SessionsSnapshot,
    },
    /** Pin a session, or settle it (moves it to "Settled" until it has new activity). */
    'sessions.setFlags': {
      params: z.object({ sessionId: SessionId, pinned: z.boolean().optional(), settled: z.boolean().optional() }),
      result: z.object({}),
    },
    /**
     * Moves a session's transcript (and its subagent transcripts) to the Trash.
     * Stops it first when it runs in this app; refuses (SESSION_BUSY_ELSEWHERE) when another window has it open.
     */
    'session.delete': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** The user is looking at this session now; clears its unread state. */
    'sessions.markViewed': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    'projects.list': { params: z.object({}), result: z.object({ projects: z.array(ProjectInfo) }) },
    'projects.add': { params: z.object({ path: AbsolutePath }), result: z.object({}) },
    'projects.remove': { params: z.object({ root: AbsolutePath }), result: z.object({}) },
    'projects.setIcon': { params: z.object({ root: AbsolutePath, icon: ProjectIconChoice }), result: z.object({}) },
    /** Forces a full rescan of ~/.claude/projects. */
    'sessions.refresh': {
      params: z.object({}),
      result: z.object({}),
    },
    'transcript.get': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ sessionId: z.string(), messages: z.array(TranscriptMessage) }),
    },
    /** Subscribes this window to `transcript.updated` for one session until unwatched or disconnected. */
    'transcript.watch': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({}),
    },
    'transcript.unwatch': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({}),
    },

    // --- Sessions run by this app ----------------------------------------------------------
    /** Running sessions and their open permission requests (for a window that just connected). */
    'hosts.list': {
      params: z.object({}),
      result: z.object({ hosts: z.array(SessionHostInfo), permissions: z.array(PermissionRequest) }),
    },
    /** Starts a new Claude Code session and sends the first message. */
    'session.create': {
      params: z.object({
        cwd: AbsolutePath,
        prompt: Prompt,
        attachments: z.array(ImageAttachment).max(20).default([]),
        model: z.string().max(200).nullable().default(null),
        permissionMode: PermissionMode.default('default'),
        effort: Effort.nullable().default(null),
        worktree: WorktreeRequest.nullable().default(null),
      }),
      result: z.object({ sessionId: z.string() }),
    },
    /**
     * Sends a message, resuming the session first when it isn't running in this app.
     * Fails with SESSION_BUSY_ELSEWHERE when another Claude Code process has it open, unless `fork` is set.
     */
    'session.send': {
      params: z.object({
        sessionId: SessionId,
        text: Prompt,
        attachments: z.array(ImageAttachment).max(20).default([]),
        fork: z.boolean().default(false),
      }),
      result: z.object({ sessionId: z.string(), messageUuid: z.string() }),
    },
    'session.interrupt': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    'session.setPermissionMode': { params: z.object({ sessionId: SessionId, mode: PermissionMode }), result: z.object({}) },
    'session.setModel': { params: z.object({ sessionId: SessionId, model: z.string().max(200).nullable() }), result: z.object({}) },
    /** Stops the Claude Code process behind a session (the transcript stays; sending resumes it). */
    'session.close': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    'session.respond': { params: z.object({ requestId: z.string(), decision: PermissionDecision }), result: z.object({}) },
    /** Slash commands, skills and plugin commands available to a session (or folder, for a new one). */
    'session.commands': {
      params: z.object({ sessionId: SessionId.optional(), cwd: AbsolutePath.optional() }),
      result: z.object({ commands: z.array(SlashCommand) }),
    },
    /** Starts a Claude Code process for a folder ahead of time so the first message answers faster. */
    'session.prewarm': { params: z.object({ cwd: AbsolutePath }), result: z.object({}) },
    'models.list': { params: z.object({}), result: z.object({ models: z.array(ModelOption) }) },

    // --- Folders, files and editors -----------------------------------------------------------
    'projects.inspect': { params: z.object({ path: AbsolutePath }), result: ProjectInspection },
    /** Fuzzy file search for @-mentions (git-tracked and untracked-but-not-ignored files). */
    'files.search': {
      params: z.object({ cwd: AbsolutePath, query: z.string().max(500), limit: z.number().int().min(1).max(200).default(50) }),
      result: z.object({ files: z.array(z.string()) }),
    },
    'editors.list': { params: z.object({}), result: z.object({ editors: z.array(EditorInfo), defaultId: z.string().nullable() }) },
    /** Opens a folder or file (optionally at a line) in an editor; `editorId` defaults to the user's default. */
    'editors.open': {
      params: z.object({ path: AbsolutePath, line: z.number().int().positive().optional(), editorId: z.string().optional() }),
      result: z.object({}),
    },
    'editors.setDefault': { params: z.object({ editorId: z.string() }), result: z.object({}) },
  },
  events: {
    'engine.log': LogEntry,
    'sessions.changed': SessionsChanged,
    /** Full replacement of the live-session list whenever the registry changes. */
    'sessions.live': z.object({ live: z.array(LiveSession) }),
    'transcript.updated': TranscriptUpdate,
    'session.host': SessionHostInfo,
    'session.stream': StreamDelta,
    'session.permission': PermissionRequest,
    'session.permissionResolved': z.object({ requestId: z.string(), sessionId: z.string() }),
  },
} as const satisfies ContractShape;

export type Contract = typeof contract;
