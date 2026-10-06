import type { Effort, PermissionMode, ProjectDefaults } from '@switchboard/protocol/client';

/** What a new session starts with. Empty strings mean "Claude Code's default" (model, effort) or "keep the checked-out branch". */
export interface Choices {
  model: string;
  permissionMode: PermissionMode;
  effort: Effort | '';
  workspace: 'current' | 'worktree';
  baseRef: 'fresh' | 'head';
  branch: string;
}

/** The global defaults: the choices last used for a field no project decides. Branches belong to a repository, so they never become global. */
export type GlobalChoices = Omit<Choices, 'branch'>;

export const INITIAL_CHOICES: GlobalChoices = { model: '', permissionMode: 'default', effort: '', workspace: 'current', baseRef: 'fresh' };

const FIELDS = ['model', 'permissionMode', 'effort', 'workspace', 'baseRef', 'branch'] as const;

/** The choices a new session in a project starts from: the project's defaults, and the global ones where it sets none. */
export function startingChoices(globals: GlobalChoices, project: ProjectDefaults | null | undefined): Choices {
  return {
    model: project?.model ?? globals.model,
    permissionMode: project?.permissionMode ?? globals.permissionMode,
    effort: project?.effort ?? globals.effort,
    workspace: project?.workspace ?? globals.workspace,
    baseRef: project?.baseRef ?? globals.baseRef,
    branch: project?.branch ?? '',
  };
}

/**
 * The part of a change that updates the global defaults: fields the project decides apply to this
 * session only (until saved as the project's default).
 */
export function globalPatch(patch: Partial<Choices>, project: ProjectDefaults | null | undefined): Partial<GlobalChoices> {
  const out: Partial<GlobalChoices> = {};
  for (const key of FIELDS) {
    if (key === 'branch' || !(key in patch) || (project && project[key] !== null)) continue;
    (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
}

/** The choices as a project's defaults ("Save as project default"). */
export function toProjectDefaults(choices: Choices): ProjectDefaults {
  return {
    model: choices.model || null,
    effort: choices.effort || null,
    permissionMode: choices.permissionMode,
    workspace: choices.workspace,
    baseRef: choices.baseRef,
    // A branch only applies to the current folder; a worktree gets its own.
    branch: choices.workspace === 'current' ? choices.branch || null : null,
  };
}

export function sameDefaults(a: ProjectDefaults, b: ProjectDefaults): boolean {
  return FIELDS.every((key) => a[key] === b[key]);
}

/** Reads stored global defaults leniently (older builds stored the folder alongside). */
export function readGlobals(value: unknown): { globals: GlobalChoices; cwd: string | null } {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const pick = <K extends keyof GlobalChoices>(key: K, ok: (v: unknown) => boolean) => (ok(raw[key]) ? (raw[key] as GlobalChoices[K]) : INITIAL_CHOICES[key]);
  return {
    globals: {
      model: pick('model', (v) => typeof v === 'string'),
      permissionMode: pick('permissionMode', (v) => typeof v === 'string' && v !== ''),
      effort: pick('effort', (v) => typeof v === 'string'),
      workspace: pick('workspace', (v) => v === 'current' || v === 'worktree'),
      baseRef: pick('baseRef', (v) => v === 'fresh' || v === 'head'),
    },
    cwd: typeof raw.cwd === 'string' ? raw.cwd : null,
  };
}
