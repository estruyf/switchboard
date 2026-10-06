import { Settings2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ListedAction } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import type { MenuEntry } from '../Menu.tsx';
import { ActionEditor } from './ActionEditor.tsx';
import { ACTION_ICON, formatShortcut, shortcutFromEvent, useProjectActionList } from './useActions.ts';

export interface ActionsMenu {
  entries: MenuEntry[];
  overlays: ReactNode;
  error: string | null;
  /** The project's actions, for the pills above the message box. */
  actions: ListedAction[];
  /** Runs an action (asking first when it needs trust or confirmation). */
  run: (action: ListedAction) => void;
  /** Opens the action editor; null when the session has no project to keep actions for. */
  openEditor: (() => void) | null;
}

/**
 * Project actions for the session view: a menu entry per action (with its shortcut) and
 * "Edit actions…", plus the dialogs they open (`overlays`, rendered by the caller). Also runs actions
 * from their shortcuts and from the command palette. Shell actions open a terminal tab; prompt
 * actions message Claude. `error`: the last run that failed.
 * Call it once per session view: every call adds its own shortcut listener and dialogs.
 */
export function useActionsMenu({ sessionId, projectRoot: root, cwd }: { sessionId: string; projectRoot: string | null; cwd: string | null }): ActionsMenu {
  // A session whose folder is unknown has no real project to keep actions for: saving would be refused.
  const projectRoot = root?.startsWith('/') ? root : null;
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const { actions, sharedFile, errors, reload } = useProjectActionList(projectRoot);
  const togglePanel = useTerminals((s) => s.togglePanel);
  const setActive = useTerminals((s) => s.setActive);
  const [editor, setEditor] = useState(false);
  const [pending, setPending] = useState<{ action: ListedAction; reason: 'confirm' | 'trust' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = async (action: ListedAction) => {
    if (!client || !projectRoot || !cwd) return;
    setError(null);
    try {
      const result = await client.call('actions.run', { sessionId, projectRoot, cwd, id: action.id });
      if (result.kind === 'terminal') {
        togglePanel(true);
        setActive(sessionId, result.terminalId);
      }
    } catch (e) {
      setError(`Couldn't run “${action.name}”: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const run = (action: ListedAction) => {
    if (!action.trusted) setPending({ action, reason: 'trust' });
    else if (action.confirm) setPending({ action, reason: 'confirm' });
    else void execute(action);
  };

  // The command palette asks for an action by id.
  const actionRequest = useOverlay((s) => s.actionRequest);
  useEffect(() => {
    if (!actionRequest) return;
    const action = actions.find((a) => a.id === actionRequest.id);
    useOverlay.getState().requestAction(null);
    if (action) runRef.current(action);
  }, [actionRequest, actions]);

  // Action shortcuts while this session is on screen.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const withShortcut = actions.filter((a) => a.shortcut);
    if (withShortcut.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      // In a terminal, ⌃ and ⌥ keys belong to the shell (⌃C stops a running action); only ⌘ shortcuts run actions there.
      if (!event.metaKey && (event.target as HTMLElement | null)?.closest?.('.xterm')) return;
      const shortcut = shortcutFromEvent(event);
      const action = shortcut && withShortcut.find((a) => a.shortcut === shortcut);
      if (action) {
        event.preventDefault();
        runRef.current(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  if (!projectRoot) return { entries: [], overlays: null, error: null, actions: [], run, openEditor: null };
  const openEditor = () => setEditor(true);
  const entries: MenuEntry[] = [
    { heading: 'Project actions' },
    ...actions.map((a) => {
      const Icon = ACTION_ICON[a.icon];
      return {
        label: a.name,
        icon: <Icon size={13} />,
        ...(a.shortcut ? { hint: formatShortcut(a.shortcut) } : {}),
        onSelect: () => run(a),
        // What it runs, as on the buttons it used to have.
        data: { 'data-action': a.id, 'data-tooltip': `${a.type === 'prompt' ? 'Ask Claude: ' : ''}${a.command}` },
      } satisfies MenuEntry;
    }),
    { label: actions.length ? 'Edit actions…' : 'Add an action…', icon: <Settings2 size={13} />, onSelect: openEditor, data: { 'data-edit-actions': true } },
  ];

  const overlays = (
    <>
      {editor && (
        <ActionEditor
          projectRoot={projectRoot}
          actions={actions}
          sharedFile={sharedFile}
          errors={errors}
          onChanged={reload}
          onClose={() => setEditor(false)}
        />
      )}
      {pending && (
        <ConfirmDialog
          title={pending.reason === 'trust' ? `Run “${pending.action.name}” ${pending.action.scope === 'shared' ? 'from this repository' : 'from imported settings'}?` : `Run “${pending.action.name}”?`}
          confirmLabel={pending.reason === 'trust' ? 'Approve and run' : 'Run'}
          body={
            <>
              {pending.reason === 'trust' && (
                <p className="mb-2">
                  {pending.action.scope === 'shared' ? (
                    <>
                      This action comes from the project’s <code className="font-mono">.switchboard.json</code>. Check the command before you approve it; you won’t be asked
                      again unless it changes.
                    </>
                  ) : (
                    <>This action was imported from a settings file. Check the command before you approve it; you won’t be asked again.</>
                  )}
                </p>
              )}
              <pre className="max-h-48 overflow-auto rounded-md bg-sidebar px-2.5 py-1.5 font-mono text-[12px] whitespace-pre-wrap text-text">{pending.action.command}</pre>
            </>
          }
          onConfirm={async () => {
            if (pending.reason === 'trust' && client && projectRoot) {
              await client.call('actions.trust', { projectRoot, id: pending.action.id });
              reload();
            }
            await execute(pending.action);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
  return { entries, overlays, error, actions, run, openEditor };
}
