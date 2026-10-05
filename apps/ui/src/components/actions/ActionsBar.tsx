import { ChevronDown, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ListedAction } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ActionEditor } from './ActionEditor.tsx';
import { ACTION_ICON, formatShortcut, shortcutFromEvent, useProjectActionList } from './useActions.ts';

const VISIBLE = 3;

/**
 * Project actions in the session header: the first few as buttons, the rest
 * in a menu. Shell actions open a terminal tab; prompt actions message Claude.
 */
export function ActionsBar({ sessionId, projectRoot, cwd }: { sessionId: string; projectRoot: string | null; cwd: string | null }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const { actions, sharedFile, errors, reload } = useProjectActionList(projectRoot);
  const togglePanel = useTerminals((s) => s.togglePanel);
  const setActive = useTerminals((s) => s.setActive);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
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
      setError(e instanceof Error ? e.message : String(e));
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

  if (!projectRoot) return null;
  const visible = actions.slice(0, VISIBLE);
  const entries: MenuEntry[] = [
    ...actions.slice(VISIBLE).map((a) => {
      const Icon = ACTION_ICON[a.icon];
      return { label: a.name, icon: <Icon size={13} />, ...(a.shortcut ? { hint: formatShortcut(a.shortcut) } : {}), onSelect: () => run(a) } satisfies MenuEntry;
    }),
    ...(actions.length > VISIBLE ? ['separator' as const] : []),
    { label: actions.length ? 'Edit actions…' : 'Add an action…', icon: <Settings2 size={13} />, onSelect: () => setEditor(true) },
  ];

  return (
    <div className="no-drag flex shrink-0 items-center gap-1" data-actions-bar title={error ?? undefined}>
      {visible.map((action) => {
        const Icon = ACTION_ICON[action.icon];
        return (
          <button
            key={action.id}
            type="button"
            data-action={action.id}
            onClick={() => run(action)}
            title={`${action.type === 'prompt' ? 'Ask Claude: ' : ''}${action.command}${action.shortcut ? `  (${formatShortcut(action.shortcut)})` : ''}`}
            className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] hover:bg-border/50 ${error ? 'border-error/50' : 'border-border'}`}
          >
            <Icon size={13} className="text-muted" />
            <span className="@max-[860px]:hidden">{action.name}</span>
          </button>
        );
      })}
      <button
        type="button"
        data-actions-menu
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.right - 220, y: rect.bottom + 4 });
        }}
        title={actions.length ? 'More actions' : 'Add project actions (Commit, Test, Publish…)'}
        className="flex h-7 items-center gap-1 rounded-md border border-border px-1.5 text-[12px] text-muted hover:bg-border/50"
      >
        {actions.length === 0 && 'Actions'}
        <ChevronDown size={12} />
      </button>

      {menu && <Menu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} />}
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
          title={pending.reason === 'trust' ? `Run “${pending.action.name}” from this repository?` : `Run “${pending.action.name}”?`}
          confirmLabel={pending.reason === 'trust' ? 'Approve and run' : 'Run'}
          body={
            <>
              {pending.reason === 'trust' && (
                <p className="mb-2">
                  This action comes from the project’s <code className="font-mono">.switchboard.json</code>. Check the command before you approve it; you won’t be asked
                  again unless it changes.
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
    </div>
  );
}
