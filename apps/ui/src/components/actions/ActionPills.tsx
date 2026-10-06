import { ChevronDown, Plus, Settings2 } from 'lucide-react';
import type { ListedAction } from '@switchboard/protocol/client';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { splitActionPills } from './actionPills.ts';
import { ACTION_ICON, ariaShortcut, formatShortcut } from './useActions.ts';
import type { ActionsMenu } from './useActionsMenu.tsx';

const MENU_WIDTH = 240;

/** What an action runs, for its tooltip. */
const whatItRuns = (action: ListedAction) => `${action.type === 'prompt' ? 'Ask Claude: ' : ''}${action.command}`;

/** A dashed pill that opens the action editor. */
const dashed = 'flex h-6 shrink-0 items-center gap-1 rounded-full border border-dashed border-border text-meta text-muted hover:bg-border/50 hover:text-text';

/**
 * The project's actions as small pills above the message box, one click away: up to three, then
 * "N more ▾" for the rest. With none yet, an "Add action" pill opens the editor. The same actions
 * are in the session header's ⋯ menu. In a narrow pane the pills show only their icon.
 */
export function ActionPills({ actions: menu }: { actions: ActionsMenu }) {
  const more = useMenu();
  const { openEditor } = menu;
  // A session without a known project folder can't keep actions.
  if (!openEditor) return null;
  const { pills, more: rest } = splitActionPills(menu.actions);

  const moreEntries: MenuEntry[] = [
    ...rest.map((a) => {
      const Icon = ACTION_ICON[a.icon];
      return {
        label: a.name,
        icon: <Icon size={13} />,
        ...(a.shortcut ? { hint: formatShortcut(a.shortcut) } : {}),
        onSelect: () => menu.run(a),
        data: { 'data-action': a.id, 'data-tooltip': whatItRuns(a) },
      } satisfies MenuEntry;
    }),
    'separator',
    { label: 'Edit actions…', icon: <Settings2 size={13} />, onSelect: openEditor, data: { 'data-edit-actions': true } },
  ];

  return (
    <div role="group" aria-label="Project actions" className="flex min-w-0 flex-wrap items-center gap-1.5" data-action-pills>
      {/* Not `data-add-action`: the editor's own Add button has that hook. */}
      {pills.length === 0 && (
        <button type="button" onClick={openEditor} data-tooltip="Add a command or prompt you run often" className={`${dashed} px-2.5`} data-add-action-pill>
          <Plus size={12} aria-hidden />
          Add action
        </button>
      )}
      {pills.map((action) => {
        const Icon = ACTION_ICON[action.icon];
        const shortcut = action.shortcut ? formatShortcut(action.shortcut) : null;
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => menu.run(action)}
            data-action-pill={action.id}
            data-tooltip={`${whatItRuns(action)}${shortcut ? ` (${shortcut})` : ''}`}
            aria-label={action.name}
            aria-keyshortcuts={action.shortcut ? ariaShortcut(action.shortcut) : undefined}
            className="flex h-6 max-w-44 min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-meta text-text hover:bg-border/50 @max-[860px]:px-2"
          >
            <Icon size={12} className="shrink-0" aria-hidden />
            <span className="truncate @max-[860px]:sr-only">{action.name}</span>
            {shortcut && (
              <kbd aria-hidden className="shrink-0 font-sans text-faint @max-[860px]:hidden">
                {shortcut}
              </kbd>
            )}
          </button>
        );
      })}
      {rest.length > 0 ? (
        <button
          type="button"
          onClick={(e) => (more.at ? more.close() : more.openAbove(e.currentTarget))}
          data-more-actions
          aria-haspopup="menu"
          aria-expanded={more.at !== null}
          aria-label={`${rest.length} more project actions`}
          className={`flex h-6 shrink-0 items-center gap-1 rounded-full bg-border/50 px-2.5 text-meta hover:text-text ${more.at ? 'text-text' : 'text-muted'}`}
        >
          {rest.length} more
          <ChevronDown size={11} aria-hidden />
        </button>
      ) : (
        pills.length > 0 && (
          <button type="button" onClick={openEditor} data-tooltip="Edit project actions" aria-label="Edit project actions" className={`${dashed} px-1.5`} data-edit-action-pills>
            <Plus size={12} aria-hidden />
          </button>
        )
      )}
      {more.at && <Menu x={more.at.x} y={more.at.y} width={MENU_WIDTH} above entries={moreEntries} onClose={more.close} label="More project actions" />}
    </div>
  );
}
