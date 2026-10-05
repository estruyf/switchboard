import { z } from 'zod';

/** Where a session was started, derived from Claude Code's `entrypoint`. */
export const SessionOrigin = z.enum(['cli', 'desktop', 'ide', 'sdk', 'app', 'unknown']);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const WorktreeInfo = z.object({
  /** Folder name under `<repo>/.claude/worktrees/` (or the worktree folder name). */
  name: z.string(),
  /** Current branch checked out in the worktree, read from git. */
  branch: z.string().nullable(),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfo>;

/** One session in the sidebar. Built from the transcript on disk; never the source of truth. */
export const SessionSummary = z.object({
  id: z.string(),
  /** Custom title, AI title, or first prompt, in that order. */
  title: z.string(),
  firstPrompt: z.string().nullable(),
  customTitle: z.string().nullable(),
  cwd: z.string().nullable(),
  /** Grouping key: the main repository root (worktrees fold into their repo), or the cwd outside git. */
  projectRoot: z.string(),
  /** Branch recorded in the transcript. For worktree sessions prefer `worktree.branch`. */
  gitBranch: z.string().nullable(),
  worktree: WorktreeInfo.nullable(),
  origin: SessionOrigin,
  createdAt: z.number().nullable(),
  updatedAt: z.number(),
  fileSize: z.number().nullable(),
  tag: z.string().nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** Normalised live state from the `~/.claude/sessions` registry. */
export const LiveStatus = z.enum(['running', 'needs-you', 'idle']);
export type LiveStatus = z.infer<typeof LiveStatus>;

export const LiveSession = z.object({
  sessionId: z.string(),
  pid: z.number(),
  cwd: z.string().nullable(),
  projectRoot: z.string().nullable(),
  status: LiveStatus,
  /** The registry's own status string, kept for display and debugging. */
  rawStatus: z.string(),
  name: z.string().nullable(),
  origin: SessionOrigin,
  startedAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
});
export type LiveSession = z.infer<typeof LiveSession>;

export const TranscriptBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    /** Tool input with long strings shortened (see `truncated`). */
    input: z.json(),
    truncated: z.boolean(),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string(),
    isError: z.boolean(),
    text: z.string(),
    truncated: z.boolean(),
  }),
  z.object({ type: z.literal('image'), mediaType: z.string().nullable() }),
  /** Anything we don't render yet; kept so the UI can show a placeholder instead of dropping it. */
  z.object({ type: z.literal('unknown'), kind: z.string() }),
]);
export type TranscriptBlock = z.infer<typeof TranscriptBlock>;

export const TranscriptMessage = z.object({
  uuid: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  timestamp: z.number().nullable(),
  /** Set for messages produced inside a subagent (Task/Agent tool). */
  parentToolUseId: z.string().nullable(),
  model: z.string().nullable(),
  blocks: z.array(TranscriptBlock),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessage>;

export const SessionsSnapshot = z.object({
  sessions: z.array(SessionSummary),
  live: z.array(LiveSession),
  /** False while the list comes from the cache and the first scan of ~/.claude has not finished. */
  complete: z.boolean(),
});
export type SessionsSnapshot = z.infer<typeof SessionsSnapshot>;

export const SessionsChanged = z.object({
  upserted: z.array(SessionSummary),
  removed: z.array(z.string()),
  complete: z.boolean(),
});
export type SessionsChanged = z.infer<typeof SessionsChanged>;

export const TranscriptUpdate = z.object({
  sessionId: z.string(),
  /** `append` when the new messages extend what was sent before; `replace` after rewinds or compaction. */
  mode: z.enum(['append', 'replace']),
  messages: z.array(TranscriptMessage),
});
export type TranscriptUpdate = z.infer<typeof TranscriptUpdate>;
