import { z } from 'zod';

/** Permission modes the UI can switch between (bypassPermissions is deliberately not offered). */
export const PermissionMode = z.enum(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']);
export type PermissionMode = z.infer<typeof PermissionMode>;

export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

/** State of a session this app is running (an active Claude Code process owned by the engine). */
export const HostState = z.enum(['starting', 'running', 'needs-you', 'idle', 'closed', 'error']);
export type HostState = z.infer<typeof HostState>;

export const SessionHostInfo = z.object({
  sessionId: z.string(),
  /** The session's working directory (the worktree path for worktree sessions, once known). */
  cwd: z.string(),
  state: HostState,
  model: z.string().nullable(),
  permissionMode: PermissionMode,
  effort: Effort.nullable(),
  /** Cost reported by Claude Code for this process so far. */
  costUsd: z.number(),
  contextPercent: z.number().nullable(),
  error: z.string().nullable(),
  startedAt: z.number(),
  /** User messages accepted but not answered yet (sent while Claude was busy). */
  queued: z.number(),
});
export type SessionHostInfo = z.infer<typeof SessionHostInfo>;

export const PermissionRequest = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
  toolUseId: z.string().nullable(),
  input: z.json(),
  /** Claude Code's own prompt text, e.g. "Claude wants to run npm test". */
  title: z.string().nullable(),
  description: z.string().nullable(),
  decisionReason: z.string().nullable(),
  blockedPath: z.string().nullable(),
  /** What "Always allow" would do, e.g. `Allow Bash(npm test:*) in this project`. Null when not offered. */
  alwaysLabel: z.string().nullable(),
  /** Set when a subagent asked. */
  agentId: z.string().nullable(),
  createdAt: z.number(),
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

export const PermissionDecision = z.discriminatedUnion('behavior', [
  z.object({
    behavior: z.literal('allow'),
    /** Apply Claude Code's suggested rule so it doesn't ask again. */
    always: z.boolean().default(false),
    /** Replaces the tool input, e.g. AskUserQuestion answers or an edited command. */
    updatedInput: z.record(z.string(), z.json()).optional(),
  }),
  z.object({
    behavior: z.literal('deny'),
    message: z.string().default('The user declined this action.'),
    /** Also stop the current turn. */
    interrupt: z.boolean().default(false),
  }),
]);
export type PermissionDecision = z.input<typeof PermissionDecision>;

/** Incremental output of the block Claude is writing right now (cleared when the block is complete). */
export const StreamDelta = z.object({
  sessionId: z.string(),
  kind: z.enum(['text', 'thinking', 'tool', 'clear']),
  /** Text to append for text/thinking; the tool name for `tool`. */
  text: z.string(),
});
export type StreamDelta = z.infer<typeof StreamDelta>;

export const ImageAttachment = z.object({
  type: z.literal('image'),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  /** Base64 without the data: prefix. ~7.5 MB of image max. */
  data: z.string().max(10_000_000),
  name: z.string().max(200).optional(),
});
export type ImageAttachment = z.infer<typeof ImageAttachment>;

export const SlashCommand = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
});
export type SlashCommand = z.infer<typeof SlashCommand>;

export const ModelOption = z.object({
  value: z.string(),
  displayName: z.string(),
  description: z.string(),
  supportsEffort: z.boolean(),
});
export type ModelOption = z.infer<typeof ModelOption>;

export const WorktreeRequest = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/, 'Use letters, digits, dot, dash or underscore'),
  /** `fresh` = from origin's default branch (Claude Code's default); `head` = from the current local HEAD. */
  baseRef: z.enum(['fresh', 'head']),
});
export type WorktreeRequest = z.infer<typeof WorktreeRequest>;

export const ProjectInspection = z.object({
  path: z.string(),
  exists: z.boolean(),
  isGitRepo: z.boolean(),
  root: z.string(),
  branch: z.string().nullable(),
});
export type ProjectInspection = z.infer<typeof ProjectInspection>;

export const EditorInfo = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['editor', 'terminal', 'finder']),
});
export type EditorInfo = z.infer<typeof EditorInfo>;
