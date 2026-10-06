import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ACTION_ICONS, type ActionIcon, type ActionSuggestion, type ListedAction, type ProjectAction } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { Select } from '../ui/Select.tsx';
import { useModalFocus } from '../ui/useModalFocus.ts';
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

/** Readable names for the icon picker (the stored values are lucide-style ids such as `git-commit`). */
const ICON_NAME: Record<ActionIcon, string> = {
  play: 'Play',
  rocket: 'Rocket',
  'git-commit': 'Commit',
  'git-pull-request': 'Pull request',
  upload: 'Upload',
  flask: 'Flask',
  package: 'Package',
  terminal: 'Terminal',
  sparkles: 'Sparkles',
  wrench: 'Wrench',
  globe: 'Globe',
  bug: 'Bug',
  check: 'Check',
};

/**
 * Records a key combination: click (or press Space), then press the keys. Escape stops recording.
 * The hint underneath says so, since "None" alone doesn't tell anyone what the field does.
 */
function ShortcutInput({ value, onChange }: { value: string | null; onChange(value: string | null): void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <div className="grid gap-1">
      <span id={`${id}-label`} className="text-muted">
        Shortcut
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-labelledby={`${id}-label ${id}-value`}
          aria-describedby={`${id}-hint`}
          onClick={() => (setRecording(true), setError(null))}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (!recording) return;
            e.preventDefault();
            if (e.key === 'Escape') return setRecording(false);
            const shortcut = shortcutFromEvent(e.nativeEvent);
            if (!shortcut) return;
            if (!shortcut.includes('+')) return setError('Include ⌘, ⌃ or ⌥ in the shortcut');
            if (RESERVED_SHORTCUTS.has(shortcut)) return setError(`${formatShortcut(shortcut)} is used by Switchboard`);
            onChange(shortcut);
            setRecording(false);
          }}
          className={`${field} min-w-28 text-left ${recording ? 'border-accent-ink/60 text-accent-ink' : ''}`}
          data-action-shortcut
        >
          <span id={`${id}-value`}>{recording ? 'Press keys…' : value ? formatShortcut(value) : 'None'}</span>
        </button>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-[11px] text-muted hover:text-text" aria-label="Clear the shortcut">
            Clear
          </button>
        )}
      </div>
      {error ? (
        <span id={`${id}-hint`} role="alert" className="text-[11px] text-error">
          {error}
        </span>
      ) : (
        <span id={`${id}-hint`} className="text-[11px] text-muted">
          {recording ? 'Press the keys, e.g. ⌘⇧B. Esc cancels.' : 'Optional. Click, then press keys to run this action from the keyboard.'}
        </span>
      )}
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
  /** The action waiting for "Delete?" to be confirmed. */
  const [deleting, setDeleting] = useState<ListedAction | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useModalFocus(dialogRef);

  useEffect(() => {
    if (client) void client.call('actions.suggest', { projectRoot }).then((r) => setSuggestions(r.suggestions));
  }, [client, projectRoot]);

  // Escape steps back: from the form to the list, then closes. Not while recording a shortcut (it
  // stops the recording), a dropdown is open (it closes the dropdown) or the delete confirmation is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || deleting || document.querySelector('[role=listbox]')) return;
      if (draft) (setDraft(null), setEditingId(null), setError(null));
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, deleting, onClose]);

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
      <div ref={dialogRef} role="dialog" aria-modal aria-labelledby={`${id}-title`} className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col rounded-xl border overlay">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id={`${id}-title`} className="text-[14px] font-semibold">
            {draft ? (editingId ? `Edit ${draft.name || 'action'}` : 'New action') : 'Project actions'}
          </h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close" data-tooltip="Close (Esc)">
            <X size={15} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {errors.map((e) => (
            <p key={e} role="alert" className="mb-2 rounded-md bg-error/10 px-2.5 py-1.5 text-[12px] text-error">
              {e}
            </p>
          ))}

          {!draft && (
            <>
              <ul className="grid gap-1" aria-label="Actions">
                {actions.length === 0 && <li className="text-[12px] text-muted">No actions yet. Add one, or pick a suggestion below.</li>}
                {actions.map((a) => {
                  const Icon = ACTION_ICON[a.icon];
                  return (
                    <li key={`${a.scope}:${a.id}`} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-border/40">
                      <Icon size={14} className="shrink-0 text-muted" aria-hidden />
                      <span className="text-[13px]">{a.name}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" data-tooltip={a.command}>
                        {a.type === 'prompt' ? `“${a.command}”` : a.command}
                      </span>
                      {a.shortcut && <span className="text-[11px] text-muted">{formatShortcut(a.shortcut)}</span>}
                      <span className="rounded bg-border/70 px-1.5 text-[10px] text-muted">{SCOPE_LABEL[a.scope]}</span>
                      {a.scope !== 'shared' ? (
                        <>
                          {/* Shown on hover, and whenever they have keyboard focus. */}
                          <button
                            type="button"
                            onClick={() => (setDraft({ ...a, scope: a.scope as 'project' | 'global' }), setEditingId({ id: a.id, scope: a.scope as 'project' | 'global' }))}
                            className="text-muted opacity-0 group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
                            aria-label={`Edit ${a.name}`}
                            data-tooltip="Edit"
                          >
                            <Pencil size={13} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleting(a)}
                            className="text-muted opacity-0 group-hover:opacity-100 hover:text-error focus-visible:opacity-100"
                            aria-label={`Delete ${a.name}`}
                            data-tooltip="Delete"
                          >
                            <Trash2 size={13} aria-hidden />
                          </button>
                        </>
                      ) : (
                        sharedFile && (
                          <button type="button" onClick={() => void openIn(sharedFile)} className="text-[11px] text-muted opacity-0 group-hover:opacity-100 hover:text-text focus-visible:opacity-100">
                            Edit file
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
              <button type="button" data-add-action onClick={() => (setDraft({ ...EMPTY }), setEditingId(null))} className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-border/50">
                <Plus size={13} aria-hidden /> Add action
              </button>

              {suggestions.some((s) => !used.has(s.command)) && (
                <div className="mt-5">
                  <p id={`${id}-suggestions`} className="mb-1.5 text-[11px] tracking-wide text-muted uppercase">
                    Suggestions
                  </p>
                  <div role="group" aria-labelledby={`${id}-suggestions`} className="flex flex-wrap gap-1.5">
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
                            <Icon size={12} aria-hidden /> {s.name}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
              <p className="mt-5 text-[11px] leading-relaxed text-muted">
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
                <input
                  autoFocus
                  required
                  maxLength={40}
                  placeholder="Name, e.g. Publish"
                  aria-label="Name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={field}
                  data-action-name
                />
                <Select
                  label="Icon"
                  className={`${field} w-36`}
                  value={draft.icon}
                  onChange={(icon) => setDraft({ ...draft, icon })}
                  options={ACTION_ICONS.map((icon) => {
                    const Icon = ACTION_ICON[icon];
                    return { value: icon, label: ICON_NAME[icon], icon: <Icon size={13} aria-hidden /> };
                  })}
                  dataAttrs={{ 'data-action-icon': true }}
                />
              </div>
              <RadioGroup label="What the action does" className="flex gap-1 rounded-md border border-border bg-bg p-0.5 text-[12px]">
                {(['shell', 'prompt'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={draft.type === type}
                    tabIndex={draft.type === type ? 0 : -1}
                    onClick={() => setDraft({ ...draft, type })}
                    className={`flex-1 rounded px-2 py-1 ${draft.type === type ? 'bg-accent/15 text-text' : 'text-muted hover:text-text'}`}
                    data-action-type={type}
                  >
                    {type === 'shell' ? 'Run a command' : 'Ask Claude'}
                  </button>
                ))}
              </RadioGroup>
              <textarea
                required
                rows={3}
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                placeholder={draft.type === 'shell' ? 'npm run build && npm publish' : 'Commit the staged changes with a clear message'}
                aria-label={draft.type === 'shell' ? 'Command' : 'Prompt for Claude'}
                className={`${field} h-auto py-1.5 font-mono`}
                data-action-command
              />
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <label className="grid gap-1">
                  <span className="text-muted">Saved for</span>
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
                    <span className="text-muted">Runs in</span>
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
                <div className="col-span-2">
                  <ShortcutInput value={draft.shortcut} onChange={(shortcut) => setDraft({ ...draft, shortcut })} />
                </div>
              </div>
              <Checkbox checked={draft.confirm} onChange={(confirm) => setDraft({ ...draft, confirm })} className="text-[12px]" dataAttrs={{ 'data-action-confirm': true }}>
                Ask before running
              </Checkbox>
              {draft.type === 'shell' && (
                <Checkbox checked={draft.runOnWorktreeCreate} onChange={(runOnWorktreeCreate) => setDraft({ ...draft, runOnWorktreeCreate })} className="text-[12px]">
                  Run in every new worktree before Claude starts (e.g. install dependencies)
                </Checkbox>
              )}
              {error && (
                <p role="alert" className="text-[12px] text-error">
                  Couldn't save the action: {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => (setDraft(null), setEditingId(null), setError(null))} className="rounded-md border border-border px-3 py-1 text-[12px] hover:bg-border/50">
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
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={<>The action is removed from {deleting.scope === 'global' ? 'all your projects' : 'this project'}. Its command is not run.</>}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
