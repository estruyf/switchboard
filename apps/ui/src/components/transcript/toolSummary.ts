/** One-line description of a tool call for its collapsed card. */
export interface ToolSummary {
  label: string;
  detail: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function relative(path: string, cwd: string | null): string {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
}

/** `mcp__claude_ai_Notion__notion-search` → `Notion · notion-search`. */
function mcpLabel(name: string): string | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!match) return null;
  const server = match[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ');
  return `${server} · ${match[2]}`;
}

export function toolSummary(name: string, input: unknown, cwd: string | null): ToolSummary {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const file = str(i.file_path) ?? str(i.notebook_path) ?? str(i.path);
  switch (name) {
    case 'Bash':
      return { label: 'Bash', detail: str(i.description) ? `${i.description}` : (str(i.command) ?? '') };
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { label: name, detail: file ? relative(file, cwd) : '' };
    case 'Grep':
      return { label: 'Grep', detail: [str(i.pattern), str(i.path) && relative(String(i.path), cwd)].filter(Boolean).join('  in  ') };
    case 'Glob':
      return { label: 'Glob', detail: str(i.pattern) ?? '' };
    case 'WebFetch':
      return { label: 'Fetch', detail: str(i.url) ?? '' };
    case 'WebSearch':
      return { label: 'Search', detail: str(i.query) ?? '' };
    case 'Task':
    case 'Agent':
      return { label: str(i.subagent_type) ?? 'Agent', detail: str(i.description) ?? str(i.prompt)?.slice(0, 120) ?? '' };
    case 'TodoWrite': {
      const todos = Array.isArray(i.todos) ? i.todos : [];
      const done = todos.filter((t) => (t as { status?: unknown })?.status === 'completed').length;
      return { label: 'Todos', detail: `${done}/${todos.length} done` };
    }
    case 'Skill':
      return { label: 'Skill', detail: str(i.skill) ?? str(i.command) ?? '' };
    case 'AskUserQuestion': {
      const questions = Array.isArray(i.questions) ? i.questions : [];
      return { label: 'Question', detail: str((questions[0] as { question?: unknown } | undefined)?.question) ?? '' };
    }
    default: {
      const mcp = mcpLabel(name);
      const firstString = Object.values(i).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
      return { label: mcp ?? name, detail: firstString?.slice(0, 160) ?? '' };
    }
  }
}
