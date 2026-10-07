/** What a background task is, in words, from Claude Code's task type. */
export type BackgroundKind = 'shell' | 'agent' | 'workflow' | 'monitor' | 'tool' | 'other';

const KINDS: Record<string, BackgroundKind> = {
  local_bash: 'shell',
  local_agent: 'agent',
  remote_agent: 'agent',
  local_workflow: 'workflow',
  monitor: 'monitor',
  mcp_task: 'tool',
};

export const KIND_LABEL: Record<BackgroundKind, string> = {
  shell: 'Shell command',
  agent: 'Agent',
  workflow: 'Workflow',
  monitor: 'Monitor',
  tool: 'MCP tool',
  other: 'Task',
};

/** Unknown types (Claude Code adds new ones) read as a plain task rather than a raw id. */
export function backgroundKind(type: string): BackgroundKind {
  return KINDS[type] ?? 'other';
}

/** The pill's label: how many tasks run, and what they are when they're all the same kind. */
export function backgroundSummary(types: string[]): string {
  const n = types.length;
  const kinds = new Set(types.map(backgroundKind));
  if (kinds.size === 1) {
    const kind = [...kinds][0]!;
    if (kind === 'shell') return n === 1 ? '1 background command' : `${n} background commands`;
    if (kind === 'agent') return n === 1 ? '1 background agent' : `${n} background agents`;
  }
  return n === 1 ? '1 background task' : `${n} background tasks`;
}
