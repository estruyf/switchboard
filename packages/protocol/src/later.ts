import { z } from 'zod';
import { Effort, PermissionMode } from './host.ts';

/** What a prompt saved for later starts with: the folder and the choices from New session. */
export const LaterDraft = z.object({
  /** The folder the session would start in (a project's root). */
  cwd: z.string().min(1).max(4096).startsWith('/'),
  prompt: z.string().trim().min(1).max(200_000),
  model: z.string().max(200).nullable().default(null),
  effort: Effort.nullable().default(null),
  permissionMode: PermissionMode.default('default'),
  workspace: z.enum(['current', 'worktree']).default('current'),
  baseRef: z.enum(['fresh', 'head']).default('fresh'),
  /** A branch to check out first (current checkout only); null keeps what is checked out. */
  branch: z.string().min(1).max(250).nullable().default(null),
  /** A profile picked for this session only; null uses the project's, else the default. */
  profileId: z.string().min(1).max(100).nullable().default(null),
});
export type LaterDraft = z.input<typeof LaterDraft>;

/** A prompt parked on the Later list instead of starting a session (see the focus limit). */
export const LaterItem = LaterDraft.extend({
  id: z.string(),
  createdAt: z.number(),
});
export type LaterItem = z.infer<typeof LaterItem>;
