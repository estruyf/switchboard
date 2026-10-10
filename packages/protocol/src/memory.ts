import { z } from 'zod';

/** One file in a project's auto memory folder (not `MEMORY.md`, the index). */
export const MemoryFile = z.object({
  path: z.string(),
  /** The `name:` in its frontmatter, else the file name without `.md`. */
  name: z.string(),
  description: z.string().nullable(),
  /** `user`, `feedback`, `project` or `reference` as Claude Code writes them (top level or under `metadata`); null when missing. */
  type: z.string().nullable(),
  modified: z.number(),
  bytes: z.number(),
});
export type MemoryFile = z.infer<typeof MemoryFile>;

/** `claude-md`: CLAUDE.md at the root or in `.claude/`. `local`: CLAUDE.local.md. `rule`: a file in `.claude/rules/`. */
export const InstructionKind = z.enum(['claude-md', 'local', 'rule']);
export type InstructionKind = z.infer<typeof InstructionKind>;

/** A file of project instructions Claude Code loads. */
export const InstructionFile = z.object({
  path: z.string(),
  kind: InstructionKind,
  /** A rule's `paths:` frontmatter: it only loads for files that match. */
  paths: z.array(z.string()).optional(),
  /** Committed with the project (not CLAUDE.local.md, and not ignored by git). */
  shared: z.boolean(),
  bytes: z.number(),
});
export type InstructionFile = z.infer<typeof InstructionFile>;

export const MemoryList = z.object({
  /** The folder new memories go to (the project's profile), or null when none could be worked out. */
  memoryDir: z.string().nullable(),
  memories: z.array(MemoryFile),
  instructions: z.array(InstructionFile),
  /** The lines of that folder's `MEMORY.md` (0 when there is none). Claude Code reads the first 200. */
  indexLines: z.number(),
});
export type MemoryList = z.infer<typeof MemoryList>;

/** Where a shared memory goes. */
export const ShareTarget = z.discriminatedUnion('kind', [
  /** The existing CLAUDE.md (root first, else `.claude/CLAUDE.md`), or a new root CLAUDE.md. */
  z.object({ kind: z.literal('claude-md') }),
  /** `.claude/rules/<file>.md`, existing or new; `paths` is written as frontmatter for a new one. */
  z.object({
    kind: z.literal('rule'),
    file: z.string().min(1).max(200),
    paths: z.array(z.string().min(1).max(500)).max(50).optional(),
  }),
  /** CLAUDE.local.md at the root: only for you. */
  z.object({ kind: z.literal('local') }),
]);
export type ShareTarget = z.infer<typeof ShareTarget>;

/**
 * `sameHeading`: the target has a section with this heading already. `alreadyThere`: the exact text is in it.
 * `secrets`: the text looks like it holds a token, key or password (`detail` says what). `localNotIgnored`: git
 * would commit CLAUDE.local.md. `targetDirty`: the target has uncommitted changes.
 */
export const ShareWarningKind = z.enum(['sameHeading', 'alreadyThere', 'secrets', 'localNotIgnored', 'targetDirty']);
export type ShareWarningKind = z.infer<typeof ShareWarningKind>;
export const ShareWarning = z.object({ kind: ShareWarningKind, detail: z.string().nullable() });
export type ShareWarning = z.infer<typeof ShareWarning>;

export const SharePreview = z.object({
  targetPath: z.string(),
  exists: z.boolean(),
  before: z.string(),
  after: z.string(),
  /** A unified diff of before and after. */
  diff: z.string(),
  warnings: z.array(ShareWarning),
});
export type SharePreview = z.infer<typeof SharePreview>;

/** What a section copied to memory would write (or wrote). */
export const SectionCopy = z.object({
  path: z.string(),
  /** The name it gets: the one asked for, or with `-2`, `-3` … when that file exists. */
  name: z.string(),
  content: z.string(),
  /** The line it adds to MEMORY.md. */
  indexLine: z.string(),
  /** MEMORY.md's lines afterwards. */
  indexLines: z.number(),
});
export type SectionCopy = z.infer<typeof SectionCopy>;
