import { Check, Circle, CircleDot } from 'lucide-react';

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

/** Reads TodoWrite input defensively (it's model output). */
export function parseTodos(input: unknown): Todo[] {
  const todos = (input as { todos?: unknown } | null)?.todos;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((t) => {
    const todo = t as Partial<Todo>;
    if (typeof todo.content !== 'string') return [];
    const status = todo.status === 'completed' || todo.status === 'in_progress' ? todo.status : 'pending';
    return [{ content: todo.content, status, ...(typeof todo.activeForm === 'string' ? { activeForm: todo.activeForm } : {}) }];
  });
}

/** Claude's task list: done, in progress (with its "doing…" wording), and still to do. */
export function TodoList({ todos, compact = false }: { todos: Todo[]; compact?: boolean }) {
  return (
    <ul className={`grid ${compact ? 'gap-0.5' : 'gap-1'}`} data-todos>
      {todos.map((todo, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px] leading-snug">
          {todo.status === 'completed' ? (
            <Check size={14} className="mt-px shrink-0 text-ok" />
          ) : todo.status === 'in_progress' ? (
            <CircleDot size={14} className="mt-px shrink-0 animate-pulse text-accent" />
          ) : (
            <Circle size={14} className="mt-px shrink-0 text-faint" />
          )}
          <span className={todo.status === 'completed' ? 'text-faint line-through' : todo.status === 'in_progress' ? 'font-medium text-text' : 'text-muted'}>
            {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
          </span>
        </li>
      ))}
    </ul>
  );
}
