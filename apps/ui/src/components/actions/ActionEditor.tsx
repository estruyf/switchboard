import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ACTION_ICONS, type ActionIcon, type ActionSuggestion, type ListedAction, type ProjectAction } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useOpenIn } from '../OpenInButton.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Select } from '../ui/Select.tsx';
import { ACTION_ICON, formatShortcut, RESERVED_SHORTCUTS, shortcutFromEvent } from './useActions.ts';

type Draft = ProjectAction & { scope: 'project' | 'global' };

const EMPTY: Draft = { id: '', name: '', icon: 'play', type: 'shell', command: '', cwd: 'session', confirm: false, shortcut: null, runOnWorktreeCreate: false, scope: 'project' };

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'action';

const field = 'h-7 rounded-md border border-border bg-bg px-2 text-[12px] text-text outline-none focus:border-accent-ink/60';
const SCOPE_LABEL = { project: 'This project', global: 'All projects', shared: '.switchboard.json' } as const;

function ShortcutInput({ value, onChange }: { value: string | null; onChange(value: string | null): void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (setRecording(true), setError(null))}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          if (e.key === 'Escape') return setRecording(false);
          const shortcut = shortcutFromEvent(e.nativeEvent);
          if (!shortcut) return;
          if (!shortcut.includes('+')) return setError('Add ⌘, ⌃ or ⌥');
          if (RESERVED_SHORTCUTS.has(shortcut)) return setError(`${formatShortcut(shortcut)} is used by Switchboard`);
          onChange(shortcut);
          setRecording(false);
        }}
        className={`${field} min-w-28 text-left ${recording ? 'border-accent-ink/60 text-accent-ink' : ''}`}
      >
        {recording ? 'Press keys…' : value ? formatShortcut(value) : 'None'}
      </button>
      {value && (
        <button type="button" onClick={() => onChange(null)} className="text-[11px] text-faint hover:text-text">
          Clear
        </button>
      )}
      {error && <span className="text-[11px] text-error">{error}</span>}
    </div>
  );
}

/** Add, edit and remove project actions. Shared ones are read-only here (edit .switchboard.json). */
export function ActionEditor({
  projectRoot,
  actions,
  sharedFile,
  errors,
  initial,
  onChanged,
  onClose,
}: {
  projectRoot: string;
  actions: ListedAction[];
  sharedFile: string | null;
  errors: string[];
  initial?: Partial<Draft> | null;
  onChanged(): void;
  onClose(): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  const [draft, setDraft] = useState<Draft | null>(initial ? { ...EMPTY, ...initial } : null);
  const [editingId, setEditingId] = useState<{ id: string; scope: 'project' | 'global' } | null>(null);
  const [suggestions, setSuggestions] = useState<ActionSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client) void client.call('actions.suggest', { projectRoot }).then((r) => setSuggestions(r.suggestions));
  }, [client, projectRoot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !draft && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, onClose]);

  const save = async () => {
    if (!client || !draft) return;
    const { scope, ...action } = draft;
    const id = editingId?.id ?? slug(action.name);
    try {
      if (editingId && editingId.scope !== scope) await client.call('actions.delete', { projectRoot: editingId.scope === 'global' ? null : projectRoot, id: editingId.id });
      await client.call('actions.save', {
        projectRoot: scope === 'global' ? null : projectRoot,
        action: { ...action, id: editingId && editingId.scope === scope ? id : slug(action.name), runOnWorktreeCreate: action.type === 'shell' && action.runOnWorktreeCreate },
        ...(editingId && editingId.scope === scope && editingId.id !== slug(action.name) ? { previousId: editingId.id } : {}),
      });
      setDraft(null);
      setEditingId(null);
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (a: ListedAction) => {
    if (!client || a.scope === 'shared') return;
    await client.call('actions.delete', { projectRoot: a.scope === 'global' ? null : projectRoot, id: a.id });
    onChanged();
  };

  const used = new Set(actions.map((a) => a.command));

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col rounded-xl border overlay">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-semibold">Project actions</h2>
          <button type="button" onClick={onClose} className="text-faint hover:text-text" aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {errors.map((e) => (
            <p key={e} className="mb-2 rounded-md bg-error/10 px-2.5 py-1.5 text-[12px] text-error">
              {e}
            </p>
          ))}

          {!draft && (
            <>
              <ul className="grid gap-1">
                {actions.length === 0 && <li className="text-[12px] text-muted">No actions yet. Add one, or pick a suggestion below.</li>}
                {actions.map((a) => {
                  const Icon = ACTION_ICON[a.icon];
                  return (
                    <li key={`${a.scope}:${a.id}`} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-border/40">
                      <Icon size={14} className="shrink-0 text-muted" />
                      <span className="text-[13px]">{a.name}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{a.type === 'prompt' ? `“${a.command}”` : a.command}</span>
                      {a.shortcut && <span className="text-[11px] text-faint">{formatShortcut(a.shortcut)}</span>}
                      <span className="rounded bg-border/70 px-1.5 text-[10px] text-muted">{SCOPE_LABEL[a.scope]}</span>
                      {a.scope !== 'shared' ? (
                        <>
                          <button type="button" onClick={() => (setDraft({ ...a, scope: a.scope as 'project' | 'global' }), setEditingId({ id: a.id, scope: a.scope as 'project' | 'global' }))} className="text-faint opacity-0 group-hover:opacity-100 hover:text-text" aria-label={`Edit ${a.name}`}>
                            <Pencil size={13} />
                          </button>
                          <button type="button" onClick={() => void remove(a)} className="text-faint opacity-0 group-hover:opacity-100 hover:text-error" aria-label={`Delete ${a.name}`}>
                            <Trash2 size={13} />
                          </button>
                        </>
                      ) : (
                        sharedFile && (
                          <button type="button" onClick={() => void openIn(sharedFile)} className="text-[11px] text-faint opacity-0 group-hover:opacity-100 hover:text-text">
                            Edit file
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
              <button type="button" data-add-action onClick={() => (setDraft({ ...EMPTY }), setEditingId(null))} className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-border/50">
                <Plus size={13} /> Add action
              </button>

              {suggestions.some((s) => !used.has(s.command)) && (
                <div className="mt-5">
                  <p className="mb-1.5 text-[11px] tracking-wide text-faint uppercase">Suggestions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions
                      .filter((s) => !used.has(s.command))
                      .map((s) => {
                        const Icon = ACTION_ICON[s.icon];
                        return (
                          <button
                            key={s.command}
                            type="button"
                            data-tooltip={s.command}
                            onClick={() => (setDraft({ ...EMPTY, name: s.name, command: s.command, type: s.type, icon: s.icon }), setEditingId(null))}
                            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[12px] text-muted hover:border-accent-ink/50 hover:text-text"
                          >
                            <Icon size={12} /> {s.name}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
              <p className="mt-5 text-[11px] leading-relaxed text-faint">
                Share actions with your team by committing a <code className="font-mono">.switchboard.json</code> in the repo:{' '}
                <code className="font-mono">{'{ "actions": [{ "name": "Test", "command": "npm test" }] }'}</code>. Each shared command asks for your approval once.
                Commands can use <code className="font-mono">{'${branch} ${cwd} ${projectRoot} ${worktreeName} ${sessionId} ${sessionTitle}'}</code>.
              </p>
            </>
          )}

          {draft && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input autoFocus required maxLength={40} placeholder="Name, e.g. Publish" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} data-action-name />
                <Select
                  label="Icon"
                  className={`${field} w-36`}
                  value={draft.icon}
                  onChange={(icon) => setDraft({ ...draft, icon })}
                  options={ACTION_ICONS.map((icon) => {
                    const Icon = ACTION_ICON[icon];
                    return { value: icon, label: icon, icon: <Icon size={13} /> };
                  })}
                  dataAttrs={{ 'data-action-icon': true }}
                />
              </div>
              <div className="flex gap-1 rounded-md border border-border bg-bg p-0.5 text-[12px]">
                {(['shell', 'prompt'] as const).map((type) => (
                  <button key={type} type="button" onClick={() => setDraft({ ...draft, type })} className={`flex-1 rounded px-2 py-1 ${draft.type === type ? 'bg-accent/15 text-text' : 'text-muted'}`}>
                    {type === 'shell' ? 'Run a command' : 'Ask Claude'}
                  </button>
                ))}
              </div>
              <textarea
                required
                rows={3}
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                placeholder={draft.type === 'shell' ? 'npm run build && npm publish' : 'Commit the staged changes with a clear message'}
                className={`${field} h-auto py-1.5 font-mono`}
                data-action-command
              />
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <label className="grid gap-1">
                  <span className="text-faint">Saved for</span>
                  <Select
                    label="Saved for"
                    className={field}
                    value={draft.scope}
                    onChange={(scope) => setDraft({ ...draft, scope })}
                    options={[
                      { value: 'project', label: 'This project' },
                      { value: 'global', label: 'All projects' },
                    ]}
                  />
                </label>
                {draft.type === 'shell' && (
                  <label className="grid gap-1">
                    <span className="text-faint">Runs in</span>
                    <Select
                      label="Runs in"
                      className={field}
                      value={draft.cwd}
                      onChange={(cwd) => setDraft({ ...draft, cwd })}
                      options={[
                        { value: 'session', label: 'Session folder (worktree)' },
                        { value: 'project-root', label: 'Project root' },
                      ]}
                    />
                  </label>
                )}
                <label className="grid gap-1">
                  <span className="text-faint">Shortcut</span>
                  <ShortcutInput value={draft.shortcut} onChange={(shortcut) => setDraft({ ...draft, shortcut })} />
                </label>
              </div>
              <Checkbox checked={draft.confirm} onChange={(confirm) => setDraft({ ...draft, confirm })} className="text-[12px]" dataAttrs={{ 'data-action-confirm': true }}>
                Ask before running
              </Checkbox>
              {draft.type === 'shell' && (
                <Checkbox checked={draft.runOnWorktreeCreate} onChange={(runOnWorktreeCreate) => setDraft({ ...draft, runOnWorktreeCreate })} className="text-[12px]">
                  Run in every new worktree before Claude starts (e.g. install dependencies)
                </Checkbox>
              )}
              {error && <p className="text-[12px] text-error">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => (setDraft(null), setEditingId(null))} className="rounded-md border border-border px-3 py-1 text-[12px]">
                  Cancel
                </button>
                <button type="submit" data-save-action className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-on-accent">
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
