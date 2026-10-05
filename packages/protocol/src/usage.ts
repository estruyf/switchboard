import { z } from 'zod';

/** One plan meter from Claude Code's usage report (the server decides which exist and how severe they are). */
export const UsageLimit = z.object({
  /** The server's meter kind: 'session' (5-hour window), 'weekly_all', 'weekly_scoped', … */
  kind: z.string(),
  group: z.string(),
  /** Share of the window used, 0–100. */
  percent: z.number(),
  resetsAt: z.number().nullable(),
  /** What a scoped meter is for, e.g. a model name. */
  scope: z.string().nullable(),
  /** The server's grading for colour: 'normal', 'warning', 'critical'. */
  severity: z.string(),
  isActive: z.boolean(),
});
export type UsageLimit = z.infer<typeof UsageLimit>;

export const UsageSnapshot = z.object({
  fetchedAt: z.number(),
  limits: z.array(UsageLimit),
  /** Extra-usage spend this billing period, in minor units of `currency`. */
  extraUsage: z
    .object({
      enabled: z.boolean(),
      usedCredits: z.number().nullable(),
      monthlyLimit: z.number().nullable(),
      currency: z.string().nullable(),
    })
    .nullable(),
});
export type UsageSnapshot = z.infer<typeof UsageSnapshot>;
